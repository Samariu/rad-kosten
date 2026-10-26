// Thin promise wrapper over IndexedDB. All data lives on this device only.

const DB_NAME = 'bike-tracker';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('expenses')) {
        const s = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date');
        // Unique, and only recurring-generated rows carry the key — IndexedDB
        // skips records where the indexed property is undefined, so this
        // enforces "one row per occurrence" without touching manual entries.
        s.createIndex('occurrenceKey', 'occurrenceKey', { unique: true });
      }
      if (!db.objectStoreNames.contains('odometer')) {
        const s = db.createObjectStore('odometer', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank blockiert — bitte andere Tabs schließen.'));
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const all = (store) => tx(store, 'readonly', (s) => s.getAll());

/* ------------------------------------------------------------- expenses -- */

export const getExpenses = () =>
  all('expenses').then((rows) => rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)));

export const putExpense = (e) => tx('expenses', 'readwrite', (s) => s.put(e));
export const deleteExpense = (id) => tx('expenses', 'readwrite', (s) => s.delete(id));

/** Adds an occurrence unless one already exists. Resolves to false if it did. */
export function addOccurrence(expense) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction('expenses', 'readwrite');
        const req = t.objectStore('expenses').add(expense);
        let added = true;
        req.onerror = (ev) => {
          // A ConstraintError means the occurrence is already there — that is
          // the idempotency guarantee doing its job, not a failure.
          if (req.error?.name === 'ConstraintError') {
            added = false;
            ev.preventDefault();
            ev.stopPropagation();
          }
        };
        t.oncomplete = () => resolve(added);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

/* ------------------------------------------------------------- odometer -- */

export const getReadings = () =>
  all('odometer').then((rows) => rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));

export const putReading = (r) => tx('odometer', 'readwrite', (s) => s.put(r));
export const deleteReading = (id) => tx('odometer', 'readwrite', (s) => s.delete(id));

/* ----------------------------------------------------------------- meta -- */

export const getMeta = (key) =>
  tx('meta', 'readonly', (s) => s.get(key)).then((row) => row?.value ?? null);

export const setMeta = (key, value) =>
  tx('meta', 'readwrite', (s) => s.put({ key, value }));

export const DEFAULT_SETTINGS = {
  bikeName: 'Mein Rad',
  purchaseDate: null,
  purchaseOdometerKm: 0,
};

export const getSettings = () =>
  getMeta('settings').then((v) => ({ ...DEFAULT_SETTINGS, ...(v || {}) }));

export const setSettings = (s) => setMeta('settings', s);

export const getRecurring = () => getMeta('recurring').then((v) => v || []);
export const setRecurring = (list) => setMeta('recurring', list);

/* --------------------------------------------------------- export/import -- */

export async function exportAll() {
  const [settings, recurring, expenses, odometer] = await Promise.all([
    getSettings(), getRecurring(), all('expenses'), all('odometer'),
  ]);
  return {
    format: 'bike-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings, recurring, expenses, odometer,
  };
}

/** Destructive: wipes every store, then writes the imported payload. */
export async function importAll(payload) {
  if (!payload || payload.format !== 'bike-tracker') {
    throw new Error('Keine gültige Bike-Tracker-Sicherung.');
  }
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['expenses', 'odometer', 'meta'], 'readwrite');
    const expenses = t.objectStore('expenses');
    const odometer = t.objectStore('odometer');
    const meta = t.objectStore('meta');
    expenses.clear();
    odometer.clear();
    meta.clear();
    for (const e of payload.expenses || []) expenses.put(e);
    for (const r of payload.odometer || []) odometer.put(r);
    meta.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, ...(payload.settings || {}) } });
    meta.put({ key: 'recurring', value: payload.recurring || [] });
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
