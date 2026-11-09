# PayPal Developer Platform Integration Guide (`PAYPAL_SANDBOX.md`)

Haggle integrates the **PayPal Orders v2 API** as the authoritative settlement layer for AI-negotiated deals.

---

## 1. Why PayPal + Agentic Commerce Need Server-Authoritative Pricing

In fixed-price e-commerce, every shopper pays the catalog price. In **agentic commerce**, every buyer negotiates a unique price and perk bundle in real time.

A naive client-side PayPal button (`actions.order.create({ purchase_units: [{ amount: { value: clientPrice } }] })`) is vulnerable to client-side price tampering. **Haggle solves this with a strict server-authoritative PayPal Orders v2 pipeline:**

1. When the maker's AI agent and the buyer reach an agreement, the server creates or updates a `deals` row in SQLite with:
   - `status: 'agreed'`
   - `agreedPrice`: The exact server-verified negotiated price (guaranteed `>= item.floorPrice`)
   - `expiresAt`: `Date.now() + 15 * 60 * 1000` (15-minute lock window)
2. When the buyer clicks **Pay with PayPal** or **Pay with Card (Guest)**:
   - The client sends **only** `{ dealId }` and an `x-idempotency-key` header to `POST /api/paypal/create-order`.
   - The server looks up `deal.agreedPrice` from SQLite, verifies the 15-minute hold has not expired (`!isDealExpired(deal)`), verifies `item.stock > 0`, and creates the PayPal Order for `deal.agreedPrice`.

---

## 2. Dual-Mode PayPal Sandbox Architecture

Haggle supports both **Live PayPal Sandbox REST API v2** credentials and a **Zero-Config PayPal Orders v2 Sandbox Simulator**:

### Mode A: Live PayPal Sandbox API (`PAYPAL_SANDBOX_API`)
When `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are set in `.env`:
1. `getPayPalSandboxAccessToken()` requests an OAuth 2.0 Bearer token from `https://api-m.sandbox.paypal.com/v1/oauth2/token`.
2. `POST /api/paypal/create-order` sends a `POST` request to `https://api-m.sandbox.paypal.com/v2/checkout/orders` with:
   - Header `PayPal-Request-Id: <idempotencyKey>`
   - `intent: "CAPTURE"`
   - `purchase_units[0].amount.value`: `Number(deal.agreedPrice).toFixed(2)`
   - `purchase_units[0].custom_id`: `deal.id`
3. `POST /api/paypal/capture-order` captures the order via `https://api-m.sandbox.paypal.com/v2/checkout/orders/{orderId}/capture` and atomically decrements item inventory in SQLite.

### Mode B: Deterministic PayPal Orders v2 Simulator (`PAYPAL_SANDBOX_SIMULATOR`)
So hackathon judges can immediately test the full end-to-end flow in preview environments without needing to paste secrets first, if `PAYPAL_CLIENT_ID` is not set, Haggle executes the exact same server-side state machine, idempotency ledger checks, 15-minute lock validation, and webhook confirmation against local SQLite storage.

---

## 3. Payment Edge Cases & Security Protections

| Edge Case | Server Behavior | HTTP Status |
| :--- | :--- | :--- |
| **Expired 15-minute price hold** | `isDealExpired(deal)` returns `true`. Payment creation or capture is rejected and the user is prompted to start a fresh offer. | `410 Gone` (`DEAL_EXPIRED`) |
| **Duplicate capture / double-click** | Checked via `captureIdempotencyKey` and `deal.status === 'paid'`. Returns `alreadyPaid: true` without decrementing stock a second time. | `200 OK` (Idempotent) |
| **Cancelled PayPal checkout** | `POST /api/paypal/cancel-order` returns `CANCELLED_RECOVERABLE`. The 15-minute price lock stays active and stock is untouched so the buyer can retry. | `200 OK` |
| **Out-of-stock item** | Checked before order creation and inside the SQLite capture transaction (`item.stock <= 0`). | `409 Conflict` (`OUT_OF_STOCK`) |
| **Webhook verification** | `POST /api/paypal/webhook` handles `PAYMENT.CAPTURE.COMPLETED` and `CHECKOUT.ORDER.APPROVED` idempotently. | `200 OK` |
