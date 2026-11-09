import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCurrency,
  sanitizePublicItem,
  extractOfferFromMessage,
  evaluateBuyerOffer,
  calculateSellerMargin,
  createLockedDeal,
  isDealExpired,
  calculateRemainingLockMs,
  validateAndCaptureDeal,
  DEAL_LOCK_DURATION_MS,
  type SellerItem,
} from './bargaining';

const sample50kLoafers: SellerItem = {
  id: 'item-50k-loafers',
  title: 'Handcrafted Italian Leather Loafers',
  sellerName: 'Bottega Moretti',
  origin: 'Florence, Italy',
  category: 'Footwear',
  description:
    'Full-grain calfskin loafers, hand-stitched welt, Vibram rubber half-sole. Handcrafted in Tuscany, built for timeless elegance and all-day comfort.',
  craftsmanshipNotes: '38 hours of hand-lasting and natural carnauba wax burnishing.',
  askingPrice: 50000,
  floorPrice: 40000,
  stock: 5,
  imageUrl: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=800',
  concessions: [
    'Free Tracked Express Delivery',
    'Aromatic Cedar Shoe Trees',
    'Bundle Discount on Leather Care Kit',
  ],
  featuredTag: 'Flagship Lot',
  createdAt: '2025-02-01T00:00:00.000Z',
};

test('formatCurrency outputs single dollar sign and clean formatting', () => {
  assert.equal(formatCurrency(50000), '$50,000');
  assert.equal(formatCurrency(40000), '$40,000');
  assert.equal(formatCurrency(425.5), '$425.50');
  assert.equal(formatCurrency(-10), '$0');
  assert.ok(!formatCurrency(50000).startsWith('$$'));
});

test('sanitizePublicItem strictly strips secret floorPrice from buyer payloads', () => {
  const pub = sanitizePublicItem(sample50kLoafers);
  assert.equal(pub.id, sample50kLoafers.id);
  assert.equal(pub.askingPrice, 50000);
  assert.equal('floorPrice' in pub, false);
});

test('extractOfferFromMessage parses dollar strings, k-shorthand, and explicit offers', () => {
  assert.equal(extractOfferFromMessage('Can you do $45,000 if I buy today?'), 45000);
  assert.equal(extractOfferFromMessage('How about 42k for the pair?'), 42000);
  assert.equal(extractOfferFromMessage('Tell me more about the leather', 44000), 44000);
  assert.equal(extractOfferFromMessage('What leather is used?'), null);
});

test('Rule #2: evaluateBuyerOffer rejects numerical offers below 40k floor in code BEFORE AI is called', () => {
  const lowball = evaluateBuyerOffer({
    item: sample50kLoafers,
    buyerMessage: 'I can only pay 35k right now',
    roundNumber: 1,
  });

  assert.equal(lowball.decision, 'REJECT_BELOW_FLOOR');
  assert.equal(lowball.negotiationState, 'COUNTEROFFERED');
  assert.equal(lowball.rejectedByCodeBeforeAi, true);
  assert.equal(lowball.agreedPrice, null);
  assert.ok(
    lowball.targetCounterPrice >= sample50kLoafers.floorPrice,
    `Counter price ${lowball.targetCounterPrice} must be >= floorPrice ${sample50kLoafers.floorPrice}`
  );
  assert.ok(lowball.unlockedConcessions.length >= 1);
});

test('evaluateBuyerOffer accepts strong offers above floorPrice and locks deal', () => {
  const goodOffer = evaluateBuyerOffer({
    item: sample50kLoafers,
    buyerMessage: 'Would you take $45,000?',
    roundNumber: 1,
  });

  assert.equal(goodOffer.decision, 'ACCEPT');
  assert.equal(goodOffer.negotiationState, 'ACCEPTED');
  assert.equal(goodOffer.rejectedByCodeBeforeAi, false);
  assert.equal(goodOffer.agreedPrice, 45000);
  assert.ok(goodOffer.unlockedConcessions.includes('Free Tracked Express Delivery'));

  const margin = calculateSellerMargin({
    askingPrice: sample50kLoafers.askingPrice,
    floorPrice: sample50kLoafers.floorPrice,
    agreedPrice: goodOffer.agreedPrice,
  });
  assert.equal(margin.marginKeptAmount, 5000);
  assert.equal(margin.marginKeptPercent, 50);
});

test('evaluateBuyerOffer handles explicit buyer decline with structured DECLINED state', () => {
  const declined = evaluateBuyerOffer({
    item: sample50kLoafers,
    buyerMessage: 'No thanks, I will decline for now',
    previousCounterPrice: 44000,
    roundNumber: 2,
  });

  assert.equal(declined.decision, 'DECLINE');
  assert.equal(declined.negotiationState, 'DECLINED');
  assert.equal(declined.agreedPrice, null);
});

test('15-minute deal expiry and atomic stock decrement with idempotent capture', () => {
  const startMs = 1_700_000_000_000;
  const deal = createLockedDeal({
    id: 'deal-101',
    item: sample50kLoafers,
    agreedPrice: 44000,
    unlockedConcessions: ['Free Tracked Express Delivery'],
    nowMs: startMs,
  });

  assert.equal(deal.status, 'agreed');
  assert.equal(deal.agreedPrice, 44000);
  assert.equal(deal.savingsAmount, 6000);
  assert.equal(calculateRemainingLockMs(deal, startMs + 5 * 60 * 1000), 10 * 60 * 1000);
  assert.equal(isDealExpired(deal, startMs + 14 * 60 * 1000), false);
  assert.equal(isDealExpired(deal, startMs + DEAL_LOCK_DURATION_MS + 1), true);

  // Attempting capture after 15 minutes returns HTTP 410 DEAL_EXPIRED
  const expiredAttempt = validateAndCaptureDeal({
    deal,
    item: sample50kLoafers,
    paypalOrderId: 'PAYPAL-ORD-EXP',
    idempotencyKey: 'idem-exp-1',
    nowMs: startMs + DEAL_LOCK_DURATION_MS + 5000,
  });
  assert.equal(expiredAttempt.ok, false);
  if (!expiredAttempt.ok) {
    assert.equal(expiredAttempt.httpStatus, 410);
    assert.equal(expiredAttempt.errorCode, 'DEAL_EXPIRED');
  }

  // Valid capture within 15 minutes decrements stock by 1 and sets status = 'paid'
  const validCapture = validateAndCaptureDeal({
    deal,
    item: sample50kLoafers,
    paypalOrderId: 'PAYPAL-ORD-1',
    idempotencyKey: 'idem-valid-1',
    buyerEmail: 'buyer@example.com',
    nowMs: startMs + 2 * 60 * 1000,
  });
  assert.equal(validCapture.ok, true);
  if (validCapture.ok) {
    assert.equal(validCapture.alreadyPaid, false);
    assert.equal(validCapture.updatedItem.stock, 4);
    assert.equal(validCapture.updatedDeal.status, 'paid');

    // Second capture on the same deal is idempotent and does NOT double-decrement stock
    const replayCapture = validateAndCaptureDeal({
      deal: validCapture.updatedDeal,
      item: validCapture.updatedItem,
      paypalOrderId: 'PAYPAL-ORD-1',
      idempotencyKey: 'idem-valid-1',
      nowMs: startMs + 3 * 60 * 1000,
    });
    assert.equal(replayCapture.ok, true);
    if (replayCapture.ok) {
      assert.equal(replayCapture.alreadyPaid, true);
      assert.equal(replayCapture.updatedItem.stock, 4);
    }
  }
});

test('PayPal Orders v2 repository flow preserves liveSandboxOrderId and confirms capture idempotently', async () => {
  const {
    getSellerItemById,
    lockCounterOfferOnDeal,
    createPayPalOrderInDb,
    captureAndConfirmWebhookInDb,
  } = await import('../db/repository');

  const item = await getSellerItemById('item-cognac-boot');
  assert.ok(item, 'Seeded item-cognac-boot should load');
  const initialStock = item.stock;

  const sessionId = `test-paypal-${Date.now()}`;
  const { deal: lockedDeal } = await lockCounterOfferOnDeal({
    item,
    sessionId,
  });
  assert.equal(lockedDeal.status, 'agreed');

  const liveOrderId = `5O190127TN${Date.now().toString().slice(-6)}`;
  const createdOrder = await createPayPalOrderInDb({
    dealId: lockedDeal.id,
    idempotencyKey: `idem-create-${lockedDeal.id}`,
    paypalOrderId: liveOrderId,
  });
  assert.equal(createdOrder.paypalOrderId, liveOrderId);
  assert.equal(createdOrder.deal.paypalOrderId, liveOrderId);

  const captured = await captureAndConfirmWebhookInDb({
    dealId: lockedDeal.id,
    paypalOrderId: liveOrderId,
    idempotencyKey: `idem-capture-${lockedDeal.id}`,
    buyerEmail: 'sandbox.buyer@paypal.com',
  });
  assert.equal(captured.ok, true);
  if (captured.ok) {
    assert.equal(captured.alreadyPaid, false);
    assert.equal(captured.deal.status, 'paid');
    assert.equal(captured.deal.paypalOrderId, liveOrderId);
    assert.equal(captured.item.stock, initialStock - 1);

    // Verify idempotent second capture does not decrement stock again
    const duplicateCapture = await captureAndConfirmWebhookInDb({
      dealId: lockedDeal.id,
      paypalOrderId: liveOrderId,
      idempotencyKey: `idem-capture-${lockedDeal.id}`,
      buyerEmail: 'sandbox.buyer@paypal.com',
    });
    assert.equal(duplicateCapture.ok, true);
    if (duplicateCapture.ok) {
      assert.equal(duplicateCapture.alreadyPaid, true);
      assert.equal(duplicateCapture.item.stock, initialStock - 1);
    }
  }
});

test('Live PayPal Sandbox OAuth2 and Orders v2 API integration', async () => {
  const { hasLivePayPalSandboxCredentials, getPayPalSandboxAccessToken } = await import(
    '../../server'
  );
  assert.equal(hasLivePayPalSandboxCredentials(), true);
  const token = await getPayPalSandboxAccessToken();
  assert.ok(token && token.length > 10, 'Live PayPal Sandbox OAuth token should be returned');
});
