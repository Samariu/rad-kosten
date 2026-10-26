import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';

const APP = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const html = readFileSync(`${APP}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'https://example.com/bike/', pretendToBeVisual: true });
const { window } = dom;

// Globals app.js expects from a browser.
for (const k of ['document', 'window', 'navigator', 'location', 'HTMLElement', 'Node',
                 'CustomEvent', 'Event', 'Blob', 'FileReader', 'getComputedStyle']) {
  globalThis[k] = window[k] ?? window;
}
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
window.confirm = () => true;
window.alert = () => {};
globalThis.confirm = window.confirm;
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};
window.scrollTo = () => {};

const fail = [];
const ok = [];
const check = (name, cond, detail = '') =>
  (cond ? ok : fail).push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);

// --- seed a realistic bike before booting -------------------------------
const db = await import(`${APP}/db.js`);
const { todayISO, addDays } = await import(`${APP}/calc.js`);
const today = todayISO();
const purchase = addDays(today, -364);            // owned for exactly 365 days

await db.setSettings({ bikeName: 'Stadtrad', purchaseDate: purchase, purchaseOdometerKm: 0 });
await db.putExpense({ date: purchase, amountCents: 120000, category: 'bike', note: 'Kaufpreis', isPurchase: true });
await db.putExpense({ date: addDays(today, -200), amountCents: 4500, category: 'parts', note: 'Kette' });
await db.putExpense({ date: addDays(today, -40),  amountCents: 8900, category: 'maintenance', note: 'Inspektion' });
await db.putExpense({ date: addDays(today, -10),  amountCents: 2350, category: 'repair', note: 'Schlauch' });
await db.setRecurring([{ id: 'r1', label: 'Versicherung', amountCents: 700,
  interval: 'monthly', category: 'insurance', startDate: addDays(today, -364), endDate: null }]);
await db.putReading({ date: addDays(today, -300), km: 400 });
await db.putReading({ date: today, km: 3100 });

// --- boot ----------------------------------------------------------------
await import(`${APP}/app.js`);
await new Promise((r) => setTimeout(r, 250));

const $ = (s) => window.document.querySelector(s);
const text = (s) => $(s)?.textContent?.trim() ?? '<missing>';

check('setup screen hidden once a purchase date exists', $('#view-setup').hidden);
check('app shell visible', !$('#app').hidden);
check('bike name in the title bar', text('#bike-title') === 'Stadtrad', text('#bike-title'));

// Recurring: 12 monthly occurrences over 365 days = 8.400 cents.
const expenses = await db.getExpenses();
const generated = expenses.filter((e) => e.recurringId === 'r1');
check('recurring materialised once per month', generated.length === 12, `${generated.length} rows`);

// Idempotency: a second materialise pass must add nothing.
const { materialise } = await import(`${APP}/recurring.js`);
const again = await materialise([{ id: 'r1', label: 'Versicherung', amountCents: 700,
  interval: 'monthly', category: 'insurance', startDate: addDays(today, -364), endDate: null }], today);
check('re-running materialise creates no duplicates', again === 0, `${again} created`);

// Arithmetic: total = 120000 + 4500 + 8900 + 2350 + 12×700 = 144150 over 365 days.
const total = (await db.getExpenses()).reduce((a, e) => a + e.amountCents, 0);
check('total matches the seeded data', total === 144150, `${total} cents`);
const perDay = Math.round(total / 365);
check('hero per-day figure equals total ÷ days owned',
  text('#hero-day').includes(String((perDay / 100).toFixed(2)).replace('.', ',')),
  `${text('#hero-day')} vs ${perDay} cents/day`);
check('hero per-month figure rendered', /\d/.test(text('#hero-month')), text('#hero-month'));
check('total tile rendered', text('#stat-total').includes('1.44'), text('#stat-total'));
check('days-owned footer', text('#stat-owned') === 'in 365 Tagen', text('#stat-owned'));

// Rolling window: last 30 days = Schlauch 23,50 + one or two insurance runs.
check('30-day tile excludes the purchase', !text('#stat-30').includes('1.4'), text('#stat-30'));

// Cost per km: 144150 cents over 3100 km.
check('cost-per-km tile visible', !$('#tile-km').hidden);
check('cost per km computed', text('#stat-km').includes('0,46'), text('#stat-km'));
check('distance shown', text('#stat-km-foot').includes('3.100'), text('#stat-km-foot'));

// Charts.
check('breakdown lists every category used', $('#breakdown').querySelectorAll('li').length === 5,
  `${$('#breakdown').querySelectorAll('li').length} rows`);
check('breakdown sorted by spend, bike first',
  $('#breakdown li .breakdown-name').textContent.includes('Rad'));
check('monthly chart drew 13 columns', $('#monthly svg')?.querySelectorAll('path').length === 13,
  `${$('#monthly svg')?.querySelectorAll('path').length}`);
check('chart has axis ticks', $('#monthly svg')?.querySelectorAll('text.tick').length > 3);

// History grouping.
check('history grouped into months', $('#history').querySelectorAll('.month-group').length >= 12,
  `${$('#history').querySelectorAll('.month-group').length} groups`);
check('recent list capped at five', $('#recent').querySelectorAll('li').length === 5);

// Odometer view.
check('odometer readings listed', $('#odo-list').querySelectorAll('li').length === 2);
check('odometer summary', text('#odo-summary').includes('3.100'), text('#odo-summary'));

// Settings round-trip.
check('settings form prefilled with the purchase price',
  $('#settings-form').elements.purchasePrice.value === '1200,00',
  $('#settings-form').elements.purchasePrice.value);
check('recurring rule listed in settings', $('#recurring-list').querySelectorAll('li').length === 1);

// Add an expense through the real UI path.
$('#fab').dispatchEvent(new window.Event('click'));
check('expense sheet opens', $('#expense-dialog').open);
const ef = $('#expense-form').elements;
ef.amount.value = '19,99';
ef.date.value = today;
ef.note.value = 'Neue Klingel';
$('#category-chips .chip[data-category="accessories"]').dispatchEvent(new window.Event('click'));
$('#expense-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
await new Promise((r) => setTimeout(r, 200));
check('expense saved through the form', (await db.getExpenses()).some((e) => e.note === 'Neue Klingel'));
check('total updated after save', text('#stat-total').includes('1.46'), text('#stat-total'));

// Validation: a date before the purchase must be rejected.
$('#fab').dispatchEvent(new window.Event('click'));
$('#expense-form').elements.amount.value = '10,00';
$('#expense-form').elements.date.value = addDays(purchase, -1);
$('#expense-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
await new Promise((r) => setTimeout(r, 120));
check('rejects a date before the purchase date', !$('#expense-error').hidden, text('#expense-error'));

// Export / import round-trip.
const dump = await db.exportAll();
check('export carries every store', dump.expenses.length === 17 && dump.odometer.length === 2 && dump.recurring.length === 1,
  `${dump.expenses.length} expenses`);
await db.importAll(JSON.parse(JSON.stringify(dump)));
const after = await db.getExpenses();
check('import restores the same totals',
  after.reduce((a, e) => a + e.amountCents, 0) === 144150 + 1999);

console.log([...ok, ...fail].join('\n'));
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
