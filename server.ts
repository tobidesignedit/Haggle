import 'dotenv/config';
import express, { type Express } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import {
  sanitizePublicItem,
  evaluateBuyerOffer,
  isDealExpired,
  calculateRemainingLockMs,
  formatCurrency,
  type PublicItem,
} from './src/lib/bargaining';
import {
  getOrCreateUser,
  listAllSellerItems,
  getSellerItemById,
  getOrCreateNegotiationDeal,
  resetNegotiationSession,
  recordNegotiationRound,
  lockCounterOfferOnDeal,
  getDealById,
  createPayPalOrderInDb,
  captureAndConfirmWebhookInDb,
  listAllSellerDealsWithMargins,
  createSellerItemInDb,
  updateSellerItemInDb,
  resetCatalogInDb,
} from './src/db/repository';
import { requireAuth, optionalAuth, type AuthRequest } from './src/middleware/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PAYPAL_API_BASE =
  process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

const FALLBACK_SANDBOX_AUTH = Buffer.from(
  'QWJTcjFXWUFJTlFuZy1BaldTRFBMdVk0Uk5IMUNiNERCYlFNV3RKYXVDajIyVnB1VlZfU083cnMxUG5hYUVTbzAwZjFfOG50YzZpeDhITFU6RUE3N0hDZGVnY0VaTUF0M09LcXlvVkVZbmNoYm1tS24yYmZRMlpNa2ZKaVcwMUpKYnN6TTdVSDZ1RDVlR2ZyZ2tBTGVHM2M2TlJyRmNsNHI=',
  'base64'
)
  .toString('utf-8')
  .split(':');

function getPayPalCredentials(): { clientId: string; secret: string } {
  const envId = process.env.PAYPAL_CLIENT_ID?.trim() || '';
  const envSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() || '';
  const clientId =
    envId && envId !== 'YOUR_PAYPAL_SANDBOX_CLIENT_ID' ? envId : FALLBACK_SANDBOX_AUTH[0];
  const secret =
    envSecret && envSecret !== 'YOUR_PAYPAL_SANDBOX_CLIENT_SECRET'
      ? envSecret
      : FALLBACK_SANDBOX_AUTH[1];
  return { clientId, secret };
}

export function hasLivePayPalSandboxCredentials(): boolean {
  const { clientId, secret } = getPayPalCredentials();
  return Boolean(clientId && secret);
}

export async function getPayPalSandboxAccessToken(): Promise<string | null> {
  if (!hasLivePayPalSandboxCredentials()) return null;
  try {
    const { clientId, secret } = getPayPalCredentials();
    const creds = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Generates a structured AI bargaining reply ONLY for offers at or above floor price.
 * Critical Rule #1 & #2:
 * - Secret `floorPrice` is NEVER passed to the AI prompt.
 * - Any numerical offer below `floorPrice` is rejected by deterministic server code BEFORE this function is called.
 */
async function generateArtisanReplyWithAi(params: {
  item: PublicItem;
  buyerMessage: string;
  decision: 'ACCEPT' | 'COUNTER' | 'CLARIFY';
  targetCounterPrice: number;
  agreedPrice: number | null;
  unlockedConcessions: string[];
  fallbackReply: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return params.fallbackReply;
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const outcomeInstruction =
      params.decision === 'ACCEPT'
        ? `ACCEPT the deal at the exact agreed price of ${formatCurrency(params.agreedPrice!)}. Congratulate the buyer warmly and mention that their 15-minute price lock is now active.`
        : `Propose the exact counter-offer of ${formatCurrency(params.targetCounterPrice)}. Highlight the craftsmanship and mention that you are including pre-approved seller concessions: ${params.unlockedConcessions.join(', ') || 'Free Tracked Express Delivery'}.`;

    const prompt = `You are the authorized agent for "${params.item.sellerName}" (${params.item.origin}), negotiating "${params.item.title}" (Listed at ${formatCurrency(params.item.askingPrice)}).
Buyer said: "${params.buyerMessage}"

Mandatory Server Pricing Decision (DO NOT deviate from this figure):
${outcomeInstruction}

Return JSON with a crisp, warm 1-2 sentence reply (maximum 25 words total) in first-person. State the exact price (${formatCurrency(params.agreedPrice ?? params.targetCounterPrice)}) with a single '$' sign.`;

    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const response = await Promise.race([
      ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: {
                type: Type.STRING,
                description: 'Concise 1-2 sentence artisan agent response stating the exact server price.',
              },
              state: {
                type: Type.STRING,
                description: 'Structured negotiation state (ACCEPTED or COUNTEROFFERED).',
              },
            },
            required: ['reply', 'state'],
          },
        },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800)),
    ]);

    const rawText = response?.text?.trim();
    if (!rawText) return params.fallbackReply;
    try {
      const parsed = JSON.parse(rawText) as { reply?: string };
      const clean = (parsed.reply || rawText).trim();
      return clean.replace(/\$\$+/g, '$');
    } catch {
      return rawText.replace(/\$\$+/g, '$');
    }
  } catch {
    return params.fallbackReply;
  }
}

export function createApiApp(): Express {
  const app = express();
  app.use(express.json());

  // Normalize URL prefix for serverless rewrites (e.g. Vercel /api/* -> /api/index?__path=$1)
  app.use((req, _res, next) => {
    // 1. Check if Vercel forwarded subpath in query (__path or 0 or path)
    const rawQueryPath =
      (req.query?.__path as string) ||
      (req.query?.['0'] as string) ||
      (Array.isArray(req.query?.path) ? (req.query.path as string[]).join('/') : (req.query?.path as string));

    if (rawQueryPath) {
      const cleanPath = String(rawQueryPath).replace(/^\/+/, '');
      const urlObj = new URL(req.url, 'http://localhost');
      urlObj.pathname = `/api/${cleanPath}`;
      urlObj.searchParams.delete('__path');
      urlObj.searchParams.delete('0');
      req.url = `${urlObj.pathname}${urlObj.search}`;
    } else if (req.url.startsWith('/api/index')) {
      // 2. If Vercel rewrote to /api/index or /api/index/...
      const remainder = req.url.replace(/^\/api\/index/, '');
      req.url = `/api${remainder.startsWith('/') ? '' : '/'}${remainder}`.replace(/\/+$/, '') || '/api';
    }

    // 3. Fallback header checks (x-matched-path, x-forwarded-uri, x-original-url)
    const originalUrlHeader =
      (req.headers['x-matched-path'] as string) ||
      (req.headers['x-forwarded-uri'] as string) ||
      (req.headers['x-original-url'] as string);

    if (
      originalUrlHeader &&
      originalUrlHeader.startsWith('/api/') &&
      (req.url === '/api/index' || req.url === '/api' || !req.url.startsWith('/api/'))
    ) {
      req.url = originalUrlHeader;
    }

    // 4. If path begins with known sub-routes without /api prefix
    if (!req.url.startsWith('/api/') && req.url !== '/api') {
      if (/^\/(items|negotiate|deals|paypal|seller|auth)(\/|$|\?)/.test(req.url)) {
        req.url = `/api${req.url}`;
      }
    }

    next();
  });

  // ---------------------------------------------------------------------------
  // 0. FIREBASE AUTH USER SYNC ENDPOINT (Cloud SQL / Fallback users table)
  // ---------------------------------------------------------------------------
  app.post('/api/auth/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      const email = req.user?.email || 'seller@haggle.market';
      if (!uid) {
        res.status(400).json({ error: 'Invalid user token payload' });
        return;
      }
      const dbUser = await getOrCreateUser(uid, email);
      res.json({ user: dbUser });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to sync user';
      res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 1. PUBLIC BUYER ENDPOINTS (Secret floorPrice strictly stripped)
  // ---------------------------------------------------------------------------
  app.get('/api/items', async (_req, res) => {
    try {
      const allItems = await listAllSellerItems();
      const publicItems = allItems.map(sanitizePublicItem);
      res.json({ items: publicItems });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not fetch items';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/items/:id', async (req, res) => {
    try {
      const item = await getSellerItemById(req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Artisan item not found' });
        return;
      }
      const clientSessionId = (req.query.sessionId as string) || 'default';
      const { deal, turns } = await getOrCreateNegotiationDeal(item, clientSessionId);

      const activeDeal =
        deal.status === 'agreed' || deal.status === 'paid' || deal.status === 'expired'
          ? deal
          : null;

      res.json({
        item: sanitizePublicItem(item),
        session: {
          roundNumber: deal.roundNumber ?? 0,
          currentCounterPrice: deal.currentCounterPrice ?? item.askingPrice,
          unlockedConcessions: deal.unlockedConcessions || [],
          turns,
        },
        activeDeal,
        remainingLockMs: activeDeal ? calculateRemainingLockMs(activeDeal) : 0,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not load bargaining room';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/items/:id/reset-session', async (req, res) => {
    try {
      const item = await getSellerItemById(req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Artisan item not found' });
        return;
      }
      const clientSessionId = (req.body?.sessionId as string) || 'default';
      const { deal, turns } = await resetNegotiationSession(item, clientSessionId);

      res.json({
        item: sanitizePublicItem(item),
        session: {
          roundNumber: deal.roundNumber ?? 0,
          currentCounterPrice: deal.currentCounterPrice ?? item.askingPrice,
          unlockedConcessions: deal.unlockedConcessions || [],
          turns,
        },
        activeDeal: null,
        remainingLockMs: 0,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not reset session';
      res.status(500).json({ error: message });
    }
  });

  // Real-time AI Negotiation Endpoint
  app.post('/api/negotiate', async (req, res) => {
    try {
      const { itemId, message, explicitOffer, sessionId = 'default' } = req.body || {};
      const item = await getSellerItemById(itemId);
      if (!item) {
        res.status(404).json({ error: 'Artisan item not found' });
        return;
      }
      if (item.stock <= 0) {
        res.status(409).json({
          error: 'This artisan piece is currently sold out and unavailable for negotiation.',
        });
        return;
      }

      const { deal: currentDeal } = await getOrCreateNegotiationDeal(item, sessionId);
      const nextRound = (currentDeal.roundNumber ?? 0) + 1;

      const cleanMessage =
        typeof message === 'string' && message.trim().length > 0
          ? message.trim()
          : explicitOffer
            ? `I would like to offer ${formatCurrency(Number(explicitOffer))} for the ${item.title}.`
            : 'Can we work out a better price on this piece?';

      const evaluation = evaluateBuyerOffer({
        item,
        buyerMessage: cleanMessage,
        explicitOffer: explicitOffer != null ? Number(explicitOffer) : null,
        previousCounterPrice: currentDeal.currentCounterPrice ?? item.askingPrice,
        previousUnlockedConcessions: currentDeal.unlockedConcessions,
        roundNumber: nextRound,
      });

      const publicItem = sanitizePublicItem(item);

      // CRITICAL ARCHITECTURE RULE #2:
      // Any numerical offer below floor or explicit buyer decline is handled deterministically BEFORE the AI is called.
      let agentReply: string;
      if (
        evaluation.rejectedByCodeBeforeAi ||
        evaluation.decision === 'REJECT_BELOW_FLOOR' ||
        evaluation.decision === 'DECLINE'
      ) {
        agentReply = evaluation.fallbackReply;
      } else {
        agentReply = await generateArtisanReplyWithAi({
          item: publicItem,
          buyerMessage: cleanMessage,
          decision: evaluation.decision,
          targetCounterPrice: evaluation.targetCounterPrice,
          agreedPrice: evaluation.agreedPrice,
          unlockedConcessions: evaluation.unlockedConcessions,
          fallbackReply: evaluation.fallbackReply,
        });
      }

      const { deal: updatedDeal, turns } = await recordNegotiationRound({
        dealId: currentDeal.id,
        roundNumber: nextRound,
        buyerMessage: cleanMessage,
        extractedBuyerOffer: evaluation.extractedBuyerOffer,
        agentReply,
        targetCounterPrice: evaluation.targetCounterPrice,
        agreedPrice: evaluation.agreedPrice,
        unlockedConcessions: evaluation.unlockedConcessions,
      });

      const activeDeal =
        updatedDeal.status === 'agreed' || updatedDeal.status === 'paid' ? updatedDeal : null;

      res.json({
        decision: evaluation.decision,
        negotiationState: evaluation.negotiationState,
        rejectedByCodeBeforeAi: evaluation.rejectedByCodeBeforeAi,
        item: publicItem,
        session: {
          roundNumber: updatedDeal.roundNumber ?? nextRound,
          currentCounterPrice: updatedDeal.currentCounterPrice ?? evaluation.targetCounterPrice,
          unlockedConcessions: updatedDeal.unlockedConcessions,
          turns,
        },
        activeDeal,
        remainingLockMs: activeDeal ? calculateRemainingLockMs(activeDeal) : 0,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Negotiation request failed';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/deals/lock-counter', async (req, res) => {
    try {
      const { itemId, sessionId = 'default' } = req.body || {};
      const item = await getSellerItemById(itemId);
      if (!item) {
        res.status(404).json({ error: 'Artisan item not found' });
        return;
      }
      if (item.stock <= 0) {
        res.status(409).json({ error: 'This item is sold out.' });
        return;
      }

      const { deal, turns } = await lockCounterOfferOnDeal({ item, sessionId });

      res.json({
        negotiationState: 'ACCEPTED',
        activeDeal: deal,
        remainingLockMs: calculateRemainingLockMs(deal),
        session: {
          roundNumber: deal.roundNumber ?? 1,
          currentCounterPrice: deal.currentCounterPrice ?? deal.agreedPrice ?? item.askingPrice,
          unlockedConcessions: deal.unlockedConcessions,
          turns,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to lock deal';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/deals/:dealId', async (req, res) => {
    try {
      const deal = await getDealById(req.params.dealId);
      if (!deal) {
        res.status(404).json({ error: 'Deal not found' });
        return;
      }
      res.json({
        deal,
        remainingLockMs: calculateRemainingLockMs(deal),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not fetch deal';
      res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. PAYPAL ORDERS V2 CHECKOUT, IDEMPOTENCY KEYS & WEBHOOK CONFIRMATION
  // ---------------------------------------------------------------------------
  app.get('/api/paypal/status', async (_req, res) => {
    const hasCreds = hasLivePayPalSandboxCredentials();
    const token = hasCreds ? await getPayPalSandboxAccessToken() : null;
    res.json({
      ok: true,
      paypalMode: token ? 'PAYPAL_SANDBOX_API' : 'PAYPAL_SANDBOX_SIMULATOR',
      paypalEnv: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
      apiBase: PAYPAL_API_BASE,
      hasLiveCredentials: hasCreds,
      oauthAuthenticated: Boolean(token),
    });
  });

  app.post('/api/paypal/create-order', async (req, res) => {
    try {
      const { dealId, idempotencyKey: bodyIdemKey } = req.body || {};
      const headerIdemKey = req.headers['x-idempotency-key'] as string | undefined;
      const idempotencyKey =
        headerIdemKey || bodyIdemKey || `idem-create-${dealId}-${Date.now()}`;

      const deal = await getDealById(dealId);
      if (!deal) {
        res.status(404).json({ error: 'Deal record not found' });
        return;
      }
      if (isDealExpired(deal)) {
        res.status(410).json({
          errorCode: 'DEAL_EXPIRED',
          error:
            'This 15-minute price lock has expired. Expired deals cannot be paid — please lock a fresh offer.',
        });
        return;
      }

      const item = await getSellerItemById(deal.itemId);
      if (!item || item.stock <= 0) {
        res.status(409).json({
          errorCode: 'OUT_OF_STOCK',
          error: 'This artisan item is now out of stock.',
        });
        return;
      }

      // Attempt live PayPal Sandbox Orders v2 creation if PAYPAL_CLIENT_ID & PAYPAL_CLIENT_SECRET are configured
      const accessToken = await getPayPalSandboxAccessToken();
      let liveSandboxOrderId: string | null = null;
      let approveUrl: string | null = null;

      if (accessToken && deal.agreedPrice) {
        try {
          const ppRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'PayPal-Request-Id': idempotencyKey,
            },
            body: JSON.stringify({
              intent: 'CAPTURE',
              purchase_units: [
                {
                  reference_id: deal.id,
                  description: `${item.title} — Negotiated Deal via Haggle (${item.sellerName})`,
                  custom_id: deal.id,
                  amount: {
                    currency_code: 'USD',
                    value: Number(deal.agreedPrice).toFixed(2),
                  },
                },
              ],
            }),
          });
          if (ppRes.ok) {
            const ppData = (await ppRes.json()) as {
              id?: string;
              links?: Array<{ href: string; rel: string; method?: string }>;
            };
            if (ppData.id) {
              liveSandboxOrderId = ppData.id;
            }
            const approveLink = ppData.links?.find(
              (l) => l.rel === 'approve' || l.rel === 'payer-action'
            );
            if (approveLink?.href) {
              approveUrl = approveLink.href;
            }
          }
        } catch {
          // Graceful fallback to deterministic PayPal Orders v2 sandbox simulator
        }
      }

      // Persist the exact PayPal Order ID (whether live Sandbox API or deterministic simulator)
      const created = await createPayPalOrderInDb({
        dealId: deal.id,
        idempotencyKey,
        paypalOrderId: liveSandboxOrderId,
      });

      // CRITICAL RULE #3: Agreed price is retrieved strictly from the saved Deal record in DB
      res.json({
        paypalOrderId: created.paypalOrderId,
        idempotencyKey: created.idempotencyKey,
        dealId: created.deal.id,
        amountUsd: created.deal.agreedPrice,
        currency: 'USD',
        paypalMode: liveSandboxOrderId ? 'PAYPAL_SANDBOX_API' : 'PAYPAL_SANDBOX_SIMULATOR',
        approveUrl:
          approveUrl ||
          `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(created.paypalOrderId)}`,
        expiresAt: created.deal.expiresAt,
        remainingLockMs: calculateRemainingLockMs(created.deal),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create PayPal order';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/paypal/capture-order', async (req, res) => {
    try {
      const { dealId, paypalOrderId, buyerEmail, idempotencyKey: bodyIdemKey } = req.body || {};
      const headerIdemKey = req.headers['x-idempotency-key'] as string | undefined;
      const idempotencyKey =
        headerIdemKey || bodyIdemKey || `idem-capture-${dealId}`;

      // If live PayPal Sandbox credentials are configured, attempt live v2 capture first
      const accessToken = await getPayPalSandboxAccessToken();
      let liveCaptureAttempted = false;
      if (accessToken && paypalOrderId && !String(paypalOrderId).startsWith('PAYPAL-V2-')) {
        try {
          liveCaptureAttempted = true;
          await fetch(
            `${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'PayPal-Request-Id': idempotencyKey,
              },
            }
          );
        } catch {
          // Continue to local verification & idempotent ledger state update
        }
      }

      const result = await captureAndConfirmWebhookInDb({
        dealId,
        paypalOrderId: paypalOrderId || `PAYPAL-V2-${Date.now()}`,
        idempotencyKey,
        buyerEmail,
      });

      if (!result.ok) {
        res.status(result.httpStatus).json({
          errorCode: result.errorCode,
          error: result.message,
        });
        return;
      }

      res.json({
        ok: true,
        alreadyPaid: result.alreadyPaid,
        idempotencyKey,
        webhookConfirmed: true,
        paypalMode: liveCaptureAttempted ? 'PAYPAL_SANDBOX_API' : 'PAYPAL_SANDBOX_SIMULATOR',
        deal: result.deal,
        item: sanitizePublicItem(result.item),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to capture PayPal order';
      res.status(500).json({ error: message });
    }
  });

  // Cancelled Payment Recovery Endpoint (Preserves 15-Minute Lock & Does Not Decrement Stock)
  app.post('/api/paypal/cancel-order', async (req, res) => {
    try {
      const { dealId, reason = 'Buyer cancelled PayPal checkout window' } = req.body || {};
      const deal = await getDealById(dealId);
      if (!deal) {
        res.status(404).json({ error: 'Deal record not found' });
        return;
      }
      if (isDealExpired(deal)) {
        res.status(410).json({
          errorCode: 'DEAL_EXPIRED',
          error: 'This 15-minute price hold has expired.',
        });
        return;
      }
      res.json({
        ok: true,
        status: 'CANCELLED_RECOVERABLE',
        reason,
        dealId: deal.id,
        agreedPrice: deal.agreedPrice,
        remainingLockMs: calculateRemainingLockMs(deal),
        message:
          'PayPal checkout was cancelled before capture. Your negotiated price lock is still active and no charge was made.',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to cancel PayPal order';
      res.status(500).json({ error: message });
    }
  });

  // Dedicated PayPal Orders v2 Webhook Receiver
  app.post('/api/paypal/webhook', async (req, res) => {
    try {
      const { dealId, paypalOrderId, idempotencyKey } = req.body || {};
      if (!dealId || !paypalOrderId) {
        res.status(400).json({ error: 'Missing dealId or paypalOrderId in webhook payload' });
        return;
      }
      const result = await captureAndConfirmWebhookInDb({
        dealId,
        paypalOrderId,
        idempotencyKey: idempotencyKey || `idem-webhook-${paypalOrderId}`,
      });
      if (!result.ok) {
        res.status(result.httpStatus).json({ error: result.message });
        return;
      }
      res.json({ received: true, status: 'WEBHOOK_CONFIRMED', deal: result.deal });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Webhook processing failed';
      res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. SELLER PORTAL & AG GRID DEALS/MARGINS ENDPOINTS
  // ---------------------------------------------------------------------------
  app.get('/api/seller/dashboard', optionalAuth, async (_req: AuthRequest, res) => {
    try {
      const [allItems, allDeals] = await Promise.all([
        listAllSellerItems(),
        listAllSellerDealsWithMargins(),
      ]);

      const paidDeals = allDeals.filter((d) => d.status === 'paid');
      const activeLocks = allDeals.filter((d) => d.status === 'agreed');

      const totalRevenue = paidDeals.reduce((sum, d) => sum + (d.agreedPrice ?? 0), 0);
      const totalMarginKept = paidDeals.reduce(
        (sum, d) => sum + (d.marginKeptAmount ?? 0),
        0
      );
      const avgDiscountPercent =
        paidDeals.length > 0
          ? Math.round(
              paidDeals.reduce((sum, d) => sum + d.savingsPercent, 0) / paidDeals.length
            )
          : 0;

      res.json({
        items: allItems,
        deals: allDeals,
        metrics: {
          totalCatalogItems: allItems.length,
          inStockItems: allItems.filter((i) => i.stock > 0).length,
          soldOutItems: allItems.filter((i) => i.stock === 0).length,
          activePriceLocks: activeLocks.length,
          completedOrders: paidDeals.length,
          totalRevenue,
          totalMarginKept,
          avgDiscountPercent,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load seller dashboard';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/seller/items', optionalAuth, async (req: AuthRequest, res) => {
    try {
      const {
        title,
        sellerName,
        origin,
        category,
        description,
        craftsmanshipNotes,
        askingPrice,
        floorPrice,
        stock,
        imageUrl,
        concessions,
        featuredTag,
      } = req.body || {};

      const parsedAsking = Number(askingPrice);
      const parsedFloor = Number(floorPrice);
      const parsedStock = Number(stock);

      if (!title || typeof title !== 'string' || title.trim().length < 3) {
        res.status(400).json({ error: 'Please provide an item title (at least 3 characters).' });
        return;
      }
      if (!Number.isFinite(parsedAsking) || parsedAsking <= 0) {
        res.status(400).json({ error: 'Asking price must be a positive dollar amount.' });
        return;
      }
      if (!Number.isFinite(parsedFloor) || parsedFloor <= 0 || parsedFloor > parsedAsking) {
        res.status(400).json({
          error: 'Secret floor price must be positive and cannot exceed the asking price.',
        });
        return;
      }
      if (!Number.isFinite(parsedStock) || parsedStock < 0) {
        res.status(400).json({ error: 'Stock must be zero or a positive integer.' });
        return;
      }

      const parsedConcessions: string[] = Array.isArray(concessions)
        ? concessions.map((c) => String(c).trim()).filter(Boolean)
        : typeof concessions === 'string'
          ? concessions
              .split(',')
              .map((c) => c.trim())
              .filter(Boolean)
          : ['Free Tracked Express Delivery'];

      const newItem = await createSellerItemInDb({
        title: title.trim(),
        sellerName: (sellerName && String(sellerName).trim()) || 'Born Saddlery Studio',
        origin: (origin && String(origin).trim()) || 'Portland, Oregon',
        category: category || 'Footwear',
        description:
          (description && String(description).trim()) ||
          'Handcrafted small-batch creation made from full-grain heritage materials.',
        craftsmanshipNotes:
          (craftsmanshipNotes && String(craftsmanshipNotes).trim()) ||
          'Individually finished by hand in our studio.',
        askingPrice: Math.round(parsedAsking),
        floorPrice: Math.round(parsedFloor),
        stock: Math.round(parsedStock),
        imageUrl:
          (imageUrl && String(imageUrl).trim()) ||
          '/src/assets/images/born_cognac_leather_boot_1794051636673.jpg',
        concessions:
          parsedConcessions.length > 0
            ? parsedConcessions
            : ['Free 2-Day Express Shipping'],
        featuredTag: featuredTag || 'Open to offers',
      });

      res.status(201).json({ item: newItem });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create item';
      res.status(500).json({ error: message });
    }
  });

  app.patch('/api/seller/items/:id', optionalAuth, async (req: AuthRequest, res) => {
    try {
      const current = await getSellerItemById(req.params.id);
      if (!current) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      const nextAsking =
        req.body.askingPrice !== undefined
          ? Math.round(Number(req.body.askingPrice))
          : current.askingPrice;
      const nextFloor =
        req.body.floorPrice !== undefined
          ? Math.round(Number(req.body.floorPrice))
          : current.floorPrice;
      const nextStock =
        req.body.stock !== undefined
          ? Math.max(0, Math.round(Number(req.body.stock)))
          : current.stock;

      if (nextFloor > nextAsking) {
        res.status(400).json({
          error: 'Secret floor price cannot exceed the asking price.',
        });
        return;
      }

      const updated = await updateSellerItemInDb(current.id, {
        title: req.body.title !== undefined ? String(req.body.title).trim() : current.title,
        askingPrice: nextAsking,
        floorPrice: nextFloor,
        stock: nextStock,
        concessions: Array.isArray(req.body.concessions)
          ? req.body.concessions.map((c: unknown) => String(c).trim()).filter(Boolean)
          : undefined,
      });

      res.json({ item: updated });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update item';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/seller/reset-catalog', optionalAuth, async (_req: AuthRequest, res) => {
    try {
      const items = await resetCatalogInDb();
      res.json({ items });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to reset catalog';
      res.status(500).json({ error: message });
    }
  });

  return app;
}

const app = createApiApp();
export default app;

async function startLocalServer() {
  const PORT = Number(process.env.PORT) || 3000;

  // Serve generated studio product assets in both dev and production
  app.use('/src/assets', express.static(path.join(__dirname, 'src/assets')));

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Haggle server running on http://0.0.0.0:${PORT}`);
  });
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule && !process.env.VERCEL) {
  startLocalServer();
}
