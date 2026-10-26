import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVG_MONTH_DAYS, daysBetween, daysOwned, addMonths, addDays,
  parseAmountToCents, totals, rate, costPerKm, monthlySeries, distanceRidden,
} from './calc.js';

const exp = (date, amountCents, category = 'other') => ({ date, amountCents, category });

test('daysBetween counts inclusively', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-01'), 1);
  assert.equal(daysBetween('2026-01-01', '2026-01-02'), 2);
  assert.equal(daysBetween('2026-01-01', '2026-12-31'), 365);
});

test('daysBetween is not shifted by DST transitions', () => {
  // Europe/Berlin springs forward on 2026-03-29 and back on 2026-10-25.
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 3);
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 3);
});

test('daysOwned floors at 1 on the day of purchase', () => {
  assert.equal(daysOwned('2026-08-30', '2026-08-30'), 1);
  // A purchase date in the future must not produce a zero or negative divisor.
  assert.equal(daysOwned('2027-01-01', '2026-08-30'), 1);
});

test('addMonths clamps to the last valid day of the month', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  // Clamping must not be sticky: stepping from the original date each time.
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
});

test('parseAmountToCents handles German and English input', () => {
  assert.equal(parseAmountToCents('12,50'), 1250);
  assert.equal(parseAmountToCents('12.50'), 1250);
  assert.equal(parseAmountToCents('12'), 1200);
  assert.equal(parseAmountToCents('12,5'), 1250);
  assert.equal(parseAmountToCents('1.234,56'), 123456);
  assert.equal(parseAmountToCents('1,234.56'), 123456);
  assert.equal(parseAmountToCents('€ 89,99'), 8999);
  assert.equal(parseAmountToCents('0,01'), 1);
  // A lone separator with three trailing digits reads as thousands.
  assert.equal(parseAmountToCents('1,234'), 123400);
  assert.equal(parseAmountToCents('1.234'), 123400);
});

test('parseAmountToCents rejects junk', () => {
  assert.ok(Number.isNaN(parseAmountToCents('')));
  assert.ok(Number.isNaN(parseAmountToCents('abc')));
  assert.ok(Number.isNaN(parseAmountToCents(null)));
});

test('parseAmountToCents does not drift on repeated float-unfriendly values', () => {
  // 0.1 + 0.2 in floats is the classic failure; in cents it must be exact.
  const sum = ['0,10', '0,20', '0,30'].reduce((a, s) => a + parseAmountToCents(s), 0);
  assert.equal(sum, 60);
});

test('totals sums overall and per category', () => {
  const { totalCents, byCategory } = totals([
    exp('2026-01-01', 1000, 'parts'),
    exp('2026-01-02', 2500, 'parts'),
    exp('2026-01-03', 500, 'repair'),
  ]);
  assert.equal(totalCents, 4000);
  assert.equal(byCategory.get('parts'), 3500);
  assert.equal(byCategory.get('repair'), 500);
});

test('rate divides by the inclusive window length', () => {
  const r = rate([exp('2026-01-01', 3100)], '2026-01-01', '2026-01-31');
  assert.equal(r.days, 31);
  assert.equal(r.totalCents, 3100);
  assert.equal(r.perDayCents, 100);
  assert.equal(r.perMonthCents, 100 * AVG_MONTH_DAYS);
});

test('rate includes the window boundaries and excludes what falls outside', () => {
  const items = [
    exp('2025-12-31', 999),  // one day before
    exp('2026-01-01', 100),  // first day
    exp('2026-01-31', 200),  // last day
    exp('2026-02-01', 999),  // one day after
  ];
  assert.equal(rate(items, '2026-01-01', '2026-01-31').totalCents, 300);
});

test('rate treats the purchase as an ordinary expense inside its window', () => {
  const items = [exp('2026-06-01', 120000, 'bike'), exp('2026-08-20', 4000, 'parts')];
  // Lifetime: the purchase counts.
  assert.equal(rate(items, '2026-06-01', '2026-08-30').totalCents, 124000);
  // Rolling 30 days: the purchase has aged out and must drop away.
  assert.equal(rate(items, '2026-08-01', '2026-08-30').totalCents, 4000);
});

test('costPerKm returns null when there is no usable distance', () => {
  assert.equal(costPerKm(10000, 0, null), null);
  assert.equal(costPerKm(10000, 0, 0), null);
  assert.equal(costPerKm(10000, 500, 500), null);
  assert.equal(costPerKm(10000, 900, 500), null); // odometer rolled backwards
  assert.equal(costPerKm(10000, 0, 500), 20);
  assert.equal(costPerKm(10000, 100, 600), 20);   // starting offset respected
});

test('monthlySeries fills empty months with zero', () => {
  const s = monthlySeries(
    [exp('2026-01-15', 1000), exp('2026-04-02', 2000)],
    '2026-01-01', '2026-04-30'
  );
  assert.deepEqual(s, [
    { month: '2026-01', cents: 1000 },
    { month: '2026-02', cents: 0 },
    { month: '2026-03', cents: 0 },
    { month: '2026-04', cents: 2000 },
  ]);
});

test('monthlySeries handles a single month and no expenses', () => {
  assert.deepEqual(monthlySeries([], '2026-05-10', '2026-05-20'), [
    { month: '2026-05', cents: 0 },
  ]);
});

test('distanceRidden uses the latest reading and the starting offset', () => {
  assert.equal(distanceRidden(0, []), null);
  assert.equal(distanceRidden(1200, [{ date: '2026-01-01', km: 1500 }]), 300);
  assert.equal(distanceRidden(0, [
    { date: '2026-01-01', km: 900 },
    { date: '2026-06-01', km: 2400 },
  ]), 2400);
  assert.equal(distanceRidden(3000, [{ date: '2026-01-01', km: 2000 }]), null);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

/* ------------------------------------------------- recurring occurrences -- */

import { occurrencesUpTo } from './recurring.js';

const rule = (over = {}) => ({
  id: 'r1', label: 'Versicherung', amountCents: 700,
  category: 'insurance', interval: 'monthly', startDate: '2026-01-15', ...over,
});

test('occurrencesUpTo generates one entry per period through today', () => {
  assert.deepEqual(occurrencesUpTo(rule(), '2026-04-14'),
    ['2026-01-15', '2026-02-15', '2026-03-15']);
  // Today being exactly a due date includes it.
  assert.equal(occurrencesUpTo(rule(), '2026-04-15').length, 4);
});

test('occurrencesUpTo does not let a month-end clamp drag the series', () => {
  // Jan 31 -> Feb 28, but March must come back to the 31st, not stay on the 28th.
  assert.deepEqual(occurrencesUpTo(rule({ startDate: '2026-01-31' }), '2026-04-01'),
    ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('occurrencesUpTo honours weekly, yearly and an end date', () => {
  assert.deepEqual(occurrencesUpTo(rule({ interval: 'weekly', startDate: '2026-08-03' }), '2026-08-24'),
    ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']);
  assert.deepEqual(occurrencesUpTo(rule({ interval: 'yearly', startDate: '2024-05-01' }), '2026-06-01'),
    ['2024-05-01', '2025-05-01', '2026-05-01']);
  assert.deepEqual(occurrencesUpTo(rule({ endDate: '2026-02-20' }), '2026-12-31'),
    ['2026-01-15', '2026-02-15']);
});

test('occurrencesUpTo returns nothing for a future start or a bad rule', () => {
  assert.deepEqual(occurrencesUpTo(rule({ startDate: '2027-01-01' }), '2026-08-30'), []);
  assert.deepEqual(occurrencesUpTo(rule({ interval: 'daily' }), '2026-08-30'), []);
  assert.deepEqual(occurrencesUpTo(rule({ startDate: '' }), '2026-08-30'), []);
});
