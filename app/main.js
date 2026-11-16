// Boot: the route table and the shell's three controls. index.html + this file + router.js + dom.js
// are the whole first load; api.js, format.js and the four views arrive by import() when a route
// needs them, so they cost nothing until then.

import { createRouter } from './router.js';
import { setText } from './dom.js';

// /bounty/<slug> cannot swallow a /bounty/<slug>/leaderboard path: the slug group refuses a slash.
const routes = [
  { pattern: /^\/?$/, load: () => import('./views/board.js') },
  { pattern: /^\/bounty\/([^/]+)\/?$/, keys: ['slug'], load: () => import('./views/bounty.js') },
  { pattern: /^\/bounty\/([^/]+)\/leaderboard\/?$/, keys: ['slug'], load: () => import('./views/leaderboard.js') },
  { pattern: /^\/u\/([^/]+)\/?$/, keys: ['handle'], load: () => import('./views/profile.js') },
];

const router = createRouter({ routes, root: document.getElementById('app') });
const search = document.getElementById('q');

// Typing filters the board in place; from another page the same keystrokes take you there, where the
// board reads the box on mount. One listener, no request either way.
search.addEventListener('input', () => {
  if (router.path() !== '/') router.navigate('#/');
});

// '/' focuses the filter, the way a list page usually does.
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== search) {
    event.preventDefault();
    search.focus();
  }
});

document.getElementById('go').addEventListener('click', () => router.refresh());

// api.js reports every request and every answer it reused, so the header can show the count rather
// than the app claiming to be fast.
const net = document.getElementById('net');
document.addEventListener('mf:api', (event) => {
  const { requests, reused } = event.detail;
  setText(net, `${requests} req · ${reused} reused`);
});

router.start();
