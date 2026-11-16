// The board: every open bounty, one request, filtered in the browser and virtualised so the list
// costs the same whether it holds 16 rows or 160. Each row shows, in reading order, the title, the
// live pot (the reward plus the entry fees paid into it), the entry fee, the time left, and the
// number of entries — the four things that decide whether a bounty is worth a click.

import { cachedGet } from '../api.js';
import { el, setText, virtualList } from '../dom.js';
import { closingSoon, count, money, timeLeft } from '../format.js';

/** The one request the board makes. */
const BOARD_PATH = '/competitions?status=open&activity=times';
/** Countdowns are minute-granular, so a 30 s tick is enough and costs no request. */
const TICK_MS = 30000;

const potOf = (bounty) => money(bounty.potUsd == null ? bounty.rewardAmount : bounty.potUsd);

/** The API still lists a bounty whose deadline just passed, so live ones sort first, then by
 *  deadline: the list leads with what a reader can still enter, soonest first. */
function byDeadline(a, b) {
  const now = Date.now();
  const leftA = new Date(a.deadline).getTime() - now;
  const leftB = new Date(b.deadline).getTime() - now;
  if ((leftA > 0) !== (leftB > 0)) return leftA > 0 ? -1 : 1;
  return leftA - leftB;
}

function chipRow(bounty) {
  const fee = bounty.entryFeeUsd ? `${money(bounty.entryFeeUsd)} entry` : 'free entry';
  return el('span', { class: 'chips' }, [
    el('span', { class: bounty.entryFeeUsd ? 'chip fee' : 'chip', text: fee }),
    el('span', { class: `chip time${closingSoon(bounty.deadline) ? ' soon' : ''}`, text: timeLeft(bounty.deadline) }),
    el('span', { class: 'chip', text: `${count(bounty.submissionCount)} entries` }),
  ]);
}

export async function mount({ root, signal, setTitle }) {
  setTitle('Open bounties · make.fun');

  const search = document.getElementById('q');
  const heading = el('h1', { text: 'Open bounties' });
  const summary = el('p', { class: 'sub' });
  const list = el('div', { class: 'board' });
  root.replaceChildren(heading, summary, list);

  const owned = new AbortController(); // refresh()'s fetches, cancelled when the route changes
  let all = [];
  let query = search.value;

  const renderRow = (bounty) =>
    el('a', { class: 'row', href: `#/bounty/${encodeURIComponent(bounty.slug)}` }, [
      el('span', { class: 'title', text: bounty.title }),
      el('span', { class: 'pot', text: potOf(bounty) }),
      chipRow(bounty),
    ]);

  // The row height lives in the stylesheet (`.board{--rowh:...}`): 116 px on a phone, where the three
  // chips wrap, 96 px from 700 px up. virtualList reads it, so the breakpoint needs no JS copy.
  const rows = virtualList(list, all, renderRow, { overscan: 4 });

  /** Re-filter, re-sum and repaint. Called on mount, on every keystroke and on every tick; it never
   *  rebuilds the page, it swaps the row list the virtual window is showing. */
  function paint() {
    const needle = query.trim().toLowerCase();
    const shown = needle ? all.filter((bounty) => String(bounty.title || '').toLowerCase().includes(needle)) : all;
    rows.update(shown);
    if (needle) {
      setText(summary, `${count(shown.length)} of ${count(all.length)} bounties match “${query.trim()}”`);
      return;
    }
    const pot = all.reduce((sum, bounty) => sum + Number(bounty.potUsd == null ? bounty.rewardAmount : bounty.potUsd), 0);
    const entries = all.reduce((sum, bounty) => sum + Number(bounty.submissionCount || 0), 0);
    setText(summary, `${count(all.length)} open · ${money(pot)} in pots · ${count(entries)} entries`);
  }

  function accept(data) {
    all = (data.items || []).slice().sort(byDeadline);
    paint();
  }

  accept(await cachedGet(BOARD_PATH, { signal }));

  const onInput = () => {
    query = search.value;
    paint();
  };
  search.addEventListener('input', onInput);
  const tick = setInterval(paint, TICK_MS);

  return {
    /** Revalidate in the background and patch: the header, the list and the scroll position stay. */
    async refresh() {
      accept(await cachedGet(BOARD_PATH, { signal: owned.signal, fresh: true }));
    },
    destroy() {
      clearInterval(tick);
      search.removeEventListener('input', onInput);
      owned.abort();
      rows.destroy();
    },
  };
}
