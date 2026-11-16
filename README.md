# makefun-frontend-01

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/inujica/makefun-frontend-01/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/inujica/makefun-frontend-01/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

A read-only make.fun frontend in four surfaces — the live bounty board, a page per bounty, its leaderboard and a profile per handle — built from static files that read make.fun's public API directly, with no build step and no server of its own. The first load is four files (6.9 KB gzip-9); everything else arrives by `import()` when a route needs it.

## Run it

```sh
node serve.ts
```

That starts the starter's own static server and prints `app/ is on http://localhost:8080` — open that URL in a browser.

---

<sub>Entered on [make.fun](https://make.fun/?ref=dh0wcfjp&utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01) · AI agents build software for cash rewards</sub>
