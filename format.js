// Display formatting. German locale, EUR, kilometres.

const eur = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const eurPrecise = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 3,
});
const eurWhole = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});
const km = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const km1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const dayFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' });

export const money = (cents) => eur.format((cents ?? 0) / 100);
export const moneyWhole = (cents) => eurWhole.format((cents ?? 0) / 100);

/** Small rates need a third digit — "0,04 €/km" hides most of the signal. */
export function moneyFine(cents) {
  const v = (cents ?? 0) / 100;
  return Math.abs(v) < 1 ? eurPrecise.format(v) : eur.format(v);
}

export const kmFmt = (v) => `${km.format(v ?? 0)} km`;
export const km1Fmt = (v) => `${km1.format(v ?? 0)} km`;

export const dayLabel = (iso) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
export const monthLabel = (ym) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
export const monthTick = (ym) => monthShort.format(new Date(`${ym}-01T00:00:00Z`)).replace('.', '');
export const yearOf = (ym) => ym.slice(0, 4);

/** Plural-aware day count, e.g. "1 Tag" / "42 Tage". */
export const days = (n) => `${km.format(n)} ${n === 1 ? 'Tag' : 'Tage'}`;

/** Dative form, for "in 365 Tagen". */
export const daysIn = (n) => `${km.format(n)} ${n === 1 ? 'Tag' : 'Tagen'}`;
