// A bounty's leaderboard: one request, then the whole ranking through a virtual list, so 218 rows
// and 5914 rows cost the same twenty nodes. The metric columns come from the API's own `columns`
// (a bounty scored on judge win rate and one scored on CPU microseconds both work), and the header
// is built from the same array, so the table cannot drift from the data.

import { cachedGet } from '../api.js';
import { el, setText, virtualList } from '../dom.js';
import { count, date, timeLeft } from '../format.js';

/** Two metrics fit a phone; the rest of the columns are already in the same entry object. */
const METRIC_COLUMNS = 2;

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

export async function mount({ root, params, signal, setTitle }) {
  const path = `/competitions/${encodeURIComponent(params.slug)}/leaderboard`;
  const data = await cachedGet(path, { signal });
  const competition = data.competition || {};
  const phase = data.phase || {};
  const columns = (data.columns || []).filter((column) => !column.hidden).slice(0, METRIC_COLUMNS);
  const entries = data.entries || [];
  setTitle(`Leaderboard · ${competition.title || params.slug} · make.fun`);

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

  const renderRow = (entry) => {
    const detail = entry.title || entry.submission_id || '';
    const status = entry.status && entry.status !== 'finished' ? ` · ${entry.status}` : '';
    return el('a', { class: 'lbrow', href: `#/u/${encodeURIComponent(entry.handle || '')}`, style: { 'grid-template-columns': template } }, [
      el('span', { class: `rank${entry.rank <= 3 ? ' prize' : ''}`, text: entry.rank == null ? '—' : `#${entry.rank}` }),
      el('span', { class: 'who' }, [
        entry.handle || 'unknown',
        el('em', { text: `${detail}${status}` }),
      ]),
      columns.map((column) => el('span', { class: 'val', text: metric(entry, column) })),
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
    rows.update(next.entries || []);
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
