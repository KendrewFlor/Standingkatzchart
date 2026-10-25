# Security policy

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab → "Report a vulnerability"). Don't open a public issue.

## What this project is

A static, client-side calculator on GitHub Pages. No server, no accounts, no network calls, no cookies. The only thing it stores is your last inputs and pinned readings, in your own browser's local storage.

## Protections

| Threat | Control |
|---|---|
| Malicious dependency or install script | None to compromise: no npm or pip packages, no `package.json`, no lockfiles. The scanner fails if one appears. |
| Compromised CDN or injected script | No third-party scripts, styles or fonts (system fonts only). The page's Content-Security-Policy allows only its own files: `default-src 'none'; script-src 'self'; style-src 'self'`. No inline scripts or styles. |
| Hidden network calls | The scanner bans `fetch`, `XMLHttpRequest`, `WebSocket`, dynamic `import()`, `postMessage` and remote URLs in `js/`, and network or subprocess modules in the Python code. |
| Code injection | No `eval`, `new Function`, string timers or `document.write`. Every number entered is parsed with `parseFloat` before it is used or shown. Saved settings from local storage are treated as untrusted: only known keys, known choices and finite numbers are kept. |
| Compromised GitHub Action | Every action is pinned to a full commit SHA; Dependabot proposes reviewed bumps. Workflows have read-only tokens, `persist-credentials: false`, and never use `pull_request_target`. |
| Prompt injection against AI coding agents | No agent instruction files are committed (`CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.claude/` …). The scanner also rejects hidden or bidirectional Unicode, HTML comments in Markdown and common injection phrases. |
| Leaked secrets | The scanner checks for common key and token formats. The project needs no secrets at all. |
| AI tools listed as contributors | `.githooks/commit-msg` strips AI co-author trailers; the scanner fails if one is in history. |

Run the checks locally with `python3 tools/security_scan.py`.

## Recommended GitHub settings

1. Two-factor authentication on your GitHub account.
2. Settings → Code security: secret scanning, push protection, Dependabot alerts, private vulnerability reporting.
3. Settings → Branches: protect `main` (require pull requests and the `CI / check` status, block force pushes).
4. Settings → Actions → General: workflow permissions **read repository contents**.
5. Settings → Pages: source **GitHub Actions**.
