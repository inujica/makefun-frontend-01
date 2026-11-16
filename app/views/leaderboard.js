// A bounty's leaderboard: one request, then the whole ranking through a virtual list, so 218 rows
// and 5914 rows cost the same twenty nodes. The metric columns come from the API's own `columns`
// (a bounty scored on judge win rate and one scored on CPU microseconds both work), and the header
// is built from the same array, so the table cannot drift from the data.

import { absoluteUrl, cachedGet } from '../api.js';
import { el, setText, virtualList } from '../dom.js';
import { count, date, timeLeft } from '../format.js';

/** Two metrics fit a phone; the rest of the columns are already in the same entry object. */
const METRIC_COLUMNS = 2;

/** Rules only this table needs, so they cost nothing on the first load: this file arrives by
 *  import() with the view. One <style>, added once, no request. */
const CSS = `
.lb .avs,.lb .avf{width:30px;height:30px;flex:0 0 auto;font-size:.78rem}
.lb .avs{border-radius:50%;border:var(--bd);background:var(--c2);object-fit:cover}
.who{display:flex;align-items:center;gap:8px}
.wt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tie{margin-left:6px;padding:0 5px;border:var(--bd);border-radius:99px;font-size:.58rem;font-style:normal;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--d);vertical-align:1px}
.vt{display:block;width:100%;height:5px;margin-top:4px;border-radius:3px;background:#22313d;overflow:hidden}
.bar{display:block;height:100%;border-radius:3px;background:var(--ok);width:var(--w)}
.lbrange{margin:4px 0 0;font-size:.7rem;color:var(--d)}
@media(min-width:700px){.lb.vlist{height:calc(100vh - 272px)}}
`;

/** Add the table's stylesheet once per document; a second mount must not stack a second copy. */
function installStyles() {
  if (document.getElementById('lb-css')) return;
  const style = el('style', { id: 'lb-css', text: CSS });
  document.head.append(style);
}

/**
 * One metric as make.fun's own leaderboard prints it: a `_micro` source is a fraction in
 * millionths, so 950587 is '95.0587%'; any other column keeps the API's display string with
 * thousands separators. Without this the table would show 950587 under "Judge win rate".
 */
function metric(entry, column) {
  const display = entry.display ? entry.display[column.key] : null;
  if (display == null || display === '' || display === 'n/a') return '—';
  if (String(column.source || '').endsWith('_micro')) {
    const percent = Number(display) / 10000;
    return Number.isFinite(percent) ? `${percent.toFixed(4)}%` : display;
  }
  const number = Number(display);
  return Number.isFinite(number) ? count(number) : display;
}

/** A rate column's value in percent: '950587' -> 95.0587, or null for a column that is not a rate (a
 *  byte count has no 100 % to be a fraction of, so it gets no bar). */
function rateValue(entry, column) {
  if (!String(column.source || '').endsWith('_micro')) return null;
  const display = entry.display ? entry.display[column.key] : null;
  if (display == null || display === '') return null;
  const value = Number(display) / 10000;
  return Number.isFinite(value) ? value : null;
}

/**
 * The range the bars are drawn against: this column's lowest and highest rate over the rows the table
 * is painting right now — the virtual window, not the field. A field where every entry sits between
 * 93 % and 95 % is unreadable as absolute width (every bar would be 95 % full), and its outliers are
 * unreadable as a field range too (every bar would be ~100 % full): measured over the rows on screen,
 * the whole track is spent on the differences a reader can actually see. Null when none of those rows
 * has a rate in this column.
 */
function windowRange(rows, column) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const entry of rows) {
    const rate = rateValue(entry, column);
    if (rate == null) continue;
    if (rate < lo) lo = rate;
    if (rate > hi) hi = rate;
  }
  return lo === Infinity ? null : { lo, hi };
}

/** A rate as a fraction of the rows on screen's range: 0 % of the track at the lowest rate in the
 *  window, 100 % at the highest. A level window (one row, or all equal) draws every bar at half,
 *  never a division by zero. */
function barWidth(rate, range) {
  if (!range) return null;
  if (range.hi === range.lo) return 50;
  return ((rate - range.lo) / (range.hi - range.lo)) * 100;
}

const percent = (value) => `${value.toFixed(2)}%`;

/**
 * The legend the bars need, with the numbers it was computed from. A bar zoomed to the rows on screen
 * magnifies the differences between them, and this line says what it is magnifying: without it the bar
 * would be a lie by omission. It is rewritten whenever the window moves, so it always names the rows
 * that are actually drawn.
 */
function captionOf(ranges, rateColumns) {
  const parts = [];
  let level = true;
  for (const column of rateColumns) {
    const range = ranges.get(column.key);
    if (!range) continue;
    if (range.hi !== range.lo) level = false;
    const span = range.hi === range.lo ? 'level' : `${percent(range.lo)}–${percent(range.hi)}`;
    parts.push(rateColumns.length > 1 ? `${column.title} ${span}` : span);
  }
  if (!parts.length) return '';
  if (level) return 'all rows on screen level';
  return rateColumns.length > 1
    ? `bars span the rows on screen: ${parts.join(' · ')}`
    : `bars span the rows on screen: ${parts[0]}`;
}

/** A stable hue per handle, so an entry without a picture still gets its own colour. */
function hueOf(text) {
  let hash = 0;
  for (const character of String(text || '?')) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

/** The letter a row falls back to when make.fun has no avatar for it, or its avatar will not load:
 *  a coloured initial, drawn in CSS, costing no request. */
const initial = (handle) =>
  el('span', { class: 'avf', 'aria-hidden': 'true', text: (handle || '?').slice(0, 1), style: { '--h': hueOf(handle) } });

/**
 * A 28 px round avatar. make.fun sends `Cross-Origin-Resource-Policy: same-origin` on /api/avatars,
 * so the image only loads as a CORS request: crossorigin is set before src, and an error swaps in
 * the initial rather than leaving a broken-image row.
 */
function avatar(handle, image) {
  const url = absoluteUrl(image);
  if (!url) return initial(handle);
  const node = el('img', {
    class: 'avs',
    alt: '',
    width: '30',
    height: '30',
    loading: 'lazy',
    decoding: 'async',
    crossorigin: 'anonymous',
  });
  node.addEventListener('error', () => node.replaceWith(initial(handle)));
  node.src = url;
  return node;
}

export async function mount({ root, params, signal, setTitle }) {
  const path = `/competitions/${encodeURIComponent(params.slug)}/leaderboard`;
  const data = await cachedGet(path, { signal });
  const competition = data.competition || {};
  const phase = data.phase || {};
  const columns = (data.columns || []).filter((column) => !column.hidden).slice(0, METRIC_COLUMNS);
  const entries = data.entries || [];
  setTitle(`Leaderboard · ${competition.title || params.slug} · make.fun`);
  installStyles();

  // The column a tie is read from: the ranking metric itself (the first rate), else the first column.
  const rateColumn = columns.find((column) => String(column.source || '').endsWith('_micro')) || columns[0] || null;
  // The columns that get a bar: the rates. Their ranges are measured over the rows on screen, in
  // onWindow(), every time the window moves.
  const rateColumns = columns.filter((column) => String(column.source || '').endsWith('_micro'));
  let ranges = new Map(); // column key -> { lo, hi } | null, over the rows the window is painting

  // One grid template for the header and every row, so the columns line up by construction.
  const template = `44px minmax(0,1fr)${' 74px'.repeat(columns.length)}`;

  const summary = el('p', { class: 'sub' });
  // The header row is a .lbrow with the labels' own type set inline, so the table needs no second
  // grid rule in the stylesheet.
  const head = el(
    'div',
    {
      class: 'lbrow',
      style: {
        'grid-template-columns': template,
        'font-size': '.65rem',
        'text-transform': 'uppercase',
        color: 'var(--d)',
      },
    },
    [el('span', { text: 'Rank' }), el('span', { text: 'Entry' })].concat(
      columns.map((column) => el('span', { text: column.title, style: { 'text-align': 'right' } })),
    ),
  );
  const list = el('div', { class: 'lb' });
  // The bars are drawn against the rows on screen, so they need a legend saying which range that is:
  // it sits between the header and the rows, one muted line, rewritten by onWindow() as they move.
  const rangeNote = el('p', { class: 'lbrange' });
  root.replaceChildren(
    el('div', { class: 'crumbs' }, [
      el('a', { href: `#/bounty/${encodeURIComponent(params.slug)}`, text: `← ${competition.title || params.slug}` }),
    ]),
    el('h1', { text: data.title || 'Leaderboard' }),
    summary,
    el('div', {}, [head, rangeNote, list]),
  );

  // The rows the virtual window is painting: a tie is read from the row above it in this list.
  let showing = entries;

  /** A metric cell: the number, and under a rate a bar whose width is that rate within this field's
   *  range — in addition to the number, never instead of it. */
  function metricCell(entry, column) {
    const text = metric(entry, column);
    const rate = rateValue(entry, column);
    const width = rate == null ? null : barWidth(rate, ranges.get(column.key));
    if (width == null) return el('span', { class: 'val', text });
    return el('span', { class: 'val' }, [
      text,
      el('span', { class: 'vt', 'aria-hidden': 'true' }, [
        el('span', { class: 'bar', style: { '--w': `${width.toFixed(2)}%` } }),
      ]),
    ]);
  }

  const renderRow = (entry, index) => {
    const handle = entry.handle || 'unknown';
    const detail = entry.title || entry.submission_id || '';
    const status = entry.status && entry.status !== 'finished' ? ` · ${entry.status}` : '';
    const previous = index > 0 ? showing[index - 1] : null;
    const tie = Boolean(
      previous && rateColumn && metric(entry, rateColumn) !== '—' && metric(entry, rateColumn) === metric(previous, rateColumn),
    );
    return el('a', { class: 'lbrow', href: `#/u/${encodeURIComponent(entry.handle || '')}`, style: { 'grid-template-columns': template } }, [
      el('span', { class: `rank${entry.rank <= 3 ? ' prize' : ''}`, text: entry.rank == null ? '—' : `#${entry.rank}` }),
      el('span', { class: 'who' }, [
        avatar(handle, entry.image),
        el('span', { class: 'wt' }, [
          handle,
          tie ? el('i', { class: 'tie', title: 'same rate as the entry above', text: 'tie' }) : null,
          el('em', { text: `${detail}${status}` }),
        ]),
      ]),
      columns.map((column) => metricCell(entry, column)),
    ]);
  };

  const rows = virtualList(list, entries, renderRow, {
    overscan: 5, // height: `.lb{--rowh:64px}`
    // The bars measure the rows on screen, so every window the list paints rescales them: the ranges
    // are taken over exactly the rows about to be built, then the caption is rewritten to say so.
    // A handful of numbers per scroll frame, and the widths are in place before the rows are drawn.
    onWindow(start, end, items) {
      const onScreen = items.slice(start, end);
      ranges = new Map(rateColumns.map((column) => [column.key, windowRange(onScreen, column)]));
      setText(rangeNote, captionOf(ranges, rateColumns));
      rangeNote.hidden = rangeNote.textContent === '';
    },
  });

  function paint(next) {
    const ranked = (next.entries || []).filter((entry) => entry.ranked).length;
    const phaseText = next.phase && next.phase.title ? `${next.phase.title} phase` : 'live';
    const ends = next.phase && next.phase.ends_at ? ` · ${timeLeft(next.phase.ends_at)}` : '';
    const closed = next.phase && next.phase.finalized_at ? ` · finalised ${date(next.phase.finalized_at)}` : '';
    setText(
      summary,
      `${phaseText} · ${count(ranked)} ranked of ${count((next.entries || []).length)} entries${ends}${closed}`,
    );
    showing = next.entries || [];
    // A reload replaces the rows, and rows.update() repaints the window, which rescales the bars with
    // the data instead of pinning them to whatever the first answer held.
    rows.update(showing);
  }

  paint(data);

  const owned = new AbortController();
  return {
    async refresh() {
      paint(await cachedGet(path, { signal: owned.signal, fresh: true }));
    },
    destroy() {
      owned.abort();
      rows.destroy();
    },
  };
}
