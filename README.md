# Haggle — Don't Just Shop. Haggle.

**PayPal-Native Agentic Bargaining Marketplace for Unique & Handmade Goods**  
*Built for the PayPal AI Hackathon 2026 ("Build What's Next with PayPal and AI")*

---

## Overview

Traditional e-commerce forces buyers and independent makers into a rigid binary: pay the full sticker price or abandon the cart. Meanwhile, makers who want to offer flexible pricing lack the time to negotiate 1-on-1 with every shopper around the clock.

**Haggle** transforms static product pages into autonomous, maker-authorized negotiation rooms powered by **Google Gemini (`@google/genai`)** and settled through **PayPal Orders v2**.

1. **Makers Authorize Rules**: Artisans set their public asking price, a confidential server-only floor price (`floorPrice`), negotiation style (`Warm & Generous`, `Balanced & Story-Driven`, or `Firm Protector`), and value-add perks (e.g., *Free 2-Day Express Shipping*, *Complimentary Cedar Care Kit*).
2. **Shoppers Bargain Live**: Buyers make offers via text, quick-offer buttons, or voice input.
3. **Deterministic Server Guardrails + Structured AI**: Every offer is evaluated server-side before the AI speaks. Secret floor prices are never exposed to the browser or compromised by prompt injection.
4. **15-Minute Price Lock & PayPal Orders v2 Settlement**: Once buyer and agent agree on a price, Haggle creates a 15-minute cryptographic price hold and processes payment via PayPal Orders v2 (`create-order`, `capture-order`, `cancel-order`, `webhook`) using the server-verified locked deal price—never trusting client-submitted amounts.

---

## Key Features

- **Interactive Above-the-Fold Hero Negotiation**: Visitors can test live AI bargaining and lock a PayPal deal within 5 seconds of landing on the homepage—no login required.
- **Full-Screen Mobile & Desktop Bargaining Room**: Dedicated negotiation workspace with live counter-offer tracking, structured state badges (`NEGOTIATING`, `COUNTEROFFERED`, `ACCEPTED`, `DECLINED`, `EXPIRED`), voice input, and instant perk unlocking.
- **PayPal Developer Platform Integration**:
  - Server-side **PayPal Orders v2** creation (`POST /api/paypal/create-order`) and capture (`POST /api/paypal/capture-order`).
  - Automatic support for live PayPal Sandbox REST API (`https://api-m.sandbox.paypal.com`) when `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are provided, with seamless fallback to a deterministic PayPal Orders v2 Sandbox Simulator for zero-config evaluation.
  - **Idempotency protection** (`x-idempotency-key` / `PayPal-Request-Id`) preventing duplicate order creation or double stock decrement.
  - **15-minute price hold expiration** (`HTTP 410 Gone` on expired deals).
  - **Cancelled payment recovery** (`POST /api/paypal/cancel-order`) that preserves the buyer's 15-minute price hold without decrementing stock.
- **Seller Studio & Deal Ledger**: Makers can add new handmade listings, configure AI negotiation guardrails, inspect conversion metrics, and audit every PayPal Order ID and idempotency key.

---

## Documentation Index

- **[SETUP.md](./SETUP.md)** — Local installation, environment variables, unit tests, and running the full-stack server.
- **[PAYPAL_SANDBOX.md](./PAYPAL_SANDBOX.md)** — PayPal Developer Platform Sandbox configuration, API endpoints, and webhook verification flow.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — System architecture, security boundaries, Drizzle/SQLite persistence, and hybrid deterministic + LLM negotiation state machine.
- **[DEMO_SCRIPT.md](./DEMO_SCRIPT.md)** — Step-by-step 3-minute hackathon judge walkthrough and test scenarios.
- **[LICENSE](./LICENSE)** — Apache 2.0 Open Source License.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables (optional for local simulator, required for live Gemini/PayPal Sandbox)
cp .env.example .env

# 3. Run unit & security boundary tests
npx tsx --test src/lib/bargaining.test.ts

# 4. Start the full-stack Express + Vite server on port 3000
npm run dev
```

Open `http://localhost:3000` in your browser.
