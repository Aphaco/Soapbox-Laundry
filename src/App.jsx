import { useEffect, useMemo, useRef, useState } from 'react';
import PaystackPop from '@paystack/inline-js';
import { BUSINESS } from './config.js';
import {
  SERVICES, TIME_SLOTS, EXPRESS_RATE, DELIVERY_FEE, FREE_DELIVERY_OVER, MIN_ORDER, MAX_QTY, priceOrder,
} from '../shared/catalog.js';

const emptyForm = { name: '', email: '', phone: '', address: '', notes: '', pickupDate: '', pickupSlot: '' };

function nextDays(count = 7) {
  const out = [];
  const d = new Date();
  for (let i = 1; i <= count; i++) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    const value = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    out.push({ value, label: x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) });
  }
  return out;
}

export default function App() {
  const [currency, setCurrency] = useState('GHS');
  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((c) => c.currency && setCurrency(c.currency)).catch(() => {});
  }, []);

  const money = useMemo(() => {
    const f = new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2 });
    return (minor) => f.format(minor / 100);
  }, [currency]);

  return (
    <>
      <a className="skip" href="#order">Skip to order form</a>
      <Header />
      <main>
        <Hero money={money} currency={currency} />
        <Prices money={money} />
        <Steps />
        <Faq />
      </main>
      <Footer />
    </>
  );
}

/* ------------------------------ Header ------------------------------ */
function Header() {
  return (
    <header className="header">
      <div className="wrap header-row">
        <a className="brand" href="#top" aria-label={`${BUSINESS.name} home`}>
          <span className="brand-mark" aria-hidden="true">S</span>
          {BUSINESS.name}
        </a>
        <nav className="nav" aria-label="Main">
          <a href="#prices">Prices</a>
          <a href="#how">How it works</a>
          <a href="#faq">Questions</a>
        </nav>
        <a className="btn btn-sun btn-sm" href="#order">Book a pickup</a>
      </div>
    </header>
  );
}

/* ------------------------------ Hero + order ticket ------------------------------ */
function Hero({ money, currency }) {
  return (
    <section className="hero" id="top">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <h1>Your laundry, picked up and back at your door fresh.</h1>
          <p className="lead">
            Tell us what you need washed, pick a time, and pay by card. We collect it, clean it
            with care, and deliver it folded or pressed. Most orders return within 48 hours.
          </p>
          <ul className="ticks">
            <li>Free delivery on orders above {money(FREE_DELIVERY_OVER * 100)}</li>
            <li>Next-morning express turnaround available</li>
            <li>Card payments handled securely by Paystack</li>
          </ul>
        </div>
        <OrderTicket money={money} currency={currency} />
      </div>
    </section>
  );
}

function OrderTicket({ money, currency }) {
  const [qty, setQty] = useState({});
  const [express, setExpress] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const days = useMemo(() => nextDays(7), []);
  const ticketRef = useRef(null);

  const items = SERVICES.map((s) => ({ id: s.id, qty: qty[s.id] || 0 })).filter((i) => i.qty > 0);
  const price = priceOrder(items, express);

  // Scroll to the receipt once it renders
  useEffect(() => {
    if (receipt) {
      ticketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [receipt]);

  const setField = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };
  const step = (id, delta) => {
    setQty((q) => ({ ...q, [id]: Math.min(MAX_QTY, Math.max(0, (q[id] || 0) + delta)) }));
    setErrors((er) => ({ ...er, items: undefined }));
  };

  async function confirm(reference) {
    try {
      const res = await fetch(`/api/verify/${encodeURIComponent(reference)}`);
      const data = await res.json();
      if (res.ok && data.status === 'paid') {
        setReceipt({
          reference,
          total: data.total,
          name: form.name,
          email: form.email,
          date: form.pickupDate,
          slot: form.pickupSlot,
        });
      } else {
        setFormError(`We have not received confirmation of payment yet. If you were charged, contact us with reference ${reference}.`);
      }
    } catch {
      setFormError(`We could not confirm your payment. If you were charged, contact us with reference ${reference}.`);
    } finally {
      setBusy(false);
    }
  }

  async function pay(e) {
    e.preventDefault();
    if (busy) return;
    setFormError('');

    const local = {};
    if (price.subtotal < MIN_ORDER * 100) local.items = `Add at least ${money(MIN_ORDER * 100)} of services to continue.`;
    if (form.name.trim().length < 2) local.name = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) local.email = 'Enter a valid email address.';
    if (form.phone.replace(/\D/g, '').length < 7) local.phone = 'Enter a phone number we can call.';
    if (form.address.trim().length < 6) local.address = 'Enter the pickup address.';
    if (!form.pickupDate) local.pickupDate = 'Choose a pickup date.';
    if (!form.pickupSlot) local.pickupSlot = 'Choose a pickup time.';
    if (Object.keys(local).length) {
      setErrors(local);
      setFormError('Please fix the highlighted fields.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, express, items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.fields || {});
        setFormError(data.error || 'Something went wrong. Please try again.');
        setBusy(false);
        return;
      }

      const popup = new PaystackPop();
      popup.resumeTransaction(data.accessCode, {
        onSuccess: () => confirm(data.reference),
        onCancel: () => {
          setFormError('Payment was cancelled. Your details are saved, so you can try again.');
          setBusy(false);
        },
        onError: () => {
          setFormError('The payment window had a problem. Please try again.');
          setBusy(false);
        },
      });
    } catch {
      setFormError('We could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  function startOver() {
    setReceipt(null);
    setQty({});
    setExpress(false);
    setForm(emptyForm);
    setErrors({});
    setFormError('');
  }

  if (receipt) {
    return (
      <div className="ticket" id="order" ref={ticketRef}>
        <div className="ticket-top receipt">
          <div className="receipt-check" aria-hidden="true">✓</div>
          <h2>Payment received</h2>
          <p>
            Thank you, {receipt.name.split(' ')[0]}. We will collect your laundry on <strong>{receipt.date}</strong>,
            between <strong>{receipt.slot}</strong>. A receipt is on its way to {receipt.email}.
          </p>
        </div>
        <div className="ticket-bottom">
          <dl className="kv">
            <div><dt>Order reference</dt><dd>{receipt.reference}</dd></div>
            <div><dt>Amount paid</dt><dd>{money(receipt.total)}</dd></div>
          </dl>
          <button className="btn btn-ink btn-block" onClick={startOver}>Place another order</button>
        </div>
      </div>
    );
  }

  return (
    <form className="ticket" id="order" ref={ticketRef} onSubmit={pay} noValidate>
      <div className="ticket-top">
        <h2>Book your pickup</h2>

        <fieldset className="field-group">
          <legend>What needs cleaning?</legend>
          {SERVICES.map((s) => (
            <div className="svc-row" key={s.id}>
              <div>
                <div className="svc-name">{s.name}</div>
                <div className="svc-meta">{money(s.price * 100)} per {s.unit}</div>
              </div>
              <div className="stepper" role="group" aria-label={`${s.name} quantity in ${s.unit === 'kg' ? 'kilograms' : 'items'}`}>
                <button type="button" onClick={() => step(s.id, -1)} aria-label={`Remove one ${s.unit} of ${s.name}`} disabled={!qty[s.id]}>−</button>
                <output aria-live="polite">{qty[s.id] || 0}</output>
                <button type="button" onClick={() => step(s.id, 1)} aria-label={`Add one ${s.unit} of ${s.name}`}>+</button>
              </div>
            </div>
          ))}
          {errors.items && <p className="err" role="alert">{errors.items}</p>}
          <label className="check">
            <input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} />
            <span>Express: back by next morning (+{Math.round(EXPRESS_RATE * 100)}%)</span>
          </label>
        </fieldset>

        <fieldset className="field-group">
          <legend>Pickup time</legend>
          <div className="two">
            <Field label="Date" error={errors.pickupDate}>
              <select value={form.pickupDate} onChange={setField('pickupDate')}>
                <option value="">Choose a day</option>
                {days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="Time" error={errors.pickupSlot}>
              <select value={form.pickupSlot} onChange={setField('pickupSlot')}>
                <option value="">Choose a time</option>
                {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>Your details</legend>
          <Field label="Full name" error={errors.name}>
            <input value={form.name} onChange={setField('name')} autoComplete="name" />
          </Field>
          <div className="two">
            <Field label="Email" error={errors.email}>
              <input type="email" value={form.email} onChange={setField('email')} autoComplete="email" />
            </Field>
            <Field label="Phone" error={errors.phone}>
              <input type="tel" value={form.phone} onChange={setField('phone')} autoComplete="tel" />
            </Field>
          </div>
          <Field label="Pickup and delivery address" error={errors.address}>
            <input value={form.address} onChange={setField('address')} autoComplete="street-address" placeholder="House number, street, area" />
          </Field>
          <Field label="Notes for us (optional)">
            <textarea rows="2" value={form.notes} onChange={setField('notes')} placeholder="Gate code, stains to check, delicate items" />
          </Field>
        </fieldset>
      </div>

      <div className="ticket-bottom">
        <dl className="totals" aria-label="Order summary">
          <div><dt>Services</dt><dd>{money(price.subtotal)}</dd></div>
          {express && <div><dt>Express</dt><dd>{money(price.expressFee)}</dd></div>}
          <div>
            <dt>Pickup and delivery</dt>
            <dd>{price.subtotal === 0 ? money(0) : price.delivery === 0 ? 'Free' : money(price.delivery)}</dd>
          </div>
          <div className="grand"><dt>Total</dt><dd>{money(price.total)}</dd></div>
        </dl>

        {formError && <p className="err form-err" role="alert">{formError}</p>}

        <button className="btn btn-sun btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? 'Opening secure payment…' : `Pay ${money(price.total)} by card`}
        </button>
        <p className="secure">
          Payments are processed by Paystack in {currency}. We never see or store your card details.
        </p>
      </div>
    </form>
  );
}

function Field({ label, error, children }) {
  return (
    <label className={`field${error ? ' has-error' : ''}`}>
      <span>{label}</span>
      {children}
      {error && <small className="err" role="alert">{error}</small>}
    </label>
  );
}

/* ------------------------------ Prices ------------------------------ */
function Prices({ money }) {
  return (
    <section className="section" id="prices">
      <div className="wrap">
        <h2 className="section-title">Simple prices, no surprises</h2>
        <p className="section-lead">Pay for what you send. The total shows before you pay.</p>
        <div className="price-list">
          {SERVICES.map((s) => (
            <div className="price-row" key={s.id}>
              <div>
                <h3>{s.name}</h3>
                <p>{s.note}</p>
              </div>
              <div className="price-amt">{money(s.price * 100)}<span> / {s.unit}</span></div>
            </div>
          ))}
        </div>
        <p className="fine">
          Pickup and delivery is {money(DELIVERY_FEE * 100)}, and free above {money(FREE_DELIVERY_OVER * 100)}.
          Minimum order {money(MIN_ORDER * 100)}.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------ Steps ------------------------------ */
function Steps() {
  const steps = [
    ['Book and pay', 'Choose your services, a pickup window and pay securely by card. It takes about two minutes.'],
    ['We collect', 'Our rider arrives in your window, weighs or counts your items and confirms by phone.'],
    ['We clean', 'Clothes are sorted by colour and fabric, washed, dried and folded or pressed by hand.'],
    ['We deliver', 'Your laundry comes back clean, packed and ready to put away.'],
  ];
  return (
    <section className="section section-foam" id="how">
      <div className="wrap">
        <h2 className="section-title">How it works</h2>
        <ol className="steps">
          {steps.map(([t, d], i) => (
            <li key={t}>
              <span className="step-n" aria-hidden="true">{i + 1}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------ FAQ ------------------------------ */
function Faq() {
  const qa = [
    ['How long does it take?', 'Standard orders come back within 48 hours of pickup. Choose express at checkout for next-morning return.'],
    ['How do you charge for wash and fold?', 'By weight. Our rider weighs your bag at pickup. If the weight differs from what you booked, we confirm with you before cleaning.'],
    ['Is my card information safe?', 'Yes. Payment happens in a secure window run by Paystack. Your card details never touch our website or servers.'],
    ['What if something is damaged or missing?', `Tell us within 24 hours of delivery on ${BUSINESS.phone} or ${BUSINESS.email} and we will make it right.`],
    ['Can I change my pickup time?', `Yes. Call or message us before your pickup window starts.`],
  ];
  return (
    <section className="section" id="faq">
      <div className="wrap narrow">
        <h2 className="section-title">Questions we get a lot</h2>
        {qa.map(([q, a]) => (
          <details className="faq" key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ Footer ------------------------------ */
function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-row">
        <div>
          <div className="brand brand-light"><span className="brand-mark" aria-hidden="true">S</span>{BUSINESS.name}</div>
          <p>{BUSINESS.hours}</p>
        </div>
        <div className="footer-links">
          <a href={`tel:${BUSINESS.phone.replace(/\s/g, '')}`}>{BUSINESS.phone}</a>
          <a href={`https://wa.me/${BUSINESS.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp us</a>
          <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
        </div>
      </div>
      <div className="wrap fine-light">© {new Date().getFullYear()} {BUSINESS.name}. All rights reserved.</div>
    </footer>
  );
}