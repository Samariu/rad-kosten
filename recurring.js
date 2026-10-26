// Recurring expenses are *materialised* into real expense rows, not computed on
// the fly: past entries stay individually editable, and every calculation
// downstream only ever sees plain expenses.

import { addDays, addMonths, addYears, parseISO, todayISO } from './calc.js';
import { addOccurrence } from './db.js';

const STEP = {
  weekly: (iso, n) => addDays(iso, 7 * n),
  monthly: (iso, n) => addMonths(iso, n),
  yearly: (iso, n) => addYears(iso, n),
};

export const INTERVALS = [
  { id: 'weekly', label: 'wöchentlich' },
  { id: 'monthly', label: 'monatlich' },
  { id: 'yearly', label: 'jährlich' },
];

export const intervalLabel = (id) => INTERVALS.find((i) => i.id === id)?.label ?? id;

/** Every occurrence date from startDate up to and including `today`. */
export function occurrencesUpTo(rule, today = todayISO()) {
  const step = STEP[rule.interval];
  if (!step || !rule.startDate || Number.isNaN(parseISO(rule.startDate))) return [];

  const end = rule.endDate && rule.endDate < today ? rule.endDate : today;
  const out = [];
  // Step from the original start each time rather than from the previous
  // result, so a month-end clamp (Jan 31 -> Feb 28) never drags the whole
  // series onto the 28th.
  for (let i = 0; i < 2400; i++) {
    const date = step(rule.startDate, i);
    if (date > end) break;
    out.push(date);
  }
  return out;
}

/**
 * Writes any missing occurrence for every rule. Safe to call on every app open —
 * the unique occurrenceKey index makes duplicate writes no-ops.
 * Returns how many rows were actually created.
 */
export async function materialise(rules, today = todayISO()) {
  let created = 0;
  for (const rule of rules || []) {
    for (const date of occurrencesUpTo(rule, today)) {
      const added = await addOccurrence({
        date,
        amountCents: rule.amountCents,
        category: rule.category,
        note: rule.label,
        recurringId: rule.id,
        occurrenceKey: `${rule.id}:${date}`,
      });
      if (added) created++;
    }
  }
  return created;
}
