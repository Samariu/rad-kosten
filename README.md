# Rad-Kosten — bike expense PWA

An installable, offline web app that tracks what your bike costs you. Log
expenses, and it answers the question it exists for: **how much per month, and
how much per day** — plus cost per kilometre once you've entered a couple of
odometer readings.

- **No build step, no dependencies.** Plain HTML, CSS and ES modules.
- **All data stays on your device** (IndexedDB). No account, no server, no
  network calls of any kind.
- **Works fully offline** once installed.

## What it computes

Everything is measured from the bike's purchase date, and the purchase price is
stored as an ordinary expense on that date — so it counts towards the lifetime
figure and correctly drops out of the rolling windows once it ages past them.

| Figure | How |
|---|---|
| Cost per day | total spend ÷ days owned (inclusive, floored at 1) |
| Cost per month | cost per day × 30.4375 (365.25/12 — an average month, so the number doesn't jump at month boundaries) |
| Last 30 / 90 days | spend in that window ÷ window length, never reaching back past the purchase date |
| Cost per km | total spend ÷ (latest odometer reading − odometer at purchase) |

Money is stored as integer cents throughout, so totals always match the sum of
the rows on screen.

## Run it locally

Service workers need a secure context, which `localhost` counts as — but
`file://` does not, so open it through a server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

```sh
git init && git add -A && git commit -m "Rad-Kosten"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then in the repository: **Settings → Pages → Source: GitHub Actions**. The
included workflow (`.github/workflows/pages.yml`) runs the tests and publishes
the repository root on every push to `main`.

Every path in the app is relative, so it works from the `/<repo>/` subpath Pages
serves from without any configuration.

### Install on your phone

Open the HTTPS Pages URL, then:

- **Android / Chrome** — menu → *Add to Home screen*
- **iOS / Safari** — Share → *Zum Home-Bildschirm*

It then launches full-screen and works with no connection.

## Tests

```sh
node --test test.js      # cost math, date handling, recurring occurrences
```

There is also an end-to-end UI test that boots the real app against a DOM. It
needs two packages, which are deliberately **not** committed as dependencies so
the app itself stays dependency-free — install them ad hoc:

```sh
npm install --no-save jsdom fake-indexeddb
node test-ui.mjs
```

## Files

| File | Role |
|---|---|
| `index.html` | every view, as sections of one page |
| `app.js` | view routing, rendering, event wiring |
| `calc.js` | all cost math — DOM-free, so it's unit-testable |
| `db.js` | IndexedDB wrapper, export/import |
| `recurring.js` | materialises recurring expenses into real rows |
| `charts.js` | the two charts, hand-written |
| `format.js` | EUR / km / date formatting (de-DE) |
| `sw.js` | offline cache |
| `tools/make-icons.js` | regenerates the icons (dependency-free rasteriser) |

### After changing a shell file

Bump `CACHE_VERSION` in `sw.js`. The worker also revalidates in the background,
so a missed bump self-corrects on the second load — but bumping makes the update
land immediately.

## Recurring expenses

Rules live in settings and are **materialised** on each app open: every due date
gets written out as a real expense row, keyed so re-running can never duplicate
it. That means past entries stay individually editable and deletable, and every
calculation only ever sees plain expenses.

Editing a rule's amount or category rewrites the rows it already generated.
Deleting a rule asks whether to keep them.

## Backups

Settings → *Sicherung (JSON)* writes a complete dump; *Sicherung laden* restores
one (replacing what's there). *Tabelle (CSV)* exports the expense list with
German decimal commas and a BOM, so Excel opens it correctly.

Browsers may evict site data under storage pressure. The app asks for persistent
storage on first run, and tells you in Settings whether it was granted — but
export now and then anyway.
