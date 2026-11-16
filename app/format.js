// Formatting, and nothing else: no DOM, no fetching. Views call these for every number and date they
// show, so a figure reads the same on the board, on a bounty page and on a profile.

/** A dollar figure from an API string ('705.50') or a number: '$706' whole, '$0.50' under a dollar. */
export function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  });
}

/** A count with thousands separators: 10279 -> '10,279'. */
export function count(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '0';
}

/** An ISO timestamp as a UTC date and time: '17 Nov 2026, 12:30 UTC'. UTC because a deadline is. */
export function date(iso) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '—';
  return `${when.toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })} UTC`;
}

/** The time left until an ISO timestamp, at the granularity a reader needs: '2d 4h left',
 *  '5h 12m left', '35m left', or 'ended'. */
export function timeLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'ended';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${Math.max(1, minutes)}m left`;
}

/** True when a deadline is close enough to deserve the warning colour. */
export function closingSoon(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 && ms < 6 * 3600000;
}

/** Text made safe for the one place a view writes markup (a bounty's prose), never for textContent. */
export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
