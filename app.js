import {
  CATEGORIES, categoryLabel, categorySlot, todayISO, daysOwned, daysBetween,
  addDays, parseAmountToCents, totals, rate, costPerKm, monthlySeries,
  distanceRidden, parseISO,
} from './calc.js';
import * as db from './db.js';
import { materialise, INTERVALS, intervalLabel } from './recurring.js';
import { renderBreakdown, renderMonthly } from './charts.js';
import {
  money, moneyFine, moneyWhole, kmFmt, dayLabel, monthLabel,
  days as daysText, daysIn,
} from './format.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  settings: null,
  expenses: [],
  readings: [],
  recurring: [],
  today: todayISO(),
  disposeChart: null,
};

/* ------------------------------------------------------------------ boot -- */

async function boot() {
  state.settings = await db.getSettings();

  if (!state.settings.purchaseDate) {
    $('#view-setup').hidden = false;
    $('#setup-form').elements.purchaseDate.value = state.today;
    $('#setup-form').addEventListener('submit', onSetupSubmit);
    return;
  }

  $('#view-setup').hidden = true;
  $('#app').hidden = false;

  state.recurring = await db.getRecurring();
  await materialise(state.recurring, state.today);
  await reload();
  wire();
  registerServiceWorker();
}

async function reload() {
  [state.expenses, state.readings] = await Promise.all([db.getExpenses(), db.getReadings()]);
  renderAll();
}

async function onSetupSubmit(ev) {
  ev.preventDefault();
  const f = ev.target.elements;
  const price = parseAmountToCents(f.purchasePrice.value || '0');
  const settings = {
    bikeName: f.bikeName.value.trim() || 'Mein Rad',
    purchaseDate: f.purchaseDate.value,
    purchaseOdometerKm: Number(f.purchaseOdometerKm.value || 0),
  };
  await db.setSettings(settings);
  if (Number.isFinite(price) && price > 0) {
    await db.putExpense({
      date: settings.purchaseDate, amountCents: price,
      category: 'bike', note: 'Kaufpreis', isPurchase: true,
    });
  }
  location.reload();
}

/* --------------------------------------------------------------- rendering */

function renderAll() {
  const s = state.settings;
  $('#bike-title').textContent = s.bikeName;
  const owned = daysOwned(s.purchaseDate, state.today);
  $('#bike-subtitle').textContent = `seit ${dayLabel(s.purchaseDate)} · ${daysText(owned)}`;

  renderDashboard(owned);
  renderHistory();
  renderOdometer();
  renderSettings();
}

function renderDashboard(owned) {
  const s = state.settings;
  const lifetime = rate(state.expenses, s.purchaseDate, state.today);

  $('#hero-month').textContent = money(Math.round(lifetime.perMonthCents));
  $('#hero-day').textContent = money(lifetime.perDayCents);
  $('#stat-total').textContent = moneyWhole(lifetime.totalCents);
  $('#stat-owned').textContent = `in ${daysIn(owned)}`;

  for (const win of [30, 90]) {
    // Only look back as far as the bike has existed, so a two-week-old bike
    // doesn't get its spend divided by 30.
    const from = maxDate(addDays(state.today, -(win - 1)), s.purchaseDate);
    const r = rate(state.expenses, from, state.today);
    $(`#stat-${win}`).textContent = moneyWhole(r.totalCents);
    $(`#stat-${win}-rate`).textContent =
      r.days < win
        ? `erst ${daysText(r.days)} · ${money(Math.round(r.perDayCents))}/Tag`
        : `${money(Math.round(r.perDayCents))} pro Tag`;
  }

  // distanceRidden has already subtracted the starting odometer, so the
  // baseline passed here is 0.
  const km = distanceRidden(s.purchaseOdometerKm, state.readings);
  const perKm = costPerKm(lifetime.totalCents, 0, km);
  const tile = $('#tile-km');
  tile.hidden = perKm === null;
  if (perKm !== null) {
    $('#stat-km').textContent = `${moneyFine(perKm)}`;
    $('#stat-km-foot').textContent = `auf ${kmFmt(km)}`;
  }

  const rows = [...totals(state.expenses).byCategory]
    .map(([id, cents]) => ({ id, cents, label: categoryLabel(id), slot: categorySlot(id) }))
    .filter((r) => r.cents !== 0)
    .sort((a, b) => b.cents - a.cents);
  renderBreakdown($('#breakdown'), rows);

  if (state.disposeChart) state.disposeChart();
  state.disposeChart = renderMonthly(
    $('#monthly'),
    monthlySeries(state.expenses, s.purchaseDate, state.today)
  );

  const recent = $('#recent');
  recent.textContent = '';
  if (!state.expenses.length) {
    recent.innerHTML = '<li><p class="empty">Noch nichts erfasst. Tipp auf +, um zu starten.</p></li>';
  } else {
    for (const e of state.expenses.slice(0, 5)) recent.appendChild(expenseRow(e));
  }
}

function expenseRow(e) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'entry';
  btn.type = 'button';
  btn.innerHTML = `
    <div class="entry-main">
      <div class="entry-title">
        <i class="swatch" style="background:var(--series-${categorySlot(e.category)})"></i>
        <span>${escapeHtml(e.note || categoryLabel(e.category))}</span>
        ${e.recurringId ? '<em class="entry-badge">wiederkehrend</em>' : ''}
      </div>
      <div class="entry-sub">${dayLabel(e.date)} · ${categoryLabel(e.category)}</div>
    </div>
    <div class="entry-amount">${money(e.amountCents)}</div>`;
  btn.addEventListener('click', () => openExpense(e));
  li.appendChild(btn);
  return li;
}

function renderHistory() {
  const host = $('#history');
  host.textContent = '';
  if (!state.expenses.length) {
    host.innerHTML = '<section class="card"><p class="empty">Noch keine Ausgaben erfasst.</p></section>';
    return;
  }
  const groups = new Map();
  for (const e of state.expenses) {
    const key = e.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const [month, items] of groups) {
    const sum = items.reduce((a, e) => a + e.amountCents, 0);
    const section = document.createElement('section');
    section.className = 'card month-group';
    section.innerHTML = `<div class="month-head"><span>${monthLabel(month)}</span><strong>${money(sum)}</strong></div>`;
    const ul = document.createElement('ul');
    ul.className = 'entries';
    for (const e of items) ul.appendChild(expenseRow(e));
    section.appendChild(ul);
    host.appendChild(section);
  }
}

function renderOdometer() {
  const list = $('#odo-list');
  list.textContent = '';
  const km = distanceRidden(state.settings.purchaseOdometerKm, state.readings);
  $('#odo-summary').textContent = km === null ? '' : `${kmFmt(km)} gefahren`;

  if (!state.readings.length) {
    list.innerHTML = '<li><p class="empty">Noch kein Kilometerstand erfasst.</p></li>';
    return;
  }
  state.readings.forEach((r, i) => {
    const prev = state.readings[i + 1];
    const delta = prev ? r.km - prev.km : r.km - (state.settings.purchaseOdometerKm ?? 0);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'entry';
    btn.type = 'button';
    btn.innerHTML = `
      <div class="entry-main">
        <div class="entry-title"><span>${kmFmt(r.km)}</span></div>
        <div class="entry-sub">${dayLabel(r.date)}${delta > 0 ? ` · +${kmFmt(delta)}` : ''}</div>
      </div>
      <div class="entry-amount">✕</div>`;
    btn.addEventListener('click', async () => {
      if (!confirm(`Eintrag vom ${dayLabel(r.date)} löschen?`)) return;
      await db.deleteReading(r.id);
      await reload();
      toast('Gelöscht');
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function renderSettings() {
  const f = $('#settings-form').elements;
  const s = state.settings;
  f.bikeName.value = s.bikeName;
  f.purchaseDate.value = s.purchaseDate;
  f.purchaseOdometerKm.value = s.purchaseOdometerKm ?? 0;
  const purchase = findPurchase();
  f.purchasePrice.value = purchase ? (purchase.amountCents / 100).toFixed(2).replace('.', ',') : '';

  const list = $('#recurring-list');
  list.textContent = '';
  if (!state.recurring.length) {
    list.innerHTML = '<li><p class="empty">Keine wiederkehrenden Ausgaben.</p></li>';
    return;
  }
  for (const r of state.recurring) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'entry';
    btn.type = 'button';
    btn.innerHTML = `
      <div class="entry-main">
        <div class="entry-title">
          <i class="swatch" style="background:var(--series-${categorySlot(r.category)})"></i>
          <span>${escapeHtml(r.label)}</span>
        </div>
        <div class="entry-sub">${intervalLabel(r.interval)} · ab ${dayLabel(r.startDate)}${r.endDate ? ` bis ${dayLabel(r.endDate)}` : ''}</div>
      </div>
      <div class="entry-amount">${money(r.amountCents)}</div>`;
    btn.addEventListener('click', () => openRecurring(r));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

const findPurchase = () => state.expenses.find((e) => e.isPurchase);
const maxDate = (a, b) => (a > b ? a : b);

/* ----------------------------------------------------------- expense sheet */

let editing = null;

function buildChips() {
  const host = $('#category-chips');
  host.textContent = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.category = c.id;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<i class="swatch" style="background:var(--series-${c.slot})"></i>${c.label}`;
    b.addEventListener('click', () => selectChip(c.id));
    host.appendChild(b);
  }
}

function selectChip(id) {
  $$('#category-chips .chip').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.category === id))
  );
}

const selectedChip = () =>
  $('#category-chips .chip[aria-pressed="true"]')?.dataset.category ?? 'other';

function openExpense(expense = null) {
  editing = expense;
  const dlg = $('#expense-dialog');
  const f = $('#expense-form').elements;
  $('#expense-title').textContent = expense ? 'Ausgabe bearbeiten' : 'Ausgabe erfassen';
  $('#expense-error').hidden = true;
  $('#expense-delete').hidden = !expense;
  f.amount.value = expense ? (expense.amountCents / 100).toFixed(2).replace('.', ',') : '';
  f.date.value = expense ? expense.date : state.today;
  f.note.value = expense?.note ?? '';
  selectChip(expense?.category ?? 'maintenance');
  dlg.showModal();
  if (!expense) setTimeout(() => f.amount.focus(), 50);
}

async function saveExpense(ev) {
  ev.preventDefault();
  const f = $('#expense-form').elements;
  const cents = parseAmountToCents(f.amount.value);
  const err = $('#expense-error');

  if (!Number.isFinite(cents) || cents === 0) {
    return showError(err, 'Bitte einen Betrag eingeben, z. B. 24,90.');
  }
  if (Number.isNaN(parseISO(f.date.value))) {
    return showError(err, 'Bitte ein gültiges Datum wählen.');
  }
  if (f.date.value < state.settings.purchaseDate) {
    return showError(err, `Das Datum liegt vor dem Kaufdatum (${dayLabel(state.settings.purchaseDate)}).`);
  }

  const record = {
    ...(editing ?? {}),
    date: f.date.value,
    amountCents: cents,
    category: selectedChip(),
    note: f.note.value.trim(),
  };
  await db.putExpense(record);
  $('#expense-dialog').close();
  await reload();
  toast(editing ? 'Gespeichert' : `${money(cents)} erfasst`);
  editing = null;
}

async function deleteExpense() {
  if (!editing) return;
  if (editing.isPurchase && !confirm('Das ist der Kaufpreis. Wirklich löschen?')) return;
  if (!editing.isPurchase && !confirm('Diese Ausgabe löschen?')) return;
  await db.deleteExpense(editing.id);
  $('#expense-dialog').close();
  editing = null;
  await reload();
  toast('Gelöscht');
}

/* --------------------------------------------------------- recurring sheet */

let editingRule = null;

function openRecurring(rule = null) {
  editingRule = rule;
  const f = $('#recurring-form').elements;
  $('#recurring-title').textContent = rule ? 'Wiederkehrende Ausgabe' : 'Neue wiederkehrende Ausgabe';
  $('#recurring-error').hidden = true;
  $('#recurring-delete').hidden = !rule;
  f.label.value = rule?.label ?? '';
  f.amount.value = rule ? (rule.amountCents / 100).toFixed(2).replace('.', ',') : '';
  f.interval.value = rule?.interval ?? 'monthly';
  f.category.value = rule?.category ?? 'insurance';
  f.startDate.value = rule?.startDate ?? state.today;
  f.endDate.value = rule?.endDate ?? '';
  $('#recurring-dialog').showModal();
}

async function saveRecurring(ev) {
  ev.preventDefault();
  const f = $('#recurring-form').elements;
  const cents = parseAmountToCents(f.amount.value);
  const err = $('#recurring-error');

  if (!f.label.value.trim()) return showError(err, 'Bitte eine Bezeichnung eingeben.');
  if (!Number.isFinite(cents) || cents === 0) return showError(err, 'Bitte einen Betrag eingeben.');
  if (Number.isNaN(parseISO(f.startDate.value))) return showError(err, 'Bitte eine erste Fälligkeit wählen.');
  if (f.endDate.value && f.endDate.value < f.startDate.value) {
    return showError(err, 'Die letzte Fälligkeit liegt vor der ersten.');
  }

  const rule = {
    id: editingRule?.id ?? `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    label: f.label.value.trim(),
    amountCents: cents,
    interval: f.interval.value,
    category: f.category.value,
    startDate: f.startDate.value,
    endDate: f.endDate.value || null,
  };

  state.recurring = editingRule
    ? state.recurring.map((r) => (r.id === rule.id ? rule : r))
    : [...state.recurring, rule];
  await db.setRecurring(state.recurring);

  // Changing amount or category must not leave already-generated rows stale.
  if (editingRule) await syncGeneratedRows(rule);
  const created = await materialise([rule], state.today);

  $('#recurring-dialog').close();
  editingRule = null;
  await reload();
  toast(created ? `${created} Buchung${created === 1 ? '' : 'en'} eingetragen` : 'Gespeichert');
}

/** Rewrites the already-materialised rows of a rule after it was edited. */
async function syncGeneratedRows(rule) {
  const rows = state.expenses.filter((e) => e.recurringId === rule.id);
  for (const row of rows) {
    const stillDue = row.date >= rule.startDate && (!rule.endDate || row.date <= rule.endDate);
    if (!stillDue) {
      await db.deleteExpense(row.id);
    } else if (row.amountCents !== rule.amountCents || row.category !== rule.category) {
      await db.putExpense({ ...row, amountCents: rule.amountCents, category: rule.category });
    }
  }
}

async function deleteRecurring() {
  if (!editingRule) return;
  const rows = state.expenses.filter((e) => e.recurringId === editingRule.id);
  const keep = rows.length
    ? confirm(`${rows.length} bereits eingetragene Buchung(en) behalten?\n\nOK = behalten, Abbrechen = ebenfalls löschen.`)
    : true;
  if (!keep) for (const row of rows) await db.deleteExpense(row.id);

  state.recurring = state.recurring.filter((r) => r.id !== editingRule.id);
  await db.setRecurring(state.recurring);
  $('#recurring-dialog').close();
  editingRule = null;
  await reload();
  toast('Regel gelöscht');
}

/* -------------------------------------------------------------- settings -- */

async function saveSettings(ev) {
  ev.preventDefault();
  const f = ev.target.elements;
  if (Number.isNaN(parseISO(f.purchaseDate.value))) return toast('Bitte ein gültiges Kaufdatum wählen.');

  state.settings = {
    bikeName: f.bikeName.value.trim() || 'Mein Rad',
    purchaseDate: f.purchaseDate.value,
    purchaseOdometerKm: Number(f.purchaseOdometerKm.value || 0),
  };
  await db.setSettings(state.settings);

  const price = parseAmountToCents(f.purchasePrice.value || '0');
  const purchase = findPurchase();
  if (Number.isFinite(price) && price > 0) {
    await db.putExpense({
      ...(purchase ?? {}), date: state.settings.purchaseDate,
      amountCents: price, category: 'bike',
      note: purchase?.note || 'Kaufpreis', isPurchase: true,
    });
  } else if (purchase) {
    await db.deleteExpense(purchase.id);
  }
  await reload();
  toast('Gespeichert');
}

/* ------------------------------------------------------------ import/export */

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => state.today.replace(/-/g, '');

async function exportJson() {
  const data = await db.exportAll();
  download(`rad-kosten-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('Sicherung erstellt');
}

function exportCsv() {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Datum', 'Betrag EUR', 'Kategorie', 'Notiz', 'Wiederkehrend'].join(';')];
  for (const e of [...state.expenses].reverse()) {
    lines.push([
      e.date,
      (e.amountCents / 100).toFixed(2).replace('.', ','), // German decimal comma for Excel
      esc(categoryLabel(e.category)),
      esc(e.note || ''),
      e.recurringId ? 'ja' : 'nein',
    ].join(';'));
  }
  download(`rad-kosten-${stamp()}.csv`, `﻿${lines.join('\r\n')}`, 'text/csv');
  toast('CSV erstellt');
}

async function importJson(file) {
  try {
    const payload = JSON.parse(await file.text());
    const count = (payload.expenses || []).length;
    if (!confirm(`${count} Ausgabe(n) aus der Sicherung laden?\n\nAchtung: die aktuellen Daten werden dabei ersetzt.`)) return;
    await db.importAll(payload);
    location.reload();
  } catch (err) {
    toast(`Import fehlgeschlagen: ${err.message}`);
  }
}

async function wipe() {
  if (!confirm('Wirklich alle Daten löschen? Das lässt sich nicht rückgängig machen.')) return;
  if (!confirm('Sicher? Ohne Sicherung sind die Daten endgültig weg.')) return;
  await db.importAll({ format: 'bike-tracker', version: 1, settings: {}, recurring: [], expenses: [], odometer: [] });
  location.reload();
}

/* ------------------------------------------------------------------ misc -- */

function showView(name) {
  for (const v of ['dashboard', 'history', 'odo', 'settings']) {
    $(`#view-${v}`).hidden = v !== name;
  }
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
  window.scrollTo({ top: 0 });
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function showError(node, text) {
  node.textContent = text;
  node.hidden = false;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function wire() {
  buildChips();
  $('#recurring-category').innerHTML = CATEGORIES
    .map((c) => `<option value="${c.id}">${c.label}</option>`).join('');

  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  $('#fab').addEventListener('click', () => openExpense());
  $('#expense-form').addEventListener('submit', saveExpense);
  $('#expense-delete').addEventListener('click', deleteExpense);
  $('#add-recurring').addEventListener('click', () => openRecurring());
  $('#recurring-form').addEventListener('submit', saveRecurring);
  $('#recurring-delete').addEventListener('click', deleteRecurring);
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#odo-form').addEventListener('submit', saveReading);
  $('#odo-form').elements.date.value = state.today;

  $('#export-json').addEventListener('click', exportJson);
  $('#export-csv').addEventListener('click', exportCsv);
  $('#import-json').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });
  $('#wipe').addEventListener('click', wipe);

  // Crossing midnight with the app open would otherwise freeze "today".
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    const now = todayISO();
    if (now === state.today) return;
    state.today = now;
    await materialise(state.recurring, state.today);
    await reload();
  });

  reportStorage();
}

async function saveReading(ev) {
  ev.preventDefault();
  const f = ev.target.elements;
  const km = Number(f.km.value);
  if (!Number.isFinite(km) || km < 0) return toast('Bitte einen gültigen Kilometerstand eingeben.');
  await db.putReading({ date: f.date.value, km });
  f.km.value = '';
  await reload();
  toast('Kilometerstand gespeichert');
}

async function reportStorage() {
  const note = $('#storage-note');
  if (!navigator.storage?.persist) return;
  try {
    const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    note.textContent = persisted
      ? 'Der Browser sichert die Daten dauerhaft. Trotzdem ab und zu exportieren.'
      : 'Der Browser darf die Daten bei Platzmangel löschen — leg regelmäßig eine Sicherung an.';
  } catch { /* Storage API unavailable — the generic hint above already covers it. */ }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Neue Version geladen — App neu öffnen.');
        }
      });
    });
  }).catch(() => { /* Insecure origin (plain http): the app still works online. */ });

  navigator.serviceWorker.ready.then((reg) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => { $('#sw-version').textContent = e.data; };
    // reg.active rather than .controller: on the very first load the page is
    // not yet controlled, and the version would stay blank.
    reg.active?.postMessage('version', [ch.port2]);
  });
}

boot().catch((err) => {
  document.body.innerHTML =
    `<section class="setup"><div class="setup-inner"><h1>Fehler beim Start</h1><p class="lead">${escapeHtml(err.message)}</p></div></section>`;
});
