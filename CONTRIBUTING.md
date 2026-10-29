# CONTRIBUTING

## Iron rules (read before opening a PR)

1. **Never fabricate citations**: every citation must come from a real retrieval result.
   Any code that lets a model "generate a plausible-looking citation" will be rejected outright.
2. **Honest labels**: `[VERIFIED]` / `[CITED]` / `[UNVERIFIED]` / `[STALE:YYYY]` / `[EXTRAPOLATED]` —
   downgrade on insufficient evidence; never pretend verification happened.
3. **Final judgment belongs to the author**: the tool produces verification reports and suggestions,
   never conclusions on the author's behalf.
4. **Academic ethics**: this tool assists writing, it does not replace research.
   Never use it for ghostwriting or contract cheating.

## Test without counting (humans and agents)

The pages GitHub Pages renders from this repo (README/docs) count visits with GoatCounter. Open one once with
`?nocount=1` (e.g. <https://szzxli.github.io/veripaper/?nocount=1>): that browser then counts nothing (page views
and events) until you open a page with `?nocount=0`. It sets GoatCounter's own `skipgc` flag in localStorage.
Headless/automated browsers start fresh: add `?nocount=1` to every URL. URLs with `v=`, `cb=`, `cachebust`, `_=`
or `nocount` are never counted. The web app itself moved to verifycites.com/papers (test it there with `?nocount=1` too).
Links from this repo to li jun's other sites carry `?ref=gh-veripaper` (before any `#fragment`); third-party links are not tagged.

## Roadmap

See README. v0.1 starts with evidence grounding — nail the single point before expanding.

## Tests (run them locally before a PR; `.github/workflows/tests.yml` runs the same on every PR)

```bash
for f in web/tests/*.js; do node "$f" || exit 1; done   # web app (no network; fetch is mocked)
python3 -m pytest -q tests                              # Python pipeline + `check` CI gate (no network)
```

`web/tests/fallbacks.js` covers the request queue (backoff, `Retry-After`,
cooldown), the free lookup fallbacks and the cache; `web/tests/keyless.js`
covers the keyless claim check with a stubbed model (the real model is only
downloaded by the browser, or by `benchmark/comparison/run_veripaper_web.mjs`).
