import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { TIME_SLOTS, MIN_ORDER, priceOrder } from '../shared/catalog.js';

const projectDir = path.dirname(fileURLToPath(import.meta.url));

const SECRET = process.env.PAYSTACK_SECRET_KEY;
const CURRENCY = (process.env.CURRENCY || 'GHS').toUpperCase();
const CHANNELS = (process.env.PAYSTACK_CHANNELS || 'card')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = process.env.PORT || 3001;

if (!SECRET) {
  console.error('Missing PAYSTACK_SECRET_KEY. Copy .env.example to .env and add your key.');
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.');
  process.exit(1);
}

// ---------- Supabase client ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ---------- Paystack helper ----------
async function paystack(endpoint, options = {}) {
  const res = await fetch(`https://api.paystack.co${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status === false) {
    throw new Error(body.message || `Paystack request failed (${res.status})`);
  }
  return body.data;
}

// ---------- Supabase order helpers ----------
async function loadOrder(reference) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveOrder(order) {
  const { error } = await supabase
    .from('orders')
    .upsert(order, { onConflict: 'reference' });
  if (error) throw error;
}

async function listOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Marks an order paid only if Paystack's numbers match what we expected.
async function markPaid(reference, tx) {
  const order = await loadOrder(reference);
  if (!order) return null;
  if (order.status === 'paid') return order;
  if (tx.status !== 'success') return order;

  const update =
    tx.amount === order.amount_minor && tx.currency === order.currency
      ? {
          status: 'paid',
          paid_at: tx.paid_at || new Date().toISOString(),
          channel: tx.channel,
        }
      : { status: 'amount_mismatch' };

  const merged = { ...order, ...update };
  await saveOrder(merged);
  return merged;
}

const app = express();

// ---------- Webhook (needs the raw body to check the signature) ----------
app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = String(req.headers['x-paystack-signature'] || '');
    const expected = crypto.createHmac('sha512', SECRET).update(req.body).digest('hex');
    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return res.sendStatus(401);
    }
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'charge.success') {
      await markPaid(event.data.reference, event.data);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('webhook error:', err.message);
    res.sendStatus(500);
  }
});

app.use(express.json({ limit: '50kb' }));

app.get('/api/config', (_req, res) => res.json({ currency: CURRENCY }));

const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// ---------- Create order + Paystack transaction ----------
app.post('/api/checkout', async (req, res) => {
  try {
    const b = req.body || {};
    const customer = {
      name: clean(b.name, 80),
      email: clean(b.email, 120).toLowerCase(),
      phone: clean(b.phone, 30),
      address: clean(b.address, 250),
      notes: clean(b.notes, 400),
    };
    const pickupDate = clean(b.pickupDate, 10);
    const pickupSlot = clean(b.pickupSlot, 20);
    const wantsExpress = Boolean(b.express);

    const errors = {};
    if (customer.name.length < 2) errors.name = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) errors.email = 'Enter a valid email address.';
    if (customer.phone.replace(/\D/g, '').length < 7) errors.phone = 'Enter a phone number we can call.';
    if (customer.address.length < 6) errors.address = 'Enter the pickup address.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || pickupDate <= new Date().toISOString().slice(0, 10)) {
      errors.pickupDate = 'Choose a pickup date from tomorrow onward.';
    }
    if (!TIME_SLOTS.includes(pickupSlot)) errors.pickupSlot = 'Choose a pickup time.';

    const items = Array.isArray(b.items)
      ? b.items.map((i) => ({ id: i?.id, qty: Number(i?.qty) }))
      : [];
    const priced = priceOrder(items, wantsExpress);
    if (priced.subtotal < MIN_ORDER * 100) {
      errors.items = `The minimum order is ${MIN_ORDER} ${CURRENCY}.`;
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
    }

    const reference = `SB-${Date.now().toString(36).toUpperCase()}-${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`;

    const tx = await paystack('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: customer.email,
        amount: priced.total,
        currency: CURRENCY,
        reference,
        channels: CHANNELS,
        metadata: {
          custom_fields: [
            { display_name: 'Customer', variable_name: 'customer', value: customer.name },
            { display_name: 'Phone', variable_name: 'phone', value: customer.phone },
            {
              display_name: 'Pickup',
              variable_name: 'pickup',
              value: `${pickupDate} ${pickupSlot}`,
            },
          ],
        },
      }),
    });

    await saveOrder({
      reference,
      status: 'pending',
      created_at: new Date().toISOString(),
      currency: CURRENCY,
      amount_minor: priced.total,
      pricing: priced,
      express: wantsExpress,
      pickup_date: pickupDate,
      pickup_slot: pickupSlot,
      customer,
    });

    res.json({ reference, accessCode: tx.access_code, total: priced.total });
  } catch (err) {
    console.error('checkout error:', err.message);
    console.error('full error:', err);
    res.status(502).json({
      error: 'We could not start the payment. Please try again in a moment.',
      debug: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
});

// ---------- Confirm a payment after the popup closes ----------
app.get('/api/verify/:reference', async (req, res) => {
  try {
    const reference = clean(req.params.reference, 60);
    const existing = await loadOrder(reference);
    if (!existing) return res.status(404).json({ error: 'Order not found.' });

    const tx = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    const order = await markPaid(reference, tx);

    res.json({
      status: order.status,
      reference,
      total: order.amount_minor,
      currency: order.currency,
    });
  } catch (err) {
    console.error('verify error:', err.message);
    res.status(502).json({ error: 'We could not confirm the payment yet.' });
  }
});

// ---------- Simple order list for you (protected by ADMIN_KEY) ----------
app.get('/api/admin/orders', async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.headers['x-admin-key'] !== key) return res.sendStatus(401);
  try {
    const list = await listOrders();
    res.json(list);
  } catch (err) {
    console.error('admin error:', err.message);
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

// ---------- Serve the built site in production (local prod only) ----------
if (process.env.NODE_ENV === 'production' && process.env.NETLIFY !== 'true') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---------- Export for Netlify; listen locally ----------
export default app;

if (process.env.NETLIFY !== 'true') {
  app.listen(PORT, () => console.log(`Soapbox server running on http://localhost:${PORT}`));
}