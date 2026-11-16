// The API layer. make.fun's API is GET-only, read-only and CORS-open, so every answer is kept: a
// module-level Map keyed by URL, a 30 s TTL, and the ETag the server sent, so a stale entry is
// revalidated with If-None-Match and a 304 reuses the parsed object instead of downloading and
// re-parsing it. A second reader of the same URL while a request is in flight joins that request,
// so two views asking for the same thing cost one round trip.

const API_BASE = 'https://make.fun/api';
/** A cached answer younger than this is served with no request at all. */
const TTL_MS = 30000;
/** Bound the Map: a long browsing session touches tens of URLs, not thousands. */
const MAX_ENTRIES = 48;

const entries = new Map(); // url -> { at, etag, data }
const pending = new Map(); // url -> promise, so concurrent readers share one request

/** make.fun answers a conditional GET with 304 and no Access-Control-Allow-Origin on that 304, which
 *  a browser rejects as a CORS failure. The first conditional request of a session is therefore also
 *  the test: if it is rejected, this flag turns itself off and every later request goes out
 *  unconditional (the browser's own HTTP cache still revalidates underneath). Measured, not assumed. */
let conditionalGetWorks = true;

/** What this session cost the network; the header renders it. */
export const stats = { requests: 0, reused: 0, revalidated: 0 };

function report() {
  document.dispatchEvent(new CustomEvent('mf:api', { detail: { ...stats } }));
}

/** An HTTP answer the app cannot use, carrying the status so a view can say what happened. */
export class ApiError extends Error {
  constructor(status, path) {
    super(`make.fun answered ${status} for ${path}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Image and profile fields arrive as /api/... paths; anything already absolute is left alone. */
export function absoluteUrl(url) {
  if (!url) return '';
  return url[0] === '/' ? `https://make.fun${url}` : url;
}

/**
 * GET a make.fun path (or an absolute URL) as parsed JSON.
 * options.signal: the route's AbortSignal — a route change cancels the request.
 * options.fresh: skip the TTL, but still revalidate with the ETag we hold, so a reload after a
 * 30 s browse usually costs one 304 and no re-parse.
 */
export function cachedGet(path, options = {}) {
  const { signal, fresh = false } = options;
  const url = path[0] === '/' ? API_BASE + path : path;
  const held = entries.get(url);

  if (!fresh && held && Date.now() - held.at < TTL_MS) {
    stats.reused++;
    report();
    return Promise.resolve(held.data);
  }
  const running = pending.get(url);
  if (running && !fresh) return running;

  const conditional = Boolean(held && held.etag && conditionalGetWorks);

  const request = fetch(url, {
    signal,
    mode: 'cors',
    credentials: 'omit',
    headers: conditional ? { 'if-none-match': held.etag } : {},
  })
    .then(async (response) => {
      if (response.status === 304 && held) {
        held.at = Date.now(); // the bytes did not change: keep the object we already parsed
        stats.reused++;
        stats.revalidated++;
        report();
        return held.data;
      }
      if (!response.ok) throw new ApiError(response.status, path);
      const data = await response.json();
      entries.set(url, { at: Date.now(), etag: response.headers.get('etag'), data });
      if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
      stats.requests++;
      report();
      return data;
    })
    .catch((error) => {
      if (!conditional || (signal && signal.aborted)) throw error;
      conditionalGetWorks = false; // a rejected conditional GET, not a broken API: ask again plainly
      return cachedGet(path, { signal, fresh: true });
    })
    .finally(() => pending.delete(url));

  pending.set(url, request);
  return request;
}
