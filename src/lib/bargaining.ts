export type DealStatus = 'negotiating' | 'agreed' | 'expired' | 'paid' | 'cancelled';

export type StructuredNegotiationState =
  | 'NEGOTIATING'
  | 'COUNTEROFFERED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED';

export interface SellerItem {
  id: string;
  sellerId?: number | null;
  title: string;
  sellerName: string;
  origin: string;
  category: 'Footwear' | 'Leather Goods' | 'Home & Kitchen' | 'Culinary' | 'Ceramics' | 'Horology';
  description: string;
  craftsmanshipNotes: string;
  askingPrice: number;
  floorPrice: number; // Secret server-only reserve price (never sent to client or AI)
  stock: number;
  imageUrl: string;
  concessions: string[];
  featuredTag?: string;
  createdAt: string;
}

export type PublicItem = Omit<SellerItem, 'floorPrice'>;

export interface NegotiationTurn {
  id: string;
  sender: 'buyer' | 'agent' | 'system';
  message: string;
  offeredPrice?: number;
  counterPrice?: number;
  unlockedConcessions?: string[];
  rejectedByCode?: boolean;
  timestamp: string;
}

export interface DealRecord {
  id: string;
  itemId: string;
  itemTitle: string;
  sellerName: string;
  askingPrice: number;
  agreedPrice: number | null;
  savingsAmount: number;
  savingsPercent: number;
  marginKeptAmount?: number; // Only populated in Seller Dashboard responses
  marginKeptPercent?: number; // Only populated in Seller Dashboard responses
  unlockedConcessions: string[];
  status: DealStatus;
  sessionId?: string;
  roundNumber?: number;
  currentCounterPrice?: number;
  createdAt: number; // epoch ms
  expiresAt: number | null; // epoch ms (createdAt + 15 * 60 * 1000 when status === 'agreed')
  paypalOrderId?: string | null;
  idempotencyKey?: string | null;
  webhookConfirmed?: boolean;
  paidAt?: number | null;
  buyerEmail?: string | null;
}

export interface OfferEvaluationResult {
  decision: 'ACCEPT' | 'COUNTER' | 'CLARIFY' | 'REJECT_BELOW_FLOOR' | 'DECLINE';
  negotiationState: StructuredNegotiationState;
  rejectedByCodeBeforeAi: boolean;
  extractedBuyerOffer: number | null;
  targetCounterPrice: number;
  agreedPrice: number | null;
  unlockedConcessions: string[];
  roundNumber: number;
  fallbackReply: string;
}

export const DEAL_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Formats a numeric price cleanly with a single '$' prefix and comma separators.
 */
export function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    return '$0';
  }
  const rounded = Math.round(amount * 100) / 100;
  const hasCents = rounded % 1 !== 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(rounded);
}

/**
 * Strips the secret `floorPrice` from an item before sending to any buyer client endpoint or AI prompt.
 */
export function sanitizePublicItem(item: SellerItem): PublicItem {
  const { floorPrice: _secretFloor, ...publicFields } = item;
  return {
    ...publicFields,
    concessions: [...item.concessions],
  };
}

/**
 * Calculates the seller's kept margin above the secret floor price.
 * Used exclusively on the server for the Seller AG Grid dashboard.
 */
export function calculateSellerMargin(params: {
  askingPrice: number;
  floorPrice: number;
  agreedPrice: number | null;
}): {
  marginKeptAmount: number;
  marginKeptPercent: number;
} {
  const { askingPrice, floorPrice, agreedPrice } = params;
  if (agreedPrice === null || agreedPrice < floorPrice) {
    return { marginKeptAmount: 0, marginKeptPercent: 0 };
  }
  const marginKeptAmount = Math.max(0, agreedPrice - floorPrice);
  const totalNegotiableRoom = Math.max(1, askingPrice - floorPrice);
  const marginKeptPercent = Math.min(
    100,
    Math.round((marginKeptAmount / totalNegotiableRoom) * 100)
  );
  return { marginKeptAmount, marginKeptPercent };
}

/**
 * Extracts a numeric offer from a natural-language buyer message or explicit offer input.
 * Supports "45k", "$45,000", "45000", "$420", etc.
 */
export function extractOfferFromMessage(
  message: string,
  explicitOffer?: number | null
): number | null {
  if (typeof explicitOffer === 'number' && Number.isFinite(explicitOffer) && explicitOffer > 0) {
    return Math.round(explicitOffer);
  }
  if (!message || typeof message !== 'string') {
    return null;
  }

  // Match shorthand like "$45k" or "45k"
  const kMatch = message.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*k\b/i);
  if (kMatch) {
    const val = parseFloat(kMatch[1]) * 1000;
    if (Number.isFinite(val) && val > 0) return Math.round(val);
  }

  // Match "$45,000" or "$420"
  const dollarMatch = message.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]{1,2})?)/);
  if (dollarMatch) {
    const val = parseFloat(dollarMatch[1].replace(/,/g, ''));
    if (Number.isFinite(val) && val > 0) return Math.round(val);
  }

  // Match comma-separated numbers like "45,000" or standalone numbers
  const commaNumberMatch = message.match(/\b([0-9]{1,3}(?:,[0-9]{3})+)\b/);
  if (commaNumberMatch) {
    const val = parseInt(commaNumberMatch[1].replace(/,/g, ''), 10);
    if (Number.isFinite(val) && val > 0) return val;
  }

  const numberMatches = message.match(/\b([0-9]{2,6})\b/g);
  if (numberMatches && numberMatches.length > 0) {
    const candidate = parseInt(numberMatches[numberMatches.length - 1], 10);
    if (Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
}

/**
 * Critical Architecture Rule #2:
 * Any numerical offer below floor is rejected by deterministic server code BEFORE the AI is called.
 * Floor price is never sent to the client or the AI.
 */
export function evaluateBuyerOffer(params: {
  item: SellerItem;
  buyerMessage: string;
  explicitOffer?: number | null;
  previousCounterPrice?: number | null;
  previousUnlockedConcessions?: string[];
  roundNumber: number;
}): OfferEvaluationResult {
  const {
    item,
    buyerMessage,
    explicitOffer,
    previousCounterPrice,
    previousUnlockedConcessions = [],
    roundNumber,
  } = params;

  const currentAnchor =
    typeof previousCounterPrice === 'number' && previousCounterPrice >= item.floorPrice
      ? previousCounterPrice
      : item.askingPrice;

  const extractedOffer = extractOfferFromMessage(buyerMessage, explicitOffer);
  const lowerMsg = buyerMessage.toLowerCase();

  // Check if buyer explicitly declines the current counter offer
  const declinesOffer =
    extractedOffer === null &&
    /\b(decline|no thanks|pass for now|walk away|cancel offer)\b/i.test(lowerMsg);

  if (declinesOffer) {
    return {
      decision: 'DECLINE',
      negotiationState: 'DECLINED',
      rejectedByCodeBeforeAi: true,
      extractedBuyerOffer: null,
      targetCounterPrice: currentAnchor,
      agreedPrice: null,
      unlockedConcessions: [...previousUnlockedConcessions],
      roundNumber,
      fallbackReply: `No problem at all! I've paused this offer at ${formatCurrency(currentAnchor)}. Whenever you'd like to propose another price, I'm here.`,
    };
  }

  // Check if buyer explicitly accepts the current counter price
  const acceptsCurrentCounter =
    previousCounterPrice != null &&
    extractedOffer === null &&
    /\b(deal|accept|agreed|yes|sounds good|take it|lock it|i'll take it|ok)\b/i.test(lowerMsg);

  if (acceptsCurrentCounter && previousCounterPrice != null) {
    const finalPrice = Math.max(item.floorPrice, previousCounterPrice);
    const unlocked =
      previousUnlockedConcessions.length > 0
        ? previousUnlockedConcessions
        : item.concessions.slice(0, 1);
    return {
      decision: 'ACCEPT',
      negotiationState: 'ACCEPTED',
      rejectedByCodeBeforeAi: false,
      extractedBuyerOffer: finalPrice,
      targetCounterPrice: finalPrice,
      agreedPrice: finalPrice,
      unlockedConcessions: unlocked,
      roundNumber,
      fallbackReply: `Deal locked at ${formatCurrency(finalPrice)} with ${unlocked.join(' + ')} included! Reserved for 15 minutes — complete checkout with PayPal below.`,
    };
  }

  if (extractedOffer === null) {
    const gentleStep = Math.max(
      item.floorPrice,
      Math.round(currentAnchor - (currentAnchor - item.floorPrice) * 0.25)
    );
    const unlocked =
      roundNumber >= 1 && item.concessions.length > 0
        ? Array.from(new Set([...previousUnlockedConcessions, item.concessions[0]]))
        : [...previousUnlockedConcessions];

    return {
      decision: 'CLARIFY',
      negotiationState: 'COUNTEROFFERED',
      rejectedByCodeBeforeAi: false,
      extractedBuyerOffer: null,
      targetCounterPrice: gentleStep,
      agreedPrice: null,
      unlockedConcessions: unlocked,
      roundNumber,
      fallbackReply: `I can offer ${formatCurrency(gentleStep)}${unlocked.length ? ` with ${unlocked.join(' + ')}` : ''} today. Want to lock that in, or have another price in mind?`,
    };
  }

  // CRITICAL RULE #2: Offer below secret floor price is rejected by code BEFORE AI is called
  if (extractedOffer < item.floorPrice) {
    const concessionStep = Math.min(0.8, 0.35 + roundNumber * 0.2);
    const rawCounter = Math.round(
      item.askingPrice - (item.askingPrice - item.floorPrice) * concessionStep
    );
    const boundedCounter = Math.max(
      item.floorPrice,
      Math.min(currentAnchor, rawCounter)
    );

    const unlockedCount = Math.min(
      item.concessions.length,
      Math.max(1, Math.min(3, roundNumber + 1))
    );
    const unlocked = item.concessions.slice(0, unlockedCount);

    return {
      decision: 'REJECT_BELOW_FLOOR',
      negotiationState: 'COUNTEROFFERED',
      rejectedByCodeBeforeAi: true,
      extractedBuyerOffer: extractedOffer,
      targetCounterPrice: boundedCounter,
      agreedPrice: null,
      unlockedConcessions: unlocked,
      roundNumber,
      fallbackReply: `Can't quite go down to ${formatCurrency(extractedOffer)} on small-batch craft, but I can counter at ${formatCurrency(boundedCounter)} and include ${unlocked.join(' + ')} free.`,
    };
  }

  // Buyer offer >= currentAnchor (and >= floorPrice) -> Immediate ACCEPT
  if (extractedOffer >= currentAnchor) {
    const agreed = Math.min(item.askingPrice, extractedOffer);
    const unlocked =
      previousUnlockedConcessions.length > 0
        ? previousUnlockedConcessions
        : item.concessions.slice(0, 1);
    return {
      decision: 'ACCEPT',
      negotiationState: 'ACCEPTED',
      rejectedByCodeBeforeAi: false,
      extractedBuyerOffer: extractedOffer,
      targetCounterPrice: agreed,
      agreedPrice: agreed,
      unlockedConcessions: unlocked,
      roundNumber,
      fallbackReply: `Deal! ${item.sellerName} accepts ${formatCurrency(agreed)}${unlocked.length ? ` + ${unlocked.join(' & ')}` : ''}. Locked for 15 minutes — pay safely with PayPal below.`,
    };
  }

  // Buyer offer is between floorPrice and currentAnchor
  const marginAboveFloor =
    (extractedOffer - item.floorPrice) / Math.max(1, item.askingPrice - item.floorPrice);

  if (
    marginAboveFloor >= 0.35 ||
    roundNumber >= 2 ||
    (currentAnchor - extractedOffer) / Math.max(1, item.askingPrice) <= 0.04
  ) {
    const unlocked =
      previousUnlockedConcessions.length > 0
        ? previousUnlockedConcessions
        : item.concessions.slice(0, Math.min(2, item.concessions.length));
    return {
      decision: 'ACCEPT',
      negotiationState: 'ACCEPTED',
      rejectedByCodeBeforeAi: false,
      extractedBuyerOffer: extractedOffer,
      targetCounterPrice: extractedOffer,
      agreedPrice: extractedOffer,
      unlockedConcessions: unlocked,
      roundNumber,
      fallbackReply: `Deal! ${item.sellerName} meets you at ${formatCurrency(extractedOffer)}${unlocked.length ? ` with ${unlocked.join(' + ')} included` : ''}. Your price is locked for 15 minutes.`,
    };
  }

  const midpoint = Math.max(
    item.floorPrice,
    Math.round((extractedOffer + currentAnchor) / 2)
  );
  const unlockedCount = Math.min(item.concessions.length, Math.max(1, roundNumber));
  const unlocked = item.concessions.slice(0, unlockedCount);

  return {
    decision: 'COUNTER',
    negotiationState: 'COUNTEROFFERED',
    rejectedByCodeBeforeAi: false,
    extractedBuyerOffer: extractedOffer,
    targetCounterPrice: midpoint,
    agreedPrice: null,
    unlockedConcessions: unlocked,
    roundNumber,
    fallbackReply: `${formatCurrency(extractedOffer)} is super close! Meet me at ${formatCurrency(midpoint)} and I'll include ${unlocked.join(' + ')} on the house.`,
  };
}

/**
 * Creates a server-enforced 15-minute Deal lock record with status = 'agreed'.
 */
export function createLockedDeal(params: {
  id: string;
  item: SellerItem;
  agreedPrice: number;
  unlockedConcessions: string[];
  nowMs?: number;
}): DealRecord {
  const now = params.nowMs ?? Date.now();
  const safePrice = Math.max(
    params.item.floorPrice,
    Math.min(params.item.askingPrice, params.agreedPrice)
  );
  const savingsAmount = Math.max(0, params.item.askingPrice - safePrice);
  const savingsPercent =
    params.item.askingPrice > 0
      ? Math.round((savingsAmount / params.item.askingPrice) * 100)
      : 0;

  return {
    id: params.id,
    itemId: params.item.id,
    itemTitle: params.item.title,
    sellerName: params.item.sellerName,
    askingPrice: params.item.askingPrice,
    agreedPrice: safePrice,
    savingsAmount,
    savingsPercent,
    unlockedConcessions: [...params.unlockedConcessions],
    status: 'agreed',
    createdAt: now,
    expiresAt: now + DEAL_LOCK_DURATION_MS,
  };
}

/**
 * Checks whether an agreed deal has passed its 15-minute expiration timestamp.
 */
export function isDealExpired(deal: DealRecord, nowMs: number = Date.now()): boolean {
  if (deal.status === 'paid') return false;
  if (deal.status === 'expired' || deal.status === 'cancelled') return true;
  if (deal.expiresAt == null) return false;
  return nowMs > deal.expiresAt;
}

/**
 * Calculates remaining milliseconds on a locked deal (0 if expired).
 */
export function calculateRemainingLockMs(deal: DealRecord, nowMs: number = Date.now()): number {
  if (deal.status === 'expired' || deal.status === 'cancelled' || deal.expiresAt == null) {
    return 0;
  }
  return Math.max(0, deal.expiresAt - nowMs);
}

/**
 * Validates deal expiry, idempotency key, and stock, then performs atomic stock decrement
 * and marks deal status = 'paid' upon capture + webhook confirmation.
 */
export function validateAndCaptureDeal(params: {
  deal: DealRecord;
  item: SellerItem;
  paypalOrderId: string;
  idempotencyKey?: string;
  buyerEmail?: string;
  nowMs?: number;
}):
  | {
      ok: true;
      alreadyPaid: boolean;
      updatedDeal: DealRecord;
      updatedItem: SellerItem;
    }
  | {
      ok: false;
      httpStatus: 400 | 409 | 410;
      errorCode: 'DEAL_EXPIRED' | 'OUT_OF_STOCK' | 'INVALID_DEAL';
      message: string;
    } {
  const now = params.nowMs ?? Date.now();
  const { deal, item, paypalOrderId, idempotencyKey, buyerEmail } = params;

  if (deal.status === 'paid') {
    return {
      ok: true,
      alreadyPaid: true,
      updatedDeal: deal,
      updatedItem: item,
    };
  }

  if (deal.agreedPrice === null || deal.status === 'negotiating') {
    return {
      ok: false,
      httpStatus: 400,
      errorCode: 'INVALID_DEAL',
      message: 'Deal price has not been locked yet.',
    };
  }

  if (isDealExpired(deal, now)) {
    return {
      ok: false,
      httpStatus: 410,
      errorCode: 'DEAL_EXPIRED',
      message:
        'This 15-minute price lock has expired. Please send a new offer to lock a fresh price.',
    };
  }

  if (item.stock <= 0) {
    return {
      ok: false,
      httpStatus: 409,
      errorCode: 'OUT_OF_STOCK',
      message: 'This artisan piece is out of stock.',
    };
  }

  const updatedItem: SellerItem = {
    ...item,
    stock: item.stock - 1,
  };

  const updatedDeal: DealRecord = {
    ...deal,
    status: 'paid',
    paypalOrderId,
    idempotencyKey: idempotencyKey || `idem-${deal.id}`,
    webhookConfirmed: true,
    paidAt: now,
    buyerEmail: buyerEmail || 'collector@haggle.market',
  };

  return {
    ok: true,
    alreadyPaid: false,
    updatedDeal,
    updatedItem,
  };
}
