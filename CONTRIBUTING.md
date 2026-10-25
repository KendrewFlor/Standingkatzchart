# Contributing

## Setup

You need Python 3.10+ and Node 22+. Nothing to install.

```sh
git config core.hooksPath .githooks          # strips AI co-author trailers from your commits
python3 tools/security_scan.py
python3 python/zfactor.py --check
python3 -m unittest discover -s tests/python
node --test tests/js/zmath.test.mjs
```

All of these must pass before you open a pull request (CI runs the same commands).

## Changing a correlation

1. Change it in **both** `js/zmath.js` / `js/zgas.js` and `python/zfactor.py`.
2. Regenerate the reference table: `python3 python/zfactor.py --write-reference`.
3. Run the tests. The JavaScript test fails if the two implementations disagree.
4. Update `docs/METHOD.md` with the equation and its source.

## Rules

- **No dependencies, CDNs or external fonts.** The page must keep working under its Content-Security-Policy.
- **No inline scripts or styles** in `index.html`; no `eval`, `new Function` or network calls in `js/`.
- **No AI agent config files** in commits (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/` …). Keep them local; they're gitignored. See [docs/AI_TOOLING.md](docs/AI_TOOLING.md).
- Cite the published source for any new correlation.
