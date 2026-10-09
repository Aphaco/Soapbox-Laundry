# Soapbox Laundry

A laundry service website with online booking and card payment through Paystack.

- **Frontend:** React + Vite (`src/`)
- **Backend:** Express (`server/`). It keeps your secret key private, calculates the price itself, starts the Paystack payment, and confirms it afterwards.
- **Prices:** `shared/catalog.js`. Edit services, prices, delivery fee, express rate and time slots there.
- **Your business details:** `src/config.js`

## Run it

1. Install Node.js 18 or newer.
2. In this folder run `npm install`.
3. Copy `.env.example` to `.env`. Paste your **test** secret key (`sk_test_...`) from Paystack dashboard > Settings > API Keys & Webhooks. Set `CURRENCY` to one your account supports.
4. Run `npm run dev` and open http://localhost:5173.
5. Test with Paystack's test cards (listed in the Paystack docs under "Test payments").

## How a payment flows

1. The customer fills in the order. The browser sends the items and details to `/api/checkout`.
2. The server recalculates the total from `shared/catalog.js`, creates the Paystack transaction, saves the order as `pending`, and returns an access code.
3. The Paystack popup opens. The customer pays by card.
4. The browser asks `/api/verify/:reference`. The server checks with Paystack, confirms the amount and currency match, and marks the order `paid`.
5. The webhook is a backup if the customer closes the tab right after paying.

Only the secret key is needed, and it never reaches the browser.

## Webhook (do this before going live)

In Paystack dashboard > Settings > API Keys & Webhooks, set the webhook URL to:

`https://YOUR-DOMAIN/api/paystack/webhook`

## Seeing your orders

Orders are saved to `server/orders.json`. To list them:

`curl -H "x-admin-key: YOUR_ADMIN_KEY" https://YOUR-DOMAIN/api/admin/orders`

For a busy business, replace the JSON file with a real database (the `loadOrders` and `saveOrders` functions in `server/index.js` are the only places to change).

## Going live

1. Switch to your **live** secret key (`sk_live_...`) in `.env` on the server.
2. `npm run build` then `npm start`. The Express server serves the built site and the API together on `PORT`.
3. Host it anywhere that runs Node (Render, Railway, a VPS). Use HTTPS, which Paystack requires for webhooks.
4. Do one small real payment to confirm it works end to end.

## Optional: more payment methods

Set `PAYSTACK_CHANNELS=card,mobile_money` (or add `bank_transfer`) in `.env`. Which channels work depends on your country and account.
