// The hash router. One route at a time: the previous view is destroyed, its fetches aborted, and a
// generation counter stops an abandoned route's slow import() from painting over the current one.
// refresh() is the reload path — it asks the mounted view to revalidate and patch itself.

import { el, skeleton } from './dom.js';

/** '#/bounty/x' -> '/bounty/x'; an empty hash is the board. */
function pathOf(hash) {
  const path = String(hash || '').replace(/^#/, '');
  if (!path) return '/';
  return path[0] === '/' ? path : `/${path}`;
}

/**
 * routes: [{ pattern, keys, load: () => import('...') }] matched in order; a match's groups become
 * params by key. Returns { start, refresh, path, navigate }.
 */
export function createRouter({ routes, root }) {
  const modules = new Map(); // route -> import() promise: going back never re-imports
  let mounted = null; // { view, path } — the view on screen
  let controller = null; // the current route's AbortController
  let generation = 0;

  function match(path) {
    for (const route of routes) {
      const found = route.pattern.exec(path);
      if (!found) continue;
      const params = {};
      (route.keys || []).forEach((key, index) => {
        params[key] = decodeURIComponent(found[index + 1] || '');
      });
      return { route, params };
    }
    return null;
  }

  function load(route) {
    let pending = modules.get(route);
    if (!pending) {
      pending = route.load().catch((error) => {
        modules.delete(route); // a failed import is not cached: the retry button must try again
        throw error;
      });
      modules.set(route, pending);
    }
    return pending;
  }

  function showError(box, error, retry) {
    box.replaceChildren(
      el('div', { class: 'card err' }, [
        el('h2', { text: 'That did not load' }),
        el('p', { text: (error && error.message) || 'The request failed.' }),
        el('button', { class: 'btn ghost', type: 'button', onclick: retry, text: 'Try again' }),
      ]),
    );
  }

  async function show() {
    const path = pathOf(location.hash);
    const found = match(path);
    const ticket = ++generation;

    if (mounted && mounted.view.destroy) mounted.view.destroy();
    mounted = null;
    if (controller) controller.abort();
    const abort = (controller = new AbortController());
    window.__shotReady = false;

    if (!found) {
      root.replaceChildren(
        el('div', { class: 'card' }, [
          el('h2', { text: 'No such page' }),
          el('p', { class: 'sub', text: path }),
          el('a', { href: '#/', text: 'Back to the board' }),
        ]),
      );
      window.__shotReady = true;
      return;
    }

    const box = el('div');
    root.replaceChildren(box);
    box.append(skeleton(4));

    try {
      const module = await load(found.route);
      if (ticket !== generation) return; // a newer route won while this one was importing
      const view = await module.mount({
        root: box,
        params: found.params,
        signal: abort.signal,
        setTitle: (text) => {
          document.title = text;
        },
        navigate: (hash) => {
          location.hash = hash;
        },
      });
      if (ticket !== generation) {
        if (view && view.destroy) view.destroy();
        return;
      }
      mounted = { view, path };
    } catch (error) {
      if (abort.signal.aborted || ticket !== generation) return; // cancelled, not broken
      showError(box, error, () => show());
    } finally {
      if (ticket === generation) window.__shotReady = true;
    }
  }

  async function refresh() {
    if (mounted && mounted.view && mounted.view.refresh) {
      window.__shotReady = false;
      try {
        await mounted.view.refresh();
      } catch (error) {
        if (!(controller && controller.signal.aborted)) showError(root, error, () => refresh());
      } finally {
        window.__shotReady = true;
      }
      return;
    }
    await show();
  }

  return {
    start() {
      window.addEventListener('hashchange', () => show());
      return show();
    },
    refresh,
    path: () => pathOf(location.hash),
    navigate: (hash) => {
      location.hash = hash;
    },
  };
}
