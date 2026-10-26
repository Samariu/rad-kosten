// Two charts, hand-written. No chart library — the app has zero dependencies.
// Colors come from CSS custom properties (see styles.css) so light/dark swap in
// one place; see the dataviz palette these values were validated against.

import { money, monthTick, monthLabel, yearOf } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/** Rounded at the data end, square at the baseline. */
function columnPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0.5) return `M${x},${y + h}h${w}`;
  return `M${x},${y + h}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${y + h}Z`;
}

/** Round an axis maximum up to a clean 1/2/2.5/5 × 10^n number. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/* ---------------------------------------------------------- shared tooltip -- */

function attachTooltip(container) {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  container.appendChild(tip);
  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.hidden = false;
      const box = container.getBoundingClientRect();
      const w = tip.offsetWidth;
      // Keep the tooltip inside the card on a narrow phone screen.
      const left = Math.max(4, Math.min(x - w / 2, box.width - w - 4));
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
    },
    hide() { tip.hidden = true; },
  };
}

/* -------------------------------------------------- category breakdown ----- */

/**
 * Horizontal bars, one per category, sorted by spend. Built from HTML rather
 * than SVG so the category names wrap and never get clipped.
 * Every row is directly labelled with its name and value, which is also the
 * relief for the light-mode hues that sit below 3:1 against the surface.
 */
export function renderBreakdown(container, rows) {
  container.textContent = '';
  if (!rows.length) {
    container.append(emptyNote('Noch keine Ausgaben erfasst.'));
    return;
  }
  const max = Math.max(...rows.map((r) => r.cents));
  const total = rows.reduce((a, r) => a + r.cents, 0);

  const list = document.createElement('ul');
  list.className = 'breakdown';
  for (const row of rows) {
    const li = document.createElement('li');
    const share = total > 0 ? Math.round((row.cents / total) * 100) : 0;
    li.innerHTML = `
      <div class="breakdown-head">
        <span class="breakdown-name"><i class="swatch" style="background:var(--series-${row.slot})"></i>${row.label}</span>
        <span class="breakdown-value">${money(row.cents)}</span>
      </div>
      <div class="breakdown-track">
        <div class="breakdown-bar" style="width:${max > 0 ? (row.cents / max) * 100 : 0}%;background:var(--series-${row.slot})"></div>
      </div>
      <div class="breakdown-share">${share}%</div>`;
    list.appendChild(li);
  }
  container.appendChild(list);
}

/* ------------------------------------------------------ monthly columns ---- */

/**
 * Spend per month. A single series, so no legend — the card title names it.
 * Re-renders on resize; returns a teardown function.
 */
export function renderMonthly(container, series) {
  container.textContent = '';
  if (series.length < 2) {
    container.append(emptyNote('Ab dem zweiten Monat erscheint hier der Verlauf.'));
    return () => {};
  }
  const tip = attachTooltip(container);
  const draw = () => {
    const width = Math.max(240, container.clientWidth);
    const height = 180;
    const pad = { top: 18, right: 8, bottom: 30, left: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const svg = el('svg', {
      viewBox: `0 0 ${width} ${height}`, width, height,
      role: 'img', 'aria-label': 'Ausgaben pro Monat',
    });

    const maxCents = niceMax(Math.max(...series.map((d) => d.cents), 1));
    const y = (c) => pad.top + plotH - (c / maxCents) * plotH;

    // Gridlines: hairline, solid, recessive; ticks carry the values the bars
    // don't get direct labels for.
    for (const frac of [0, 0.5, 1]) {
      const cents = maxCents * frac;
      const yy = y(cents);
      svg.appendChild(el('line', {
        x1: pad.left, x2: width - pad.right, y1: yy, y2: yy,
        stroke: frac === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1,
      }));
      const t = el('text', {
        x: pad.left - 8, y: yy + 4, 'text-anchor': 'end', class: 'tick',
      });
      t.textContent = frac === 0 ? '0' : `${Math.round(cents / 100)} €`;
      svg.appendChild(t);
    }

    // 2px surface gap between adjacent columns; cap thickness at 24px.
    const band = plotW / series.length;
    const barW = Math.max(3, Math.min(24, band - 2));
    const maxIdx = series.reduce((best, d, i) => (d.cents > series[best].cents ? i : best), 0);

    series.forEach((d, i) => {
      const x = pad.left + band * i + (band - barW) / 2;
      const h = (d.cents / maxCents) * plotH;
      const isLast = i === series.length - 1;
      svg.appendChild(el('path', {
        d: columnPath(x, y(d.cents), barW, h, 4),
        fill: isLast ? 'var(--series-1)' : 'var(--series-1-muted)',
      }));

      // Label selectively: the biggest month and the current one, and only
      // when the two are far enough apart not to collide.
      if ((i === maxIdx || isLast) && !(isLast && maxIdx === series.length - 2)) {
        const label = el('text', {
          x: x + barW / 2, y: y(d.cents) - 6, 'text-anchor': 'middle', class: 'bar-label',
        });
        label.textContent = Math.round(d.cents / 100).toLocaleString('de-DE') + ' €';
        svg.appendChild(label);
      }

      // Full-height hit target — bigger than the mark, so short bars are still
      // easy to hit with a thumb.
      const hit = el('rect', {
        x: pad.left + band * i, y: pad.top, width: band, height: plotH,
        fill: 'transparent', 'pointer-events': 'all',
      });
      const show = () => tip.show(
        `<strong>${monthLabel(d.month)}</strong><br>${money(d.cents)}`,
        pad.left + band * i + band / 2, y(d.cents)
      );
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', tip.hide);
      svg.appendChild(hit);
    });

    // Thin the x labels until they stop colliding.
    const step = Math.max(1, Math.ceil((series.length * 34) / plotW));
    series.forEach((d, i) => {
      if (i % step !== 0 && i !== series.length - 1) return;
      const showYear = i === 0 || d.month.endsWith('-01');
      const t = el('text', {
        x: pad.left + band * i + band / 2, y: height - 16,
        'text-anchor': 'middle', class: 'tick',
      });
      t.textContent = monthTick(d.month);
      svg.appendChild(t);
      if (showYear) {
        const yr = el('text', {
          x: pad.left + band * i + band / 2, y: height - 4,
          'text-anchor': 'middle', class: 'tick tick-year',
        });
        yr.textContent = yearOf(d.month);
        svg.appendChild(yr);
      }
    });

    const old = container.querySelector('svg');
    if (old) old.remove();
    container.prepend(svg);
  };

  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(container);
  return () => ro.disconnect();
}

function emptyNote(text) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}
