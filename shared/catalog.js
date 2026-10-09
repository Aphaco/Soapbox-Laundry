// Single source of truth for prices. The server uses this to calculate the
// amount it charges, so a customer can never change the price from the browser.
// Prices are in whole major units (e.g. cedis). Edit freely.

export const SERVICES = [
  { id: 'wash-fold',  name: 'Wash and fold',      unit: 'kg',   price: 18, note: 'Everyday clothes, washed, dried and folded.' },
  { id: 'wash-iron',  name: 'Wash and iron',      unit: 'kg',   price: 25, note: 'Shirts, trousers and dresses, pressed and on hangers.' },
  { id: 'dry-clean',  name: 'Dry cleaning',       unit: 'item', price: 40, note: 'Suits, coats, gowns and delicate fabrics.' },
  { id: 'bedding',    name: 'Duvets and bedding', unit: 'item', price: 70, note: 'Duvets, comforters, blankets and curtains.' },
];

export const EXPRESS_RATE = 0.25;        // +25% for next-morning turnaround
export const DELIVERY_FEE = 15;          // pickup and delivery
export const FREE_DELIVERY_OVER = 150;   // subtotal above this gets free delivery
export const MIN_ORDER = 30;             // minimum subtotal
export const MAX_QTY = 50;

export const TIME_SLOTS = ['08:00 - 11:00', '11:00 - 14:00', '14:00 - 17:00'];

// All results are in minor units (pesewas, kobo, cents) as integers.
export function priceOrder(items, express) {
  const lines = [];
  let subtotal = 0;
  for (const { id, qty } of items) {
    const svc = SERVICES.find((s) => s.id === id);
    if (!svc || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) continue;
    const amount = Math.round(svc.price * 100) * qty;
    subtotal += amount;
    lines.push({ id, name: svc.name, unit: svc.unit, qty, amount });
  }
  const expressFee = express ? Math.round(subtotal * EXPRESS_RATE) : 0;
  const delivery = subtotal === 0 || subtotal > FREE_DELIVERY_OVER * 100 ? 0 : DELIVERY_FEE * 100;
  return { lines, subtotal, expressFee, delivery, total: subtotal + expressFee + delivery };
}
