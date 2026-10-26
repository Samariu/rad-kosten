// Pure cost math. No DOM, no IndexedDB — so it can be unit-tested under `node --test`.

export const MS_DAY = 86400000;
// An average month, not a calendar month: 365.25 / 12. Dividing by whole calendar
// months makes the headline figure lurch every time a month boundary passes.
export const AVG_MONTH_DAYS = 30.4375;

export const CATEGORIES = [
  { id: 'bike',        label: 'Rad',          slot: 1 },
  { id: 'maintenance', label: 'Wartung',      slot: 2 },
  { id: 'parts',       label: 'Teile',        slot: 3 },
  { id: 'repair',      label: 'Reparatur',    slot: 4 },
  { id: 'accessories', label: 'Zubehör',      slot: 5 },
  { id: 'gear',        label: 'Ausrüstung',   slot: 6 },
  { id: 'insurance',   label: 'Versicherung', slot: 7 },
  { id: 'other',       label: 'Sonstiges',    slot: 8 },
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryLabel(id) {
  return CATEGORY_BY_ID.get(id)?.label ?? id;
}

export function categorySlot(id) {
  return CATEGORY_BY_ID.get(id)?.slot ?? 8;
}

/* ---------------------------------------------------------------- dates --
 * Everything is a 'YYYY-MM-DD' string parsed at UTC midnight. Using local-time
 * Date parsing here would shift days across timezones and DST boundaries and
 * quietly corrupt every day count.
 */

export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today in the *local* calendar, as an ISO day string. */
export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Inclusive day count: the same day on both ends is 1 day, not 0. */
export function daysBetween(fromISO, toISOStr) {
  const a = parseISO(fromISO);
  const b = parseISO(toISOStr);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / MS_DAY) + 1;
}

/** Days owned, floored at 1 so day one never divides by zero. */
export function daysOwned(purchaseDate, today = todayISO()) {
  const n = daysBetween(purchaseDate, today);
  return Number.isNaN(n) ? 1 : Math.max(1, n);
}

export function addDays(iso, n) {
  return toISO(parseISO(iso) + n * MS_DAY);
}

/** Month/year steps clamp to the last valid day (Jan 31 + 1 month -> Feb 28). */
export function addMonths(iso, n) {
  const ms = parseISO(iso);
  const d = new Date(ms);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toISO(target.getTime());
}

export function addYears(iso, n) {
  return addMonths(iso, n * 12);
}

/* --------------------------------------------------------------- money --
 * Cents as integers everywhere. Floats accumulate error across a few hundred
 * entries and the total stops matching the sum of the rows on screen.
 */

/**
 * Accepts what a person actually types: "12,50", "12.50", "1.234,56",
 * "1,234.56", "12", "€ 12,50". Returns integer cents, or NaN.
 */
export function parseAmountToCents(input) {
  let s = String(input ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (!s) return NaN;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimalSep = '';

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: whichever comes last is the decimal separator.
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const idx = Math.max(lastComma, lastDot);
    const tail = s.length - idx - 1;
    const occurrences = s.split(sep).length - 1;
    // A single separator with exactly 3 trailing digits is a thousands
    // separator ("1,234"); anything else is a decimal point ("12,5", "12,50").
    decimalSep = occurrences === 1 && tail !== 3 ? sep : '';
  }

  let whole = s;
  let frac = '';
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    whole = s.slice(0, idx);
    frac = s.slice(idx + 1);
  }
  whole = whole.replace(/[.,]/g, '');
  frac = frac.replace(/[.,]/g, '');
  if (!whole && !frac) return NaN;

  const cents =
    (Number(whole || '0') * 100) + Math.round(Number(`0.${frac || '0'}`) * 100);
  if (!Number.isFinite(cents)) return NaN;
  return negative ? -Math.round(cents) : Math.round(cents);
}

/* ------------------------------------------------------------ aggregates -- */

export function totals(expenses) {
  const byCategory = new Map();
  let totalCents = 0;
  for (const e of expenses) {
    totalCents += e.amountCents;
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amountCents);
  }
  return { totalCents, byCategory };
}

export function inRange(expenses, fromISO, toISOStr) {
  return expenses.filter((e) => e.date >= fromISO && e.date <= toISOStr);
}

/**
 * Spend rate over an inclusive [from, to] window. Lifetime and rolling figures
 * both come through here — only the bounds differ.
 */
export function rate(expenses, fromISO, toISOStr) {
  const days = Math.max(1, daysBetween(fromISO, toISOStr));
  const { totalCents } = totals(inRange(expenses, fromISO, toISOStr));
  const perDayCents = totalCents / days;
  return {
    totalCents,
    days,
    perDayCents,
    perMonthCents: perDayCents * AVG_MONTH_DAYS,
    perYearCents: perDayCents * 365.25,
  };
}

/**
 * Cost per kilometre. Returns null when there is no usable distance yet, so the
 * UI can hide the tile rather than render Infinity or NaN.
 */
export function costPerKm(totalCents, startKm, latestKm) {
  if (latestKm == null || startKm == null) return null;
  const km = latestKm - startKm;
  if (!(km > 0)) return null;
  return totalCents / km;
}

/** Monthly totals with empty months filled in as zero, so the axis stays even. */
export function monthlySeries(expenses, fromISO, toISOStr) {
  if (!expenses.length && !fromISO) return [];
  const dates = expenses.map((e) => e.date);
  const start = (fromISO || dates.reduce((a, b) => (a < b ? a : b))).slice(0, 7);
  const end = (toISOStr || dates.reduce((a, b) => (a > b ? a : b))).slice(0, 7);

  const sums = new Map();
  for (const e of expenses) {
    const key = e.date.slice(0, 7);
    sums.set(key, (sums.get(key) ?? 0) + e.amountCents);
  }

  const out = [];
  let cursor = `${start}-01`;
  const stop = `${end}-01`;
  // Guard against a pathological range (a mistyped purchase year) walking forever.
  for (let i = 0; cursor <= stop && i < 1200; i++) {
    const key = cursor.slice(0, 7);
    out.push({ month: key, cents: sums.get(key) ?? 0 });
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/** Total distance covered, or null when there is nothing to measure yet. */
export function distanceRidden(startKm, readings) {
  if (!readings.length) return null;
  const latest = readings.reduce((a, b) => (a.date > b.date ? a : b));
  const km = latest.km - (startKm ?? 0);
  return km > 0 ? km : null;
}
