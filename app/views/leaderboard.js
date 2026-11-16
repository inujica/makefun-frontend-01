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

/** A rate column as the width of its bar: '950587' -> 95.0587, or null for a column that is not a
 *  rate (a byte count has no 100 % to be a fraction of, so it gets no bar). */
function rateWidth(entry, column) {
  if (!String(column.source || '').endsWith('_micro')) return null;
  const display = entry.display ? entry.display[column.key] : null;
  const percent = Number(display) / 10000;
  if (display == null || !Number.isFinite(percent)) return null;
  return Math.max(0, Math.min(100, percent));
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
  root.replaceChildren(
    el('div', { class: 'crumbs' }, [
      el('a', { href: `#/bounty/${encodeURIComponent(params.slug)}`, text: `← ${competition.title || params.slug}` }),
    ]),
    el('h1', { text: data.title || 'Leaderboard' }),
    summary,
    el('div', {}, [head, list]),
  );

  // The rows the virtual window is painting: a tie is read from the row above it in this list.
  let showing = entries;

  /** A metric cell: the number, and under a rate a bar whose width is that rate — in addition to
   *  the number, never instead of it. */
  function metricCell(entry, column) {
    const text = metric(entry, column);
    const width = rateWidth(entry, column);
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

  const rows = virtualList(list, entries, renderRow, { overscan: 5 }); // height: `.lb{--rowh:64px}`

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
