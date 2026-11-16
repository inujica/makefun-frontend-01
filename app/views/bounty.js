// A bounty's page: one request, then every fact a reader needs in the first screen — the live pot,
// the entry fee, the time left, the entries — and the task itself below it. The page is built once
// and refreshed by patching the fields that moved, so the prose, the scroll position and the DOM
// survive a revalidation.

import { cachedGet } from '../api.js';
import { el, setText } from '../dom.js';
import { closingSoon, count, date, esc, money, timeLeft } from '../format.js';

const ORDINAL = ['1st', '2nd', '3rd'];

/** 1 -> '1st' … 20 -> '20th'. */
const place = (n) => ORDINAL[n - 1] || `${n}th`;

/** The pot: what the API says is live now, falling back to the base reward. */
const potOf = (bounty) => money(bounty.potUsd == null ? bounty.rewardAmount : bounty.potUsd);

/**
 * A bounty's description is Markdown-ish text: '## heading', '- item', blank-line paragraphs. It is
 * escaped and rendered once, into one innerHTML — the single place in the app that writes markup,
 * and the reason format.esc exists. Everything else is built as nodes.
 */
function proseHtml(markdown) {
  const out = [];
  let inList = false;
  const closeList = () => {
    if (inList) out.push('</ul>');
    inList = false;
  };
  for (const raw of String(markdown || '').split('\n')) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      out.push(`<h3>${esc(heading[1])}</h3>`);
    } else if (item) {
      if (!inList) out.push('<ul>');
      inList = true;
      out.push(`<li>${esc(item[1])}</li>`);
    } else {
      closeList();
      out.push(`<p>${esc(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

function prose(markdown) {
  const box = el('div', { class: 'prose' });
  box.innerHTML = proseHtml(markdown);
  return box;
}

export async function mount({ root, params, signal, setTitle }) {
  const path = `/competitions/${encodeURIComponent(params.slug)}`;
  const payload = await cachedGet(path, { signal });
  const bounty = payload.competition || payload;
  setTitle(`${bounty.title} · make.fun`);

  // The nodes refresh() patches, built once here.
  const pot = el('span', { class: 'pot', text: potOf(bounty) });
  const feeChip = el('span', { class: 'chip fee' });
  const timeChip = el('span', { class: 'chip time' });
  const entriesChip = el('span', { class: 'chip' });
  const statusValue = el('dd');
  const entriesValue = el('dd');
  const feePayersValue = el('dd');
  const payouts = el('div', { class: 'chips' });
  const potNote = el('p', { class: 'sub' });

  /** The payouts as they stand now, one chip a place: '1st $141.14'. */
  function fillPayouts(next) {
    const rewards = next.rewardsNow || [];
    const shown = rewards.slice(0, 10);
    const nodes = shown.map((reward) =>
      el('span', { class: 'chip', text: `${place(reward.place)} ${money(reward.amountUsd)}` }),
    );
    if (rewards.length > shown.length) {
      nodes.push(el('span', { class: 'chip', text: `+${rewards.length - shown.length} more places` }));
    }
    payouts.replaceChildren(...nodes);
  }

  const judging = bounty.judgeRounds
    ? [
        el('dt', { text: 'Judging' }),
        el('dd', {
          text: `${count(bounty.judgeRounds.anchors || 0)} anchors, ${count(bounty.judgeRounds.finalists || 0)} finalists, ${count(bounty.judgeRounds.swissRounds || 0)} Swiss rounds`,
        }),
      ]
    : [];

  const facts = el('dl', { class: 'facts' }, [
    el('dt', { text: 'Deadline' }),
    el('dd', { text: `${date(bounty.deadline)} (${timeLeft(bounty.deadline)})` }),
    el('dt', { text: 'Status' }),
    statusValue,
    el('dt', { text: 'Entries' }),
    entriesValue,
    el('dt', { text: 'Entry fee' }),
    el('dd', { text: bounty.entryFeeUsd ? money(bounty.entryFeeUsd) : 'free' }),
    el('dt', { text: 'Fees paid in' }),
    feePayersValue,
    el('dt', { text: 'Category' }),
    el('dd', { text: bounty.category || '—' }),
    judging,
  ]);

  const body = el('div', {}, [
    el('div', { class: 'card' }, [el('h2', { text: 'The task' }), prose(bounty.description || bounty.summary)]),
    bounty.rules
      ? el('div', { class: 'card' }, [
          el('details', {}, [el('summary', { text: 'Rules and requirements' }), prose(bounty.rules)]),
        ])
      : null,
  ]);

  const aside = el('aside', {}, [
    el('div', { class: 'card' }, [
      el('h2', { text: 'Entry' }),
      facts,
      el('a', {
        class: 'btn',
        href: `#/bounty/${encodeURIComponent(params.slug)}/leaderboard`,
        text: `Leaderboard · ${count(bounty.submissionCount)} entries`,
      }),
    ]),
    el('div', { class: 'card' }, [el('h2', { text: 'Payouts now' }), payouts, potNote]),
  ]);

  root.replaceChildren(
    el('div', { class: 'crumbs' }, [el('a', { href: '#/', text: '← All bounties' })]),
    el('h1', { text: bounty.title }),
    el('div', { class: 'potline' }, [pot, feeChip, timeChip, entriesChip]),
    el('p', { class: 'sub', text: bounty.summary || '' }),
    el('div', { class: 'split' }, [body, aside]),
  );

  /** Write every live figure into the nodes already on screen. */
  function paint(next) {
    setText(pot, potOf(next));
    setText(feeChip, next.entryFeeUsd ? `${money(next.entryFeeUsd)} entry` : 'free entry');
    setText(timeChip, timeLeft(next.deadline));
    timeChip.className = `chip time${closingSoon(next.deadline) ? ' soon' : ''}`;
    setText(entriesChip, `${count(next.submissionCount)} entries`);
    setText(statusValue, next.acceptingSubmissions === false ? `${next.status} (closed)` : next.status || '—');
    setText(entriesValue, count(next.submissionCount));
    setText(feePayersValue, `${count(next.entryFeePayers || 0)} entries paid the fee`);
    setText(potNote, `${potOf(next)} pot = ${money(next.rewardAmount)} base reward + ${money(next.entryFeesUsd || 0)} of entry fees`);
  }

  paint(bounty);
  fillPayouts(bounty);

  const owned = new AbortController();
  return {
    async refresh() {
      const fresh = await cachedGet(path, { signal: owned.signal, fresh: true });
      const next = fresh.competition || fresh;
      paint(next);
      // The payouts only move when another entry fee lands; swap the chips when they did.
      if (JSON.stringify(next.rewardsNow || []) !== JSON.stringify(bounty.rewardsNow || [])) {
        fillPayouts(next);
        bounty.rewardsNow = next.rewardsNow;
      }
    },
    destroy() {
      owned.abort();
    },
  };
}
