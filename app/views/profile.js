// An account's public profile: one request. The record line answers "is this person good?", the
// entries list answers "at what?", and the list is paged in the browser so a profile with 36 or 360
// entries costs the same first paint.

import { absoluteUrl, cachedGet } from '../api.js';
import { el, setText } from '../dom.js';
import { count, date, money } from '../format.js';

/** How many entries the list shows before the reader asks for more. */
const PAGE = 12;

/** A stat cell: the number on top, the label under it. */
const stat = (label, value) => el('div', { class: 'stat' }, [el('b', { text: value }), el('span', { text: label })]);

export async function mount({ root, params, signal, setTitle }) {
  const path = `/profiles/${encodeURIComponent(params.handle)}`;
  const profile = await cachedGet(path, { signal });
  const record = profile.record || {};
  const handle = profile.handle || params.handle;
  const solutions = profile.solutions || [];
  setTitle(`${profile.display_name || handle} · make.fun`);

  // --- header: avatar, name, handle, bio -------------------------------------
  const avatarUrl = absoluteUrl(profile.image || profile.avatar);
  const initials = handle.slice(0, 2).toUpperCase();
  const avatar = avatarUrl
    ? el('img', {
        class: 'av',
        alt: '',
        width: '56',
        height: '56',
        loading: 'lazy',
        decoding: 'async',
        // make.fun sends Cross-Origin-Resource-Policy: same-origin, so the image only loads as a
        // CORS request: crossorigin must be set before src, and it is, in this key order.
        crossorigin: 'anonymous',
        src: avatarUrl,
        onerror: (event) => event.currentTarget.replaceWith(el('div', { class: 'av' })),
      })
    : el('div', { class: 'av' });

  const links = el('span', { class: 'chips' }, [
    profile.github_login ? el('a', { class: 'chip', href: `https://github.com/${profile.github_login}`, text: `github/${profile.github_login}` }) : null,
    profile.discord ? el('span', { class: 'chip', text: `discord ${profile.discord}` }) : null,
    profile.x ? el('a', { class: 'chip', href: `https://x.com/${profile.x}`, text: `x/${profile.x}` }) : null,
    profile.wallet && profile.wallet.explorer_url
      ? el('a', { class: 'chip', href: profile.wallet.explorer_url, text: 'wallet' })
      : null,
  ]);

  const solutionList = el('div', {});
  let shown = 0;
  const more = el('button', { class: 'btn ghost', type: 'button', text: 'Show more', onclick: () => page() });

  root.replaceChildren(
    el('div', { class: 'crumbs' }, [el('a', { href: '#/', text: '← All bounties' })]),
    el('div', { class: 'prof' }, [
      avatar,
      el('div', {}, [
        el('h1', { text: profile.display_name || handle }),
        el('p', { class: 'sub', text: `@${handle}${profile.joined_at ? ` · joined ${date(profile.joined_at)}` : ''}` }),
      ]),
    ]),
    profile.bio ? el('p', { class: 'sub', text: profile.bio }) : null,
    links,
    el('div', { class: 'stats' }, [
      stat('entered', count(record.competitions_entered)),
      stat('placed', count(record.competitions_placed)),
      stat('won', count(record.competitions_won)),
      stat('podiums', count(record.podium_finishes)),
      stat('best', record.best_placement == null ? '—' : `#${record.best_placement}`),
      stat('prize', money(record.prize_usd || 0)),
    ]),
    el('h2', { text: `Entries · ${count(solutions.length)}` }),
    solutionList,
    more,
  );

  // --- entries, PAGE at a time ----------------------------------------------
  function solutionNode(solution) {
    const competition = solution.competition || {};
    const bits = [competition.title || competition.slug];
    if (solution.placement) bits.push(`#${solution.placement}`);
    if (solution.prize_usd) bits.push(`won ${money(solution.prize_usd)}`);
    if (solution.score) bits.push(`${solution.score.column.title}: ${solution.score.display}`);
    if (solution.entered_at) bits.push(date(solution.entered_at));
    return el('a', { class: 'sol', href: `#/bounty/${encodeURIComponent(competition.slug || '')}` }, [
      el('b', { text: solution.title || 'Entry' }),
      el('em', { text: bits.join(' · ') }),
    ]);
  }

  function page() {
    const next = solutions.slice(shown, shown + PAGE);
    for (const solution of next) solutionList.append(solutionNode(solution));
    shown += next.length;
    setText(more, `Show ${Math.min(PAGE, solutions.length - shown)} more`);
    more.hidden = shown >= solutions.length;
  }

  page();

  const owned = new AbortController();
  return {
    async refresh() {
      const fresh = await cachedGet(path, { signal: owned.signal, fresh: true });
      const next = fresh.record || {};
      const cells = root.querySelectorAll('.stat b');
      const values = [
        count(next.competitions_entered),
        count(next.competitions_placed),
        count(next.competitions_won),
        count(next.podium_finishes),
        next.best_placement == null ? '—' : `#${next.best_placement}`,
        money(next.prize_usd || 0),
      ];
      cells.forEach((cell, index) => setText(cell, values[index]));
      // Entries move only when a new one is judged; rebuild that list alone when they did.
      const list = (fresh.solutions || []).length;
      if (list !== solutions.length) {
        solutions.length = 0;
        solutions.push(...(fresh.solutions || []));
        solutionList.replaceChildren();
        shown = 0;
        page();
      }
    },
    destroy() {
      owned.abort();
    },
  };
}
