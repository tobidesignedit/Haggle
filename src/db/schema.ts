import { relations } from 'drizzle-orm';
import { bigint, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const sellers = pgTable('sellers', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  name: text('name').notNull(),
  origin: text('origin').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const items = pgTable('items', {
  id: text('id').primaryKey(),
  sellerId: integer('seller_id').references(() => sellers.id),
  sellerName: text('seller_name').notNull(),
  origin: text('origin').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  craftsmanshipNotes: text('craftsmanship_notes').notNull(),
  askingPrice: integer('asking_price').notNull(),
  floorPrice: integer('floor_price').notNull(),
  concessions: text('concessions').notNull(), // JSON array of pre-approved strings
  stock: integer('stock').notNull(),
  imageUrl: text('image_url').notNull(),
  featuredTag: text('featured_tag'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const deals = pgTable('deals', {
  id: text('id').primaryKey(),
  itemId: text('item_id')
    .references(() => items.id)
    .notNull(),
  itemTitle: text('item_title').notNull(),
  sellerName: text('seller_name').notNull(),
  status: text('status').notNull(), // 'negotiating' | 'agreed' | 'expired' | 'paid' | 'cancelled'
  askingPrice: integer('asking_price').notNull(),
  agreedPrice: integer('agreed_price'),
  floorPriceSnapshot: integer('floor_price_snapshot').notNull(),
  unlockedConcessions: text('unlocked_concessions').notNull(), // JSON array
  sessionId: text('session_id').notNull(),
  roundNumber: integer('round_number').notNull().default(0),
  currentCounterPrice: integer('current_counter_price').notNull(),
  buyerEmail: text('buyer_email'),
  expiresAt: bigint('expires_at', { mode: 'number' }),
  paidAt: bigint('paid_at', { mode: 'number' }),
  paypalOrderId: text('paypal_order_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  dealId: text('deal_id')
    .references(() => deals.id)
    .notNull(),
  sender: text('sender').notNull(), // 'buyer' | 'agent' | 'system'
  message: text('message').notNull(),
  offeredPrice: integer('offered_price'),
  counterPrice: integer('counter_price'),
  unlockedConcessions: text('unlocked_concessions'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  dealId: text('deal_id')
    .references(() => deals.id)
    .notNull(),
  paypalOrderId: text('paypal_order_id').notNull().unique(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  amount: integer('amount').notNull(),
  status: text('status').notNull(), // 'CREATED' | 'CAPTURED' | 'WEBHOOK_CONFIRMED'
  webhookVerified: integer('webhook_verified').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  sellers: many(sellers),
}));

export const sellersRelations = relations(sellers, ({ one, many }) => ({
  user: one(users, {
    fields: [sellers.userId],
    references: [users.id],
  }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  seller: one(sellers, {
    fields: [items.sellerId],
    references: [sellers.id],
  }),
  deals: many(deals),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  item: one(items, {
    fields: [deals.itemId],
    references: [items.id],
  }),
  messages: many(messages),
  payments: many(payments),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  deal: one(deals, {
    fields: [messages.dealId],
    references: [deals.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  deal: one(deals, {
    fields: [payments.dealId],
    references: [deals.id],
  }),
}));
