import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq, desc, and, or } from 'drizzle-orm';
import { db, hasPostgresConfig, createPool } from './index';
import { users, sellers, items, deals, messages, payments } from './schema';
import {
  formatCurrency,
  calculateSellerMargin,
  isDealExpired,
  DEAL_LOCK_DURATION_MS,
  type SellerItem,
  type DealRecord,
  type NegotiationTurn,
  type DealStatus,
} from '../lib/bargaining';

const INITIAL_SEED_ITEMS: SellerItem[] = [
  {
    id: 'item-cognac-boot',
    title: 'Hand-Sewn Cognac Leather Ankle Boot',
    sellerName: 'Born Saddlery Studio',
    origin: 'Portland, Oregon',
    category: 'Footwear',
    description:
      'Hand-finished full-grain cognac calfskin ankle boot built with flexible Opanka hand-sewn construction, cushioned leather footbed, and stacked heel.',
    craftsmanshipNotes:
      'Stitched by hand in a single pass locking upper, sock-lining, and outsole together for zero break-in comfort.',
    askingPrice: 195,
    floorPrice: 155,
    stock: 6,
    imageUrl: '/src/assets/images/born_cognac_leather_boot_1794051636673.jpg',
    concessions: [
      'Free 2-Day Express Shipping',
      'Cedar Boot Shapers',
      'Beeswax Leather Conditioning Balm',
    ],
    featuredTag: 'Open to offers',
    createdAt: '2025-02-10T10:00:00.000Z',
  },
  {
    id: 'item-woven-sandal',
    title: 'Miami Hand-Woven Saddle Leather Sandal',
    sellerName: 'Bernardo Atelier',
    origin: 'Florence & Miami',
    category: 'Footwear',
    description:
      'Supple vegetable-tanned saddle calfskin hand-woven into a breathable arch strap over a contoured antique leather sole with solid brass buckle.',
    craftsmanshipNotes:
      'Hand-braided from 18 individual calfskin strips and lasted over a cushioned suede-lined footbed.',
    askingPrice: 168,
    floorPrice: 135,
    stock: 8,
    imageUrl: '/src/assets/images/bernardo_woven_leather_sandal_1794051637892.jpg',
    concessions: [
      'Free 2-Day Express Shipping',
      'Organic Cotton Travel Dust Bag',
      '15% Off Matching Leather Belt',
    ],
    featuredTag: 'Open to offers',
    createdAt: '2025-02-11T12:30:00.000Z',
  },
  {
    id: 'item-saddle-tote',
    title: 'Everyday Bridle Leather Crossbody Tote',
    sellerName: 'Cámara Leatherworks',
    origin: 'Austin, Texas',
    category: 'Leather Goods',
    description:
      'Structured everyday carry tote crafted from 5oz honey-tan vegetable-tanned leather with solid sand-cast brass buckles and a removable crossbody strap.',
    craftsmanshipNotes:
      'Hand-burnished edges sealed with natural beeswax and reinforced with copper rivets at every handle stress point.',
    askingPrice: 245,
    floorPrice: 195,
    stock: 4,
    imageUrl: '/src/assets/images/saddle_leather_crossbody_tote_1794051639509.jpg',
    concessions: [
      'Free 2-Day Express Shipping',
      'Free Custom Initials Monogramming',
      'Matching Leather Key Fob',
    ],
    featuredTag: 'Open to offers',
    createdAt: '2025-02-12T09:15:00.000Z',
  },
  {
    id: 'item-suede-loafer',
    title: 'Hand-Stitched Espresso Suede Penny Loafer',
    sellerName: 'Born Saddlery Studio',
    origin: 'Portland, Oregon',
    category: 'Footwear',
    description:
      'Velvety water-resistant espresso suede slip-on moccasin with hand-whipped apron stitching, breathable calfskin lining, and lightweight lugged sole.',
    craftsmanshipNotes:
      'Hand-sewn moccasin toe box shaped on a natural anatomical last for all-day walking support.',
    askingPrice: 180,
    floorPrice: 144,
    stock: 5,
    imageUrl: '/src/assets/images/handcrafted_suede_loafer_1794051640498.jpg',
    concessions: [
      'Free 2-Day Express Shipping',
      'Suede Eraser & Bristle Brush Kit',
      'Aromatic Cedar Shoe Trees',
    ],
    featuredTag: 'Open to offers',
    createdAt: '2025-02-13T11:00:00.000Z',
  },
  {
    id: 'item-stoneware-pourover',
    title: 'Wheel-Thrown Speckled Stoneware Pour-Over Set',
    sellerName: 'Keepsake Ceramics',
    origin: 'Asheville, North Carolina',
    category: 'Home & Kitchen',
    description:
      'Hand-thrown speckled stoneware V60 dripper paired with a borosilicate glass server, American walnut collar, and matching 10oz morning mug.',
    craftsmanshipNotes:
      'High-fired at Cone 6 with a food-safe satin oatmeal glaze and hand-carved interior spiral ribs for an even coffee extraction.',
    askingPrice: 95,
    floorPrice: 75,
    stock: 9,
    imageUrl: '/src/assets/images/artisan_stoneware_pour_over_1794051641641.jpg',
    concessions: [
      'Free 2-Day Express Shipping',
      '100 Unbleached Paper Filters',
      'Hand-Carved Walnut Coffee Scoop',
    ],
    featuredTag: 'Open to offers',
    createdAt: '2025-02-14T14:20:00.000Z',
  },
  {
    id: 'item-forged-knife',
    title: 'Hand-Forged 8" Damascus Chef Knife',
    sellerName: 'Alder Creek Forge',
    origin: 'Bellingham, Washington',
    category: 'Home & Kitchen',
    description:
      'All-purpose 8-inch kitchen gyuto forged from 67-layer folded Damascus steel over a high-carbon core, fitted with an octagonal roasted walnut handle.',
    craftsmanshipNotes:
      'Hand-ground on wet stones to a 15-degree mirror edge and balanced right at the pinch grip.',
    askingPrice: 285,
    floorPrice: 225,
    stock: 3,
    imageUrl: '/src/assets/images/forged_carbon_chef_knife_1794051642374.jpg',
    concessions: [
      'Free 2-Day Express Shipping',
      'Fitted Walnut Magnetic Blade Guard',
      'First Year Free Studio Sharpening',
    ],
    featuredTag: 'Open to offers',
    createdAt: '2025-02-15T16:45:00.000Z',
  },
  {
    id: 'item-merino-throw',
    title: 'Hand-Loomed Merino & Linen Throw Blanket',
    sellerName: 'Meadowloom Weavers',
    origin: 'Taunton, Vermont',
    category: 'Home & Kitchen',
    description:
      'Generously sized 54" x 76" sofa throw woven on a wooden floor loom from superfine oatmeal merino wool and warm terracotta Belgian flax linen.',
    craftsmanshipNotes:
      'Finished with hand-twisted 4-inch fringe and washed in mountain spring water for an heirloom drape.',
    askingPrice: 220,
    floorPrice: 175,
    stock: 5,
    imageUrl: '/src/assets/images/handloomed_merino_throw_1794051644653.jpg',
    concessions: [
      'Free 2-Day Express Shipping',
      'Lavender & Cedar Linen Storage Sachets',
      'Complimentary Gift Wrapping',
    ],
    featuredTag: 'Open to offers',
    createdAt: '2025-02-16T09:00:00.000Z',
  },
  {
    id: 'item-heritage-weekender',
    title: 'Chestnut Full-Grain Leather Weekender Duffel',
    sellerName: 'Cámara Leatherworks',
    origin: 'Austin, Texas',
    category: 'Leather Goods',
    description:
      'Overhead-bin cabin duffel crafted from full-grain chestnut harness leather, heavy-gauge solid brass YKK zipper, and woven cotton canvas shoulder strap.',
    craftsmanshipNotes:
      'Cut from a single matched side of drum-dyed leather with rolled grab handles and a waterproof waxed canvas lining.',
    askingPrice: 480,
    floorPrice: 390,
    stock: 0,
    imageUrl: '/src/assets/images/heritage_weekender_duffel_1794051645205.jpg',
    concessions: [
      'Free 2-Day Express Shipping',
      'Monogrammed Leather Luggage Tag',
      'Full-Size Leather Care Kit',
    ],
    featuredTag: 'Sold out',
    createdAt: '2025-02-17T11:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// ZERO-CONFIG SERVERLESS & LOCAL FALLBACK STORE (Used when Postgres is unset)
// ---------------------------------------------------------------------------
interface FallbackDealRow {
  id: string;
  itemId: string;
  itemTitle: string;
  sellerName: string;
  status: DealStatus;
  askingPrice: number;
  agreedPrice: number | null;
  floorPriceSnapshot: number;
  unlockedConcessions: string[];
  sessionId: string;
  roundNumber: number;
  currentCounterPrice: number;
  buyerEmail: string | null;
  expiresAt: number | null;
  paidAt: number | null;
  paypalOrderId: string | null;
  idempotencyKey?: string | null;
  webhookConfirmed?: boolean;
  createdAt: number;
}

interface FallbackPaymentRow {
  id: number;
  dealId: string;
  paypalOrderId: string;
  idempotencyKey: string;
  amount: number;
  status: 'CREATED' | 'CAPTURED' | 'WEBHOOK_CONFIRMED';
  webhookVerified: number;
  createdAt: string;
}

interface FallbackStoreState {
  users: Array<{ id: number; uid: string; email: string; createdAt: string }>;
  items: SellerItem[];
  deals: FallbackDealRow[];
  messages: Record<string, NegotiationTurn[]>;
  payments: FallbackPaymentRow[];
}

declare global {
  var _haggleFallbackStore: FallbackStoreState | undefined;
}

const STORE_FILE_PATH = path.join(os.tmpdir(), 'haggle-marketplace-store-v2.json');

function createInitialFallbackState(): FallbackStoreState {
  const now = Date.now();
  return {
    users: [
      {
        id: 1,
        uid: 'seed-seller-born',
        email: 'studio@bornsaddlery.com',
        createdAt: new Date().toISOString(),
      },
    ],
    items: INITIAL_SEED_ITEMS.map((item) => ({
      ...item,
      concessions: [...item.concessions],
    })),
    deals: [
      {
        id: 'deal-seed-paid-1',
        itemId: 'item-cognac-boot',
        itemTitle: 'Hand-Sewn Cognac Leather Ankle Boot',
        sellerName: 'Born Saddlery Studio',
        status: 'paid',
        askingPrice: 195,
        agreedPrice: 175,
        floorPriceSnapshot: 155,
        unlockedConcessions: ['Free 2-Day Express Shipping', 'Cedar Boot Shapers Included'],
        sessionId: 'seed-buyer-1',
        roundNumber: 2,
        currentCounterPrice: 175,
        buyerEmail: 'claire.mason@gmail.com',
        expiresAt: now - 20 * 60 * 1000,
        paidAt: now - 25 * 60 * 1000,
        paypalOrderId: 'PAYPAL-88412A',
        idempotencyKey: 'idem-seed-88412A',
        webhookConfirmed: true,
        createdAt: now - 35 * 60 * 1000,
      },
      {
        id: 'deal-seed-paid-2',
        itemId: 'item-woven-sandal',
        itemTitle: 'Miami Hand-Woven Saddle Leather Sandal',
        sellerName: 'Bernardo Atelier',
        status: 'paid',
        askingPrice: 168,
        agreedPrice: 152,
        floorPriceSnapshot: 135,
        unlockedConcessions: ['Free 2-Day Express Shipping'],
        sessionId: 'seed-buyer-2',
        roundNumber: 1,
        currentCounterPrice: 152,
        buyerEmail: 'jordan.hale@outlook.com',
        expiresAt: now - 50 * 60 * 1000,
        paidAt: now - 55 * 60 * 1000,
        paypalOrderId: 'PAYPAL-99204B',
        idempotencyKey: 'idem-seed-99204B',
        webhookConfirmed: true,
        createdAt: now - 65 * 60 * 1000,
      },
      {
        id: 'deal-seed-paid-3',
        itemId: 'item-saddle-tote',
        itemTitle: 'Everyday Bridle Leather Crossbody Tote',
        sellerName: 'Cámara Leatherworks',
        status: 'paid',
        askingPrice: 245,
        agreedPrice: 220,
        floorPriceSnapshot: 195,
        unlockedConcessions: [
          'Free 2-Day Express Shipping',
          'Free Custom Initials Monogramming',
        ],
        sessionId: 'seed-buyer-3',
        roundNumber: 2,
        currentCounterPrice: 220,
        buyerEmail: 'maya.lin@hey.com',
        expiresAt: now - 90 * 60 * 1000,
        paidAt: now - 95 * 60 * 1000,
        paypalOrderId: 'PAYPAL-77319C',
        idempotencyKey: 'idem-seed-77319C',
        webhookConfirmed: true,
        createdAt: now - 110 * 60 * 1000,
      },
    ],
    messages: {},
    payments: [
      {
        id: 1,
        dealId: 'deal-seed-paid-1',
        paypalOrderId: 'PAYPAL-88412A',
        idempotencyKey: 'idem-seed-88412A',
        amount: 175,
        status: 'WEBHOOK_CONFIRMED',
        webhookVerified: 1,
        createdAt: new Date(now - 25 * 60 * 1000).toISOString(),
      },
      {
        id: 2,
        dealId: 'deal-seed-paid-2',
        paypalOrderId: 'PAYPAL-99204B',
        idempotencyKey: 'idem-seed-99204B',
        amount: 152,
        status: 'WEBHOOK_CONFIRMED',
        webhookVerified: 1,
        createdAt: new Date(now - 55 * 60 * 1000).toISOString(),
      },
      {
        id: 3,
        dealId: 'deal-seed-paid-3',
        paypalOrderId: 'PAYPAL-77319C',
        idempotencyKey: 'idem-seed-77319C',
        amount: 220,
        status: 'WEBHOOK_CONFIRMED',
        webhookVerified: 1,
        createdAt: new Date(now - 95 * 60 * 1000).toISOString(),
      },
    ],
  };
}

function getFallbackStore(): FallbackStoreState {
  if (!global._haggleFallbackStore) {
    try {
      if (fs.existsSync(STORE_FILE_PATH)) {
        const raw = fs.readFileSync(STORE_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as FallbackStoreState;
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
          global._haggleFallbackStore = parsed;
          return global._haggleFallbackStore;
        }
      }
    } catch {
      // Ignore read errors in restricted serverless environments
    }
    global._haggleFallbackStore = createInitialFallbackState();
    persistFallbackStore();
  }
  return global._haggleFallbackStore;
}

function persistFallbackStore(): void {
  if (!global._haggleFallbackStore) return;
  try {
    fs.writeFileSync(STORE_FILE_PATH, JSON.stringify(global._haggleFallbackStore), 'utf-8');
  } catch {
    // Ignore write errors if tmpdir is restricted
  }
}

function mapFallbackDealToRecord(
  row: FallbackDealRow,
  includeSellerMargins: boolean = false
): DealRecord {
  const agreed = row.agreedPrice;
  const savingsAmount = agreed !== null ? Math.max(0, row.askingPrice - agreed) : 0;
  const savingsPercent =
    agreed !== null && row.askingPrice > 0
      ? Math.round((savingsAmount / row.askingPrice) * 100)
      : 0;

  const base: DealRecord = {
    id: row.id,
    itemId: row.itemId,
    itemTitle: row.itemTitle,
    sellerName: row.sellerName,
    askingPrice: row.askingPrice,
    agreedPrice: agreed,
    savingsAmount,
    savingsPercent,
    unlockedConcessions: [...row.unlockedConcessions],
    status: row.status,
    sessionId: row.sessionId,
    roundNumber: row.roundNumber,
    currentCounterPrice: row.currentCounterPrice,
    createdAt: Number(row.createdAt),
    expiresAt: row.expiresAt != null ? Number(row.expiresAt) : null,
    paypalOrderId: row.paypalOrderId,
    idempotencyKey: row.idempotencyKey ?? null,
    webhookConfirmed: row.webhookConfirmed ?? row.status === 'paid',
    paidAt: row.paidAt != null ? Number(row.paidAt) : null,
    buyerEmail: row.buyerEmail,
  };

  if (isDealExpired(base)) {
    base.status = 'expired';
    row.status = 'expired';
  }

  if (includeSellerMargins) {
    const margin = calculateSellerMargin({
      askingPrice: row.askingPrice,
      floorPrice: row.floorPriceSnapshot,
      agreedPrice: agreed ?? row.currentCounterPrice,
    });
    base.marginKeptAmount = margin.marginKeptAmount;
    base.marginKeptPercent = margin.marginKeptPercent;
  }

  return base;
}

// ---------------------------------------------------------------------------
// POSTGRES / FALLBACK MODE COORDINATOR
// ---------------------------------------------------------------------------
let isSeeded = false;
let useFallbackMode = !hasPostgresConfig();

function sortSellerItems(mapped: SellerItem[]): SellerItem[] {
  const seedOrder = INITIAL_SEED_ITEMS.map((i) => i.id);
  return [...mapped].sort((a, b) => {
    const aInStock = a.stock > 0 ? 1 : 0;
    const bInStock = b.stock > 0 ? 1 : 0;
    if (aInStock !== bInStock) return bInStock - aInStock;
    const aSeedIdx = seedOrder.indexOf(a.id);
    const bSeedIdx = seedOrder.indexOf(b.id);
    if (aSeedIdx !== -1 && bSeedIdx !== -1) return aSeedIdx - bSeedIdx;
    if (aSeedIdx !== -1) return 1;
    if (bSeedIdx !== -1) return -1;
    return 0;
  });
}

function mapRowToSellerItem(row: typeof items.$inferSelect): SellerItem {
  let parsedConcessions: string[] = [];
  try {
    parsedConcessions = JSON.parse(row.concessions);
  } catch {
    parsedConcessions = ['Free Tracked Express Delivery'];
  }
  return {
    id: row.id,
    sellerId: row.sellerId,
    title: row.title,
    sellerName: row.sellerName,
    origin: row.origin,
    category: (row.category as SellerItem['category']) || 'Footwear',
    description: row.description,
    craftsmanshipNotes: row.craftsmanshipNotes,
    askingPrice: row.askingPrice,
    floorPrice: row.floorPrice,
    stock: row.stock,
    imageUrl: row.imageUrl,
    concessions: parsedConcessions,
    featuredTag: row.featuredTag || undefined,
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
  };
}

function mapRowToDealRecord(
  row: typeof deals.$inferSelect,
  includeSellerMargins: boolean = false
): DealRecord {
  let unlocked: string[] = [];
  try {
    unlocked = JSON.parse(row.unlockedConcessions);
  } catch {
    unlocked = [];
  }
  const agreed = row.agreedPrice;
  const savingsAmount = agreed !== null ? Math.max(0, row.askingPrice - agreed) : 0;
  const savingsPercent =
    agreed !== null && row.askingPrice > 0
      ? Math.round((savingsAmount / row.askingPrice) * 100)
      : 0;

  const base: DealRecord = {
    id: row.id,
    itemId: row.itemId,
    itemTitle: row.itemTitle,
    sellerName: row.sellerName,
    askingPrice: row.askingPrice,
    agreedPrice: agreed,
    savingsAmount,
    savingsPercent,
    unlockedConcessions: unlocked,
    status: row.status as DealStatus,
    sessionId: row.sessionId,
    roundNumber: row.roundNumber,
    currentCounterPrice: row.currentCounterPrice,
    createdAt: Number(row.createdAt),
    expiresAt: row.expiresAt != null ? Number(row.expiresAt) : null,
    paypalOrderId: row.paypalOrderId,
    webhookConfirmed: row.status === 'paid',
    paidAt: row.paidAt != null ? Number(row.paidAt) : null,
    buyerEmail: row.buyerEmail,
  };

  if (isDealExpired(base)) {
    base.status = 'expired';
  }

  if (includeSellerMargins) {
    const margin = calculateSellerMargin({
      askingPrice: row.askingPrice,
      floorPrice: row.floorPriceSnapshot,
      agreedPrice: agreed ?? row.currentCounterPrice,
    });
    base.marginKeptAmount = margin.marginKeptAmount;
    base.marginKeptPercent = margin.marginKeptPercent;
  }

  return base;
}

export async function getOrCreateUser(uid: string, email: string) {
  if (useFallbackMode) {
    const store = getFallbackStore();
    const existing = store.users.find((u) => u.uid === uid);
    if (existing) {
      existing.email = email;
      persistFallbackStore();
      return existing;
    }
    const created = {
      id: store.users.length + 1,
      uid,
      email,
      createdAt: new Date().toISOString(),
    };
    store.users.push(created);
    persistFallbackStore();
    return created;
  }

  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.warn('Postgres unavailable in getOrCreateUser, switching to fallback store:', error);
    useFallbackMode = true;
    return getOrCreateUser(uid, email);
  }
}

export async function ensureSeeded(): Promise<void> {
  if (useFallbackMode) {
    getFallbackStore();
    isSeeded = true;
    return;
  }
  if (isSeeded) return;

  try {
    const pool = createPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sellers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name TEXT NOT NULL,
        origin TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        seller_id INTEGER REFERENCES sellers(id),
        seller_name TEXT NOT NULL,
        origin TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        craftsmanship_notes TEXT NOT NULL,
        asking_price INTEGER NOT NULL,
        floor_price INTEGER NOT NULL,
        concessions TEXT NOT NULL,
        stock INTEGER NOT NULL,
        image_url TEXT NOT NULL,
        featured_tag TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS deals (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id),
        item_title TEXT NOT NULL,
        seller_name TEXT NOT NULL,
        status TEXT NOT NULL,
        asking_price INTEGER NOT NULL,
        agreed_price INTEGER,
        floor_price_snapshot INTEGER NOT NULL,
        unlocked_concessions TEXT NOT NULL,
        session_id TEXT NOT NULL,
        round_number INTEGER NOT NULL DEFAULT 0,
        current_counter_price INTEGER NOT NULL,
        buyer_email TEXT,
        expires_at BIGINT,
        paid_at BIGINT,
        paypal_order_id TEXT,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES deals(id),
        sender TEXT NOT NULL,
        message TEXT NOT NULL,
        offered_price INTEGER,
        counter_price INTEGER,
        unlocked_concessions TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        deal_id TEXT NOT NULL REFERENCES deals(id),
        paypal_order_id TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL,
        webhook_verified INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    const existingItems = await db.select().from(items);
    const hasCurrentSeed = existingItems.some((i) => i.id === 'item-cognac-boot');
    if (existingItems.length > 0 && hasCurrentSeed) {
      isSeeded = true;
      return;
    }

    if (existingItems.length > 0 && !hasCurrentSeed) {
      await db.delete(payments);
      await db.delete(messages);
      await db.delete(deals);
      await db.delete(items);
    }

    const seedUser = await getOrCreateUser('seed-seller-born', 'studio@bornsaddlery.com');

    const insertedSellers = await db
      .insert(sellers)
      .values({
        userId: seedUser.id,
        name: 'Born Saddlery Studio',
        origin: 'Portland, Oregon',
      })
      .returning();

    const sellerId = insertedSellers[0]?.id ?? null;

    for (const item of INITIAL_SEED_ITEMS) {
      await db
        .insert(items)
        .values({
          id: item.id,
          sellerId,
          sellerName: item.sellerName,
          origin: item.origin,
          category: item.category,
          title: item.title,
          description: item.description,
          craftsmanshipNotes: item.craftsmanshipNotes,
          askingPrice: item.askingPrice,
          floorPrice: item.floorPrice,
          concessions: JSON.stringify(item.concessions),
          stock: item.stock,
          imageUrl: item.imageUrl,
          featuredTag: item.featuredTag || null,
        })
        .onConflictDoNothing();
    }

    const now = Date.now();
    await db
      .insert(deals)
      .values([
        {
          id: 'deal-seed-paid-1',
          itemId: 'item-cognac-boot',
          itemTitle: 'Hand-Sewn Cognac Leather Ankle Boot',
          sellerName: 'Born Saddlery Studio',
          status: 'paid',
          askingPrice: 195,
          agreedPrice: 175,
          floorPriceSnapshot: 155,
          unlockedConcessions: JSON.stringify([
            'Free 2-Day Express Shipping',
            'Cedar Boot Shapers Included',
          ]),
          sessionId: 'seed-buyer-1',
          roundNumber: 2,
          currentCounterPrice: 175,
          buyerEmail: 'claire.mason@gmail.com',
          expiresAt: now - 20 * 60 * 1000,
          paidAt: now - 25 * 60 * 1000,
          paypalOrderId: 'PAYPAL-88412A',
          createdAt: now - 35 * 60 * 1000,
        },
        {
          id: 'deal-seed-paid-2',
          itemId: 'item-woven-sandal',
          itemTitle: 'Miami Hand-Woven Saddle Leather Sandal',
          sellerName: 'Bernardo Atelier',
          status: 'paid',
          askingPrice: 168,
          agreedPrice: 152,
          floorPriceSnapshot: 135,
          unlockedConcessions: JSON.stringify(['Free 2-Day Express Shipping']),
          sessionId: 'seed-buyer-2',
          roundNumber: 1,
          currentCounterPrice: 152,
          buyerEmail: 'jordan.hale@outlook.com',
          expiresAt: now - 50 * 60 * 1000,
          paidAt: now - 55 * 60 * 1000,
          paypalOrderId: 'PAYPAL-99204B',
          createdAt: now - 65 * 60 * 1000,
        },
        {
          id: 'deal-seed-paid-3',
          itemId: 'item-saddle-tote',
          itemTitle: 'Everyday Bridle Leather Crossbody Tote',
          sellerName: 'Cámara Leatherworks',
          status: 'paid',
          askingPrice: 245,
          agreedPrice: 220,
          floorPriceSnapshot: 195,
          unlockedConcessions: JSON.stringify([
            'Free 2-Day Express Shipping',
            'Free Custom Initials Monogramming',
          ]),
          sessionId: 'seed-buyer-3',
          roundNumber: 2,
          currentCounterPrice: 220,
          buyerEmail: 'maya.lin@hey.com',
          expiresAt: now - 90 * 60 * 1000,
          paidAt: now - 95 * 60 * 1000,
          paypalOrderId: 'PAYPAL-77319C',
          createdAt: now - 110 * 60 * 1000,
        },
      ])
      .onConflictDoNothing();

    isSeeded = true;
  } catch (error) {
    console.warn('Postgres connection failed during seed; activating zero-config fallback store:', error);
    useFallbackMode = true;
    getFallbackStore();
    isSeeded = true;
  }
}

export async function listAllSellerItems(): Promise<SellerItem[]> {
  await ensureSeeded();
  if (useFallbackMode) {
    const store = getFallbackStore();
    return sortSellerItems(store.items);
  }

  try {
    const rows = await db.select().from(items).orderBy(desc(items.createdAt));
    return sortSellerItems(rows.map(mapRowToSellerItem));
  } catch (error) {
    console.warn('Error listing items from Postgres, falling back:', error);
    useFallbackMode = true;
    return sortSellerItems(getFallbackStore().items);
  }
}

export async function getSellerItemById(id: string): Promise<SellerItem | null> {
  await ensureSeeded();
  if (useFallbackMode) {
    const found = getFallbackStore().items.find((i) => i.id === id);
    return found ? { ...found, concessions: [...found.concessions] } : null;
  }

  try {
    const rows = await db.select().from(items).where(eq(items.id, id));
    if (rows.length === 0) return null;
    return mapRowToSellerItem(rows[0]);
  } catch (error) {
    console.warn('Error fetching item by id from Postgres, falling back:', error);
    useFallbackMode = true;
    return getSellerItemById(id);
  }
}

export async function getOrCreateNegotiationDeal(
  item: SellerItem,
  sessionId: string
): Promise<{
  deal: DealRecord;
  turns: NegotiationTurn[];
}> {
  await ensureSeeded();
  const compactWelcome = `Authorized by ${item.sellerName}. Listed at ${formatCurrency(item.askingPrice)} — tap an offer below or name your price to lock a 15-minute deal.`;
  const welcomeText = `Listed at ${formatCurrency(item.askingPrice)} — tap an offer below or name your price to lock a 15-minute deal.`;

  if (useFallbackMode) {
    const store = getFallbackStore();
    const activeExisting = store.deals
      .filter((d) => d.itemId === item.id && d.sessionId === sessionId && d.status !== 'cancelled')
      .sort((a, b) => b.createdAt - a.createdAt);

    if (activeExisting.length > 0) {
      const latest = activeExisting[0];
      const msgList = store.messages[latest.id] || [];
      const turns: NegotiationTurn[] = msgList.map((m) => ({
        ...m,
        message: m.id.startsWith('msg-init-') ? compactWelcome : m.message,
      }));
      return {
        deal: mapFallbackDealToRecord(latest, false),
        turns,
      };
    }

    const now = Date.now();
    const dealId = `deal-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const initialMsgId = `msg-init-${now}`;
    const newDeal: FallbackDealRow = {
      id: dealId,
      itemId: item.id,
      itemTitle: item.title,
      sellerName: item.sellerName,
      status: 'negotiating',
      askingPrice: item.askingPrice,
      agreedPrice: null,
      floorPriceSnapshot: item.floorPrice,
      unlockedConcessions: [],
      sessionId,
      roundNumber: 0,
      currentCounterPrice: item.askingPrice,
      buyerEmail: null,
      expiresAt: null,
      paidAt: null,
      paypalOrderId: null,
      createdAt: now,
    };
    const initialTurn: NegotiationTurn = {
      id: initialMsgId,
      sender: 'agent',
      message: welcomeText,
      counterPrice: item.askingPrice,
      unlockedConcessions: [],
      timestamp: new Date().toISOString(),
    };
    store.deals.unshift(newDeal);
    store.messages[dealId] = [initialTurn];
    persistFallbackStore();
    return {
      deal: mapFallbackDealToRecord(newDeal, false),
      turns: [initialTurn],
    };
  }

  try {
    const existingDeals = await db
      .select()
      .from(deals)
      .where(and(eq(deals.itemId, item.id), eq(deals.sessionId, sessionId)))
      .orderBy(desc(deals.createdAt));

    const activeExisting = existingDeals.filter((d) => d.status !== 'cancelled');
    if (activeExisting.length > 0) {
      const latest = activeExisting[0];
      const msgRows = await db
        .select()
        .from(messages)
        .where(eq(messages.dealId, latest.id));

      const turns: NegotiationTurn[] = msgRows.map((m) => ({
        id: m.id,
        sender: m.sender as NegotiationTurn['sender'],
        message: m.id.startsWith('msg-init-') ? compactWelcome : m.message,
        offeredPrice: m.offeredPrice ?? undefined,
        counterPrice: m.counterPrice ?? undefined,
        unlockedConcessions: m.unlockedConcessions ? JSON.parse(m.unlockedConcessions) : undefined,
        timestamp: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
      }));

      return {
        deal: mapRowToDealRecord(latest, false),
        turns,
      };
    }

    const now = Date.now();
    const dealId = `deal-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const initialMsgId = `msg-init-${now}`;

    await db.insert(deals).values({
      id: dealId,
      itemId: item.id,
      itemTitle: item.title,
      sellerName: item.sellerName,
      status: 'negotiating',
      askingPrice: item.askingPrice,
      agreedPrice: null,
      floorPriceSnapshot: item.floorPrice,
      unlockedConcessions: JSON.stringify([]),
      sessionId,
      roundNumber: 0,
      currentCounterPrice: item.askingPrice,
      createdAt: now,
    });

    await db.insert(messages).values({
      id: initialMsgId,
      dealId,
      sender: 'agent',
      message: welcomeText,
      counterPrice: item.askingPrice,
      unlockedConcessions: JSON.stringify([]),
    });

    const createdRows = await db.select().from(deals).where(eq(deals.id, dealId));
    return {
      deal: mapRowToDealRecord(createdRows[0], false),
      turns: [
        {
          id: initialMsgId,
          sender: 'agent',
          message: welcomeText,
          counterPrice: item.askingPrice,
          unlockedConcessions: [],
          timestamp: new Date().toISOString(),
        },
      ],
    };
  } catch (error) {
    console.warn('Error in getOrCreateNegotiationDeal, falling back:', error);
    useFallbackMode = true;
    return getOrCreateNegotiationDeal(item, sessionId);
  }
}

export async function resetNegotiationSession(item: SellerItem, sessionId: string) {
  await ensureSeeded();
  if (useFallbackMode) {
    const store = getFallbackStore();
    for (const d of store.deals) {
      if (d.itemId === item.id && d.sessionId === sessionId) {
        d.status = 'cancelled';
      }
    }
    persistFallbackStore();
    return getOrCreateNegotiationDeal(item, sessionId);
  }

  try {
    const existingDeals = await db
      .select()
      .from(deals)
      .where(and(eq(deals.itemId, item.id), eq(deals.sessionId, sessionId)));

    for (const d of existingDeals) {
      await db
        .update(deals)
        .set({ status: 'cancelled' })
        .where(eq(deals.id, d.id));
    }

    return await getOrCreateNegotiationDeal(item, sessionId);
  } catch (error) {
    console.warn('Error resetting negotiation session, falling back:', error);
    useFallbackMode = true;
    return resetNegotiationSession(item, sessionId);
  }
}

export async function recordNegotiationRound(params: {
  dealId: string;
  roundNumber: number;
  buyerMessage: string;
  extractedBuyerOffer: number | null;
  agentReply: string;
  targetCounterPrice: number;
  agreedPrice: number | null;
  unlockedConcessions: string[];
}): Promise<{
  deal: DealRecord;
  turns: NegotiationTurn[];
}> {
  await ensureSeeded();
  const now = Date.now();

  if (useFallbackMode) {
    const store = getFallbackStore();
    const dealRow = store.deals.find((d) => d.id === params.dealId);
    if (!dealRow) {
      throw new Error('Deal session not found');
    }

    const buyerTurn: NegotiationTurn = {
      id: `msg-buyer-${now}`,
      sender: 'buyer',
      message: params.buyerMessage,
      offeredPrice: params.extractedBuyerOffer ?? undefined,
      timestamp: new Date(now).toISOString(),
    };
    const agentTurn: NegotiationTurn = {
      id: `msg-agent-${now + 1}`,
      sender: 'agent',
      message: params.agentReply,
      counterPrice: params.agreedPrice ?? params.targetCounterPrice,
      unlockedConcessions: [...params.unlockedConcessions],
      timestamp: new Date(now + 1).toISOString(),
    };

    if (!store.messages[params.dealId]) {
      store.messages[params.dealId] = [];
    }
    store.messages[params.dealId].push(buyerTurn, agentTurn);

    const isAgreed = params.agreedPrice !== null;
    dealRow.roundNumber = params.roundNumber;
    dealRow.currentCounterPrice = params.targetCounterPrice;
    dealRow.unlockedConcessions = [...params.unlockedConcessions];
    dealRow.status = isAgreed ? 'agreed' : 'negotiating';
    dealRow.agreedPrice = params.agreedPrice;
    dealRow.expiresAt = isAgreed ? now + DEAL_LOCK_DURATION_MS : null;

    persistFallbackStore();
    return {
      deal: mapFallbackDealToRecord(dealRow, false),
      turns: store.messages[params.dealId],
    };
  }

  try {
    await db.insert(messages).values({
      id: `msg-buyer-${now}`,
      dealId: params.dealId,
      sender: 'buyer',
      message: params.buyerMessage,
      offeredPrice: params.extractedBuyerOffer,
    });

    await db.insert(messages).values({
      id: `msg-agent-${now + 1}`,
      dealId: params.dealId,
      sender: 'agent',
      message: params.agentReply,
      counterPrice: params.agreedPrice ?? params.targetCounterPrice,
      unlockedConcessions: JSON.stringify(params.unlockedConcessions),
    });

    const isAgreed = params.agreedPrice !== null;
    await db
      .update(deals)
      .set({
        roundNumber: params.roundNumber,
        currentCounterPrice: params.targetCounterPrice,
        unlockedConcessions: JSON.stringify(params.unlockedConcessions),
        status: isAgreed ? 'agreed' : 'negotiating',
        agreedPrice: params.agreedPrice,
        expiresAt: isAgreed ? now + DEAL_LOCK_DURATION_MS : null,
      })
      .where(eq(deals.id, params.dealId));

    const updatedDealRows = await db.select().from(deals).where(eq(deals.id, params.dealId));
    const msgRows = await db.select().from(messages).where(eq(messages.dealId, params.dealId));

    const turns: NegotiationTurn[] = msgRows.map((m) => ({
      id: m.id,
      sender: m.sender as NegotiationTurn['sender'],
      message: m.message,
      offeredPrice: m.offeredPrice ?? undefined,
      counterPrice: m.counterPrice ?? undefined,
      unlockedConcessions: m.unlockedConcessions ? JSON.parse(m.unlockedConcessions) : undefined,
      timestamp: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
    }));

    return {
      deal: mapRowToDealRecord(updatedDealRows[0], false),
      turns,
    };
  } catch (error) {
    console.warn('Error recording negotiation round in Postgres, falling back:', error);
    useFallbackMode = true;
    return recordNegotiationRound(params);
  }
}

export async function lockCounterOfferOnDeal(params: {
  item: SellerItem;
  sessionId: string;
}): Promise<{
  deal: DealRecord;
  turns: NegotiationTurn[];
}> {
  await ensureSeeded();
  const { deal } = await getOrCreateNegotiationDeal(params.item, params.sessionId);
  const now = Date.now();
  const agreedPrice = Math.max(
    params.item.floorPrice,
    deal.currentCounterPrice || params.item.askingPrice
  );
  const concessions =
    deal.unlockedConcessions.length > 0
      ? deal.unlockedConcessions
      : params.item.concessions.slice(0, 1);

  if (useFallbackMode) {
    const store = getFallbackStore();
    const dealRow = store.deals.find((d) => d.id === deal.id);
    if (!dealRow) {
      throw new Error('Deal not found');
    }
    dealRow.status = 'agreed';
    dealRow.agreedPrice = agreedPrice;
    dealRow.unlockedConcessions = [...concessions];
    dealRow.expiresAt = now + DEAL_LOCK_DURATION_MS;

    const lockTurn: NegotiationTurn = {
      id: `msg-lock-${now}`,
      sender: 'system',
      message: `Deal locked at ${formatCurrency(agreedPrice)} with ${concessions.join(' + ')}. Price guaranteed for 15 minutes.`,
      counterPrice: agreedPrice,
      unlockedConcessions: [...concessions],
      timestamp: new Date(now).toISOString(),
    };
    if (!store.messages[deal.id]) {
      store.messages[deal.id] = [];
    }
    store.messages[deal.id].push(lockTurn);
    persistFallbackStore();

    return {
      deal: mapFallbackDealToRecord(dealRow, false),
      turns: store.messages[deal.id],
    };
  }

  try {
    await db
      .update(deals)
      .set({
        status: 'agreed',
        agreedPrice,
        unlockedConcessions: JSON.stringify(concessions),
        expiresAt: now + DEAL_LOCK_DURATION_MS,
      })
      .where(eq(deals.id, deal.id));

    await db.insert(messages).values({
      id: `msg-lock-${now}`,
      dealId: deal.id,
      sender: 'system',
      message: `Deal locked at ${formatCurrency(agreedPrice)} with ${concessions.join(' + ')}. Price guaranteed for 15 minutes.`,
      counterPrice: agreedPrice,
      unlockedConcessions: JSON.stringify(concessions),
    });

    const updatedDealRows = await db.select().from(deals).where(eq(deals.id, deal.id));
    const msgRows = await db.select().from(messages).where(eq(messages.dealId, deal.id));

    return {
      deal: mapRowToDealRecord(updatedDealRows[0], false),
      turns: msgRows.map((m) => ({
        id: m.id,
        sender: m.sender as NegotiationTurn['sender'],
        message: m.message,
        offeredPrice: m.offeredPrice ?? undefined,
        counterPrice: m.counterPrice ?? undefined,
        unlockedConcessions: m.unlockedConcessions ? JSON.parse(m.unlockedConcessions) : undefined,
        timestamp: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
      })),
    };
  } catch (error) {
    console.warn('Error locking counter offer in Postgres, falling back:', error);
    useFallbackMode = true;
    return lockCounterOfferOnDeal(params);
  }
}

export async function getDealById(dealId: string): Promise<DealRecord | null> {
  await ensureSeeded();
  if (useFallbackMode) {
    const store = getFallbackStore();
    const row = store.deals.find((d) => d.id === dealId);
    if (!row) return null;
    const record = mapFallbackDealToRecord(row, false);
    persistFallbackStore();
    return record;
  }

  try {
    const rows = await db.select().from(deals).where(eq(deals.id, dealId));
    if (rows.length === 0) return null;
    const record = mapRowToDealRecord(rows[0], false);
    if (record.status === 'expired' && rows[0].status !== 'expired') {
      await db.update(deals).set({ status: 'expired' }).where(eq(deals.id, dealId));
    }
    return record;
  } catch (error) {
    console.warn('Error fetching deal by id from Postgres, falling back:', error);
    useFallbackMode = true;
    return getDealById(dealId);
  }
}

export async function createPayPalOrderInDb(params: {
  dealId: string;
  idempotencyKey: string;
  paypalOrderId?: string | null;
}): Promise<{
  paypalOrderId: string;
  idempotencyKey: string;
  deal: DealRecord;
}> {
  await ensureSeeded();
  if (useFallbackMode) {
    const store = getFallbackStore();
    const dealRow = store.deals.find((d) => d.id === params.dealId);
    if (!dealRow) {
      throw new Error('DEAL_NOT_FOUND');
    }

    const existingPayment = store.payments.find(
      (p) => p.idempotencyKey === params.idempotencyKey
    );
    if (existingPayment) {
      const targetOrderId = params.paypalOrderId || existingPayment.paypalOrderId;
      existingPayment.paypalOrderId = targetOrderId;
      dealRow.paypalOrderId = targetOrderId;
      dealRow.idempotencyKey = existingPayment.idempotencyKey;
      persistFallbackStore();
      return {
        paypalOrderId: targetOrderId,
        idempotencyKey: existingPayment.idempotencyKey,
        deal: mapFallbackDealToRecord(dealRow, false),
      };
    }

    const paypalOrderId =
      params.paypalOrderId ||
      dealRow.paypalOrderId ||
      `PAYPAL-V2-${Date.now().toString(36).toUpperCase()}`;

    store.payments.push({
      id: store.payments.length + 1,
      dealId: dealRow.id,
      paypalOrderId,
      idempotencyKey: params.idempotencyKey,
      amount: dealRow.agreedPrice ?? dealRow.askingPrice,
      status: 'CREATED',
      webhookVerified: 0,
      createdAt: new Date().toISOString(),
    });

    dealRow.paypalOrderId = paypalOrderId;
    dealRow.idempotencyKey = params.idempotencyKey;
    persistFallbackStore();

    return {
      paypalOrderId,
      idempotencyKey: params.idempotencyKey,
      deal: mapFallbackDealToRecord(dealRow, false),
    };
  }

  try {
    const existingPaymentByIdem = await db
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, params.idempotencyKey));

    const dealRows = await db.select().from(deals).where(eq(deals.id, params.dealId));
    if (dealRows.length === 0) {
      throw new Error('DEAL_NOT_FOUND');
    }
    const dealRecord = mapRowToDealRecord(dealRows[0], false);

    if (existingPaymentByIdem.length > 0) {
      const resolvedOrderId = params.paypalOrderId || existingPaymentByIdem[0].paypalOrderId;
      if (params.paypalOrderId && existingPaymentByIdem[0].paypalOrderId !== params.paypalOrderId) {
        await db
          .update(payments)
          .set({ paypalOrderId: params.paypalOrderId })
          .where(eq(payments.id, existingPaymentByIdem[0].id));
        await db
          .update(deals)
          .set({ paypalOrderId: params.paypalOrderId })
          .where(eq(deals.id, dealRecord.id));
      }
      return {
        paypalOrderId: resolvedOrderId,
        idempotencyKey: existingPaymentByIdem[0].idempotencyKey,
        deal: {
          ...dealRecord,
          paypalOrderId: resolvedOrderId,
          idempotencyKey: existingPaymentByIdem[0].idempotencyKey,
        },
      };
    }

    const paypalOrderId =
      params.paypalOrderId ||
      dealRecord.paypalOrderId ||
      `PAYPAL-V2-${Date.now().toString(36).toUpperCase()}`;

    await db
      .insert(payments)
      .values({
        dealId: dealRecord.id,
        paypalOrderId,
        idempotencyKey: params.idempotencyKey,
        amount: dealRecord.agreedPrice ?? dealRecord.askingPrice,
        status: 'CREATED',
        webhookVerified: 0,
      })
      .onConflictDoNothing();

    await db
      .update(deals)
      .set({ paypalOrderId })
      .where(eq(deals.id, dealRecord.id));

    return {
      paypalOrderId,
      idempotencyKey: params.idempotencyKey,
      deal: { ...dealRecord, paypalOrderId, idempotencyKey: params.idempotencyKey },
    };
  } catch (error) {
    console.warn('Error creating PayPal order record in Postgres, falling back:', error);
    useFallbackMode = true;
    return createPayPalOrderInDb(params);
  }
}

export async function captureAndConfirmWebhookInDb(params: {
  dealId: string;
  paypalOrderId: string;
  idempotencyKey: string;
  buyerEmail?: string;
}): Promise<
  | {
      ok: true;
      alreadyPaid: boolean;
      deal: DealRecord;
      item: SellerItem;
    }
  | {
      ok: false;
      httpStatus: 400 | 404 | 409 | 410;
      errorCode: 'DEAL_EXPIRED' | 'OUT_OF_STOCK' | 'INVALID_DEAL';
      message: string;
    }
> {
  await ensureSeeded();
  if (useFallbackMode) {
    const store = getFallbackStore();
    const dealRow = store.deals.find((d) => d.id === params.dealId);
    if (!dealRow) {
      return {
        ok: false,
        httpStatus: 404,
        errorCode: 'INVALID_DEAL',
        message: 'Deal record not found.',
      };
    }

    const itemRow = store.items.find((i) => i.id === dealRow.itemId);
    if (!itemRow) {
      return {
        ok: false,
        httpStatus: 404,
        errorCode: 'INVALID_DEAL',
        message: 'Item not found.',
      };
    }

    const dealRecord = mapFallbackDealToRecord(dealRow, false);

    if (dealRecord.status === 'paid') {
      return {
        ok: true,
        alreadyPaid: true,
        deal: dealRecord,
        item: { ...itemRow, concessions: [...itemRow.concessions] },
      };
    }

    if (isDealExpired(dealRecord)) {
      dealRow.status = 'expired';
      persistFallbackStore();
      return {
        ok: false,
        httpStatus: 410,
        errorCode: 'DEAL_EXPIRED',
        message:
          'This 15-minute price lock has expired. Expired deals cannot be paid — please lock a new offer.',
      };
    }

    if (itemRow.stock <= 0) {
      return {
        ok: false,
        httpStatus: 409,
        errorCode: 'OUT_OF_STOCK',
        message: 'This artisan piece is out of stock.',
      };
    }

    const now = Date.now();
    itemRow.stock = Math.max(0, itemRow.stock - 1);

    const paymentRow = store.payments.find(
      (p) => p.paypalOrderId === params.paypalOrderId || p.dealId === dealRow.id
    );
    if (paymentRow) {
      paymentRow.paypalOrderId = params.paypalOrderId;
      paymentRow.status = 'WEBHOOK_CONFIRMED';
      paymentRow.webhookVerified = 1;
    } else {
      store.payments.push({
        id: store.payments.length + 1,
        dealId: dealRow.id,
        paypalOrderId: params.paypalOrderId,
        idempotencyKey: params.idempotencyKey,
        amount: dealRow.agreedPrice ?? dealRow.askingPrice,
        status: 'WEBHOOK_CONFIRMED',
        webhookVerified: 1,
        createdAt: new Date(now).toISOString(),
      });
    }

    dealRow.status = 'paid';
    dealRow.paypalOrderId = params.paypalOrderId;
    dealRow.idempotencyKey = params.idempotencyKey;
    dealRow.webhookConfirmed = true;
    dealRow.paidAt = now;
    dealRow.buyerEmail = params.buyerEmail || 'collector@haggle.market';

    persistFallbackStore();

    return {
      ok: true,
      alreadyPaid: false,
      deal: mapFallbackDealToRecord(dealRow, false),
      item: { ...itemRow, concessions: [...itemRow.concessions] },
    };
  }

  try {
    const dealRows = await db.select().from(deals).where(eq(deals.id, params.dealId));
    if (dealRows.length === 0) {
      return {
        ok: false,
        httpStatus: 404,
        errorCode: 'INVALID_DEAL',
        message: 'Deal record not found.',
      };
    }

    const dealRecord = mapRowToDealRecord(dealRows[0], false);
    const item = await getSellerItemById(dealRecord.itemId);
    if (!item) {
      return {
        ok: false,
        httpStatus: 404,
        errorCode: 'INVALID_DEAL',
        message: 'Item not found.',
      };
    }

    if (dealRecord.status === 'paid') {
      return {
        ok: true,
        alreadyPaid: true,
        deal: dealRecord,
        item,
      };
    }

    if (isDealExpired(dealRecord)) {
      await db.update(deals).set({ status: 'expired' }).where(eq(deals.id, dealRecord.id));
      return {
        ok: false,
        httpStatus: 410,
        errorCode: 'DEAL_EXPIRED',
        message:
          'This 15-minute price lock has expired. Expired deals cannot be paid — please lock a new offer.',
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

    const now = Date.now();
    const newStock = Math.max(0, item.stock - 1);

    // 1. Update payment record with capture + webhook confirmation (match by orderId OR dealId)
    await db
      .update(payments)
      .set({
        paypalOrderId: params.paypalOrderId,
        status: 'WEBHOOK_CONFIRMED',
        webhookVerified: 1,
      })
      .where(
        or(
          eq(payments.paypalOrderId, params.paypalOrderId),
          eq(payments.dealId, dealRecord.id)
        )
      );

    // 2. Atomically decrement stock after capture + webhook verification
    await db
      .update(items)
      .set({ stock: newStock })
      .where(eq(items.id, item.id));

    // 3. Mark deal as 'paid'
    await db
      .update(deals)
      .set({
        status: 'paid',
        paypalOrderId: params.paypalOrderId,
        paidAt: now,
        buyerEmail: params.buyerEmail || 'collector@haggle.market',
      })
      .where(eq(deals.id, dealRecord.id));

    const updatedDealRows = await db.select().from(deals).where(eq(deals.id, dealRecord.id));
    const updatedItem = await getSellerItemById(item.id);

    return {
      ok: true,
      alreadyPaid: false,
      deal: {
        ...mapRowToDealRecord(updatedDealRows[0], false),
        idempotencyKey: params.idempotencyKey,
        webhookConfirmed: true,
      },
      item: updatedItem || { ...item, stock: newStock },
    };
  } catch (error) {
    console.warn('Error capturing PayPal order in Postgres, falling back:', error);
    useFallbackMode = true;
    return captureAndConfirmWebhookInDb(params);
  }
}

export async function listAllSellerDealsWithMargins(): Promise<DealRecord[]> {
  await ensureSeeded();
  if (useFallbackMode) {
    const store = getFallbackStore();
    return [...store.deals]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => mapFallbackDealToRecord(r, true));
  }

  try {
    const rows = await db.select().from(deals).orderBy(desc(deals.createdAt));
    return rows.map((r) => mapRowToDealRecord(r, true));
  } catch (error) {
    console.warn('Error listing seller deals from Postgres, falling back:', error);
    useFallbackMode = true;
    return listAllSellerDealsWithMargins();
  }
}

export async function createSellerItemInDb(input: {
  title: string;
  sellerName: string;
  origin: string;
  category: SellerItem['category'];
  description: string;
  craftsmanshipNotes: string;
  askingPrice: number;
  floorPrice: number;
  stock: number;
  imageUrl: string;
  concessions: string[];
  featuredTag?: string;
}): Promise<SellerItem> {
  await ensureSeeded();
  const id = `item-${Date.now().toString(36)}`;

  if (useFallbackMode) {
    const store = getFallbackStore();
    const created: SellerItem = {
      id,
      sellerName: input.sellerName,
      origin: input.origin,
      category: input.category,
      title: input.title,
      description: input.description,
      craftsmanshipNotes: input.craftsmanshipNotes,
      askingPrice: input.askingPrice,
      floorPrice: input.floorPrice,
      concessions: [...input.concessions],
      stock: input.stock,
      imageUrl: input.imageUrl,
      featuredTag: input.featuredTag || 'New Lot',
      createdAt: new Date().toISOString(),
    };
    store.items.unshift(created);
    persistFallbackStore();
    return created;
  }

  try {
    const inserted = await db
      .insert(items)
      .values({
        id,
        sellerName: input.sellerName,
        origin: input.origin,
        category: input.category,
        title: input.title,
        description: input.description,
        craftsmanshipNotes: input.craftsmanshipNotes,
        askingPrice: input.askingPrice,
        floorPrice: input.floorPrice,
        concessions: JSON.stringify(input.concessions),
        stock: input.stock,
        imageUrl: input.imageUrl,
        featuredTag: input.featuredTag || 'New Lot',
      })
      .returning();

    return mapRowToSellerItem(inserted[0]);
  } catch (error) {
    console.warn('Error creating seller item in Postgres, falling back:', error);
    useFallbackMode = true;
    return createSellerItemInDb(input);
  }
}

export async function updateSellerItemInDb(
  id: string,
  updates: {
    title?: string;
    askingPrice: number;
    floorPrice: number;
    stock: number;
    concessions?: string[];
  }
): Promise<SellerItem | null> {
  await ensureSeeded();
  if (useFallbackMode) {
    const store = getFallbackStore();
    const existing = store.items.find((i) => i.id === id);
    if (!existing) return null;
    existing.title = updates.title ?? existing.title;
    existing.askingPrice = updates.askingPrice;
    existing.floorPrice = updates.floorPrice;
    existing.stock = updates.stock;
    if (updates.concessions) {
      existing.concessions = [...updates.concessions];
    }
    persistFallbackStore();
    return { ...existing, concessions: [...existing.concessions] };
  }

  try {
    const existing = await getSellerItemById(id);
    if (!existing) return null;

    const updatedRows = await db
      .update(items)
      .set({
        title: updates.title ?? existing.title,
        askingPrice: updates.askingPrice,
        floorPrice: updates.floorPrice,
        stock: updates.stock,
        concessions: updates.concessions
          ? JSON.stringify(updates.concessions)
          : JSON.stringify(existing.concessions),
      })
      .where(eq(items.id, id))
      .returning();

    return mapRowToSellerItem(updatedRows[0]);
  } catch (error) {
    console.warn('Error updating seller item in Postgres, falling back:', error);
    useFallbackMode = true;
    return updateSellerItemInDb(id, updates);
  }
}

export async function resetCatalogInDb(): Promise<SellerItem[]> {
  await ensureSeeded();
  if (useFallbackMode) {
    const store = getFallbackStore();
    const existingNonSeed = store.items.filter(
      (item) => !INITIAL_SEED_ITEMS.some((seed) => seed.id === item.id)
    );
    store.items = [
      ...INITIAL_SEED_ITEMS.map((seed) => ({
        ...seed,
        concessions: [...seed.concessions],
      })),
      ...existingNonSeed,
    ];
    persistFallbackStore();
    return sortSellerItems(store.items);
  }

  try {
    for (const seed of INITIAL_SEED_ITEMS) {
      await db
        .insert(items)
        .values({
          id: seed.id,
          sellerName: seed.sellerName,
          origin: seed.origin,
          category: seed.category,
          title: seed.title,
          description: seed.description,
          craftsmanshipNotes: seed.craftsmanshipNotes,
          askingPrice: seed.askingPrice,
          floorPrice: seed.floorPrice,
          concessions: JSON.stringify(seed.concessions),
          stock: seed.stock,
          imageUrl: seed.imageUrl,
          featuredTag: seed.featuredTag || null,
        })
        .onConflictDoUpdate({
          target: items.id,
          set: {
            askingPrice: seed.askingPrice,
            floorPrice: seed.floorPrice,
            stock: seed.stock,
            imageUrl: seed.imageUrl,
            concessions: JSON.stringify(seed.concessions),
          },
        });
    }
    return await listAllSellerItems();
  } catch (error) {
    console.warn('Error resetting catalog in Postgres, falling back:', error);
    useFallbackMode = true;
    return resetCatalogInDb();
  }
}
