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

## Roadmap

See README. v0.1 starts with evidence grounding — nail the single point before expanding.

## Tests (there is no CI — run them locally before a PR)

```bash
for f in web/tests/*.js; do node "$f" || exit 1; done   # web app (no network; fetch is mocked)
python3 -m pytest -q tests                              # Python pipeline
```

`web/tests/fallbacks.js` covers the request queue (backoff, `Retry-After`,
cooldown), the free lookup fallbacks and the cache; `web/tests/keyless.js`
covers the keyless claim check with a stubbed model (the real model is only
downloaded by the browser, or by `benchmark/comparison/run_veripaper_web.mjs`).
