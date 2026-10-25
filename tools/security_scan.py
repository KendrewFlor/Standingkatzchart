"""Repository security scanner for the Standing–Katz Z-Factor Chart. Standard library only; runs in CI and locally.

    python3 tools/security_scan.py

Checks:
  1. Hidden text: bidi overrides, zero-width and tag characters (Trojan Source, hidden prompts).
  2. Prompt-injection bait aimed at AI coding agents, and HTML comments hidden in Markdown.
  3. AI agent config files that coding tools load silently (CLAUDE.md, AGENTS.md, .mcp.json, ...).
  4. Secrets: API keys, tokens and private keys.
  5. Supply chain: no npm or pip dependencies, no third-party scripts, styles or fonts,
     pinned GitHub Actions with least-privilege permissions and no pull_request_target.
  6. Web hygiene: a strict Content-Security-Policy, only the page's own local scripts and
     stylesheet, no eval/new Function/document.write, no network APIs and no remote URLs
     in js/ or css/; the Python code never opens network connections or spawns processes.
  7. AI co-author trailers in git history (in a git checkout).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SELF = "tools/security_scan.py"
IGNORE_DIRS = {".git", "node_modules", "__pycache__", ".venv", "_site"}
TEXT_EXT = {".js", ".mjs", ".html", ".css", ".py", ".json", ".md", ".yml", ".yaml", ".txt",
            ".editorconfig", ".gitignore", ".gitattributes", ".sh", ".toml", ".cfg", ".ini", ""}
BINARY_OK = {".png": ("docs/",)}

findings: list[tuple[str, int, str, str]] = []


def fail(file: str, line: int, rule: str, detail: str) -> None:
    findings.append((file, line, rule, detail))


def list_files() -> list[str]:
    """In a git checkout scan what would be published (tracked + untracked-not-ignored)."""
    if (ROOT / ".git").exists():
        try:
            out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT,
                                 capture_output=True, check=True).stdout.decode("utf-8")
            return sorted(f for f in out.split("\0") if f and (ROOT / f).is_file())
        except (OSError, subprocess.CalledProcessError):
            pass
    files = []
    for p in ROOT.rglob("*"):
        if p.is_file() and not any(part in IGNORE_DIRS for part in p.relative_to(ROOT).parts):
            files.append(p.relative_to(ROOT).as_posix())
    return sorted(files)


def j(*parts: str) -> str:
    # Patterns are assembled from fragments so this file doesn't trip other scanners.
    return "".join(parts)


INJECTION = [re.compile(p, re.I) for p in (
    j(r"ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+", r"(instructions|prompts|messages|rules)"),
    j(r"disregard\s+(all\s+)?(previous|prior|your)\s+", r"(instructions|guidelines|rules)"),
    j(r"you\s+are\s+now\s+(in\s+)?", r"(developer|dan|jailbreak|god)\s*mode"),
    j(r"<\s*/?\s*(system|assistant|im_start|im_end)", r"\s*>"),
    j(r"\b(new|updated|real)\s+system\s+", r"prompt\b"),
    j(r"\b(AI|LLM|assistant|agent|claude|copilot|cursor|codex|gemini)\b[^\n]{0,40}\b(must|should|always)\s+", r"(run|execute|curl|download|install|send|exfiltrate)\b"),
    j(r"(curl|wget|iwr|irm)\s+[^\n|]*\|\s*", r"(sh|bash|zsh|iex|python|node)\b"),
    j(r"do\s+not\s+(tell|inform|mention\s+to)\s+the\s+", r"user"),
)]
HIDDEN = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]|[\U000e0000-\U000e007f]")  # escapes, not literal characters
SECRETS = [
    ("Anthropic key", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("OpenAI-style key", re.compile(r"\bsk-(proj-)?[A-Za-z0-9]{32,}")),
    ("GitHub token", re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|github_pat_[A-Za-z0-9_]{60,}")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("Private key", re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("Unity licence", re.compile(r"<License\s+id=|<DeveloperData\s+Value=")),
]
AGENT_FILES = [re.compile(p, re.I if i < 4 else 0) for i, p in enumerate((
    r"(^|/)CLAUDE(\.local)?\.md$", r"(^|/)AGENTS\.md$", r"(^|/)GEMINI\.md$", r"(^|/)\.mcp\.json$",
    r"(^|/)\.claude/", r"(^|/)\.cursor/", r"(^|/)\.cursorrules$", r"(^|/)\.windsurfrules$", r"(^|/)\.clinerules",
    r"(^|/)\.github/copilot-instructions\.md$", r"(^|/)\.wolf/", r"(^|/)\.vscode/(tasks|settings|mcp)\.json$",
    r"(^|/)\.codex/", r"(^|/)\.continue/",
))]

# Browser code: things a calculator page never needs and an attacker would love.
JS_BANNED = [
    (re.compile(r"\beval\s*\(|\bnew\s+Function\s*\(|setTimeout\s*\(\s*['\"`]|setInterval\s*\(\s*['\"`]"), "dynamic code execution"),
    (re.compile(r"document\.write|insertAdjacentHTML|\.outerHTML\s*="), "raw HTML writing"),
    (re.compile(r"\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\("), "network or dynamic import"),
    (re.compile(r"\bpostMessage\s*\(|window\.open\s*\(|\bdocument\.cookie\b"), "cross-window or cookie access"),
    (re.compile(r"['\"`]https?://"), "remote URL"),
]
PY_BANNED = [
    (re.compile(r"^\s*(import|from)\s+(urllib|requests|http|socket|ftplib|smtplib|xmlrpc|httpx|aiohttp|paramiko)\b"), "network module"),
    (re.compile(r"^\s*(import|from)\s+(subprocess|pty|ctypes)\b|\bos\.(system|popen|exec\w*|spawn\w*)\s*\("), "process / native access"),
    (re.compile(r"\b(eval|exec)\s*\(|\bpickle\.loads?\b|\bmarshal\.loads\b|__import__\s*\("), "dynamic code execution"),
]
PY_PROCESS_ALLOWED = {SELF}  # the scanner itself runs `git` to read history
CSP_REQUIRED = ["default-src 'none'", "script-src 'self'", "style-src 'self'", "base-uri 'none'", "form-action 'none'"]


def scan_text(file: str, text: str) -> None:
    lines = text.split("\n")
    for n, line in enumerate(lines, 1):
        if HIDDEN.search(line):
            fail(file, n, "hidden-unicode", "Invisible or bidirectional control character (Trojan Source / hidden prompt).")
        if file == SELF:
            continue
        for rx in INJECTION:
            if rx.search(line):
                fail(file, n, "prompt-injection", f"Matches {rx.pattern[:50]}...")
        for name, rx in SECRETS:
            if rx.search(line):
                fail(file, n, "secret", name)
    if file.endswith(".md") and re.search(r"<!--[\s\S]*?-->", text):
        fail(file, 0, "hidden-markdown-comment", "HTML comment in Markdown: hidden from readers on GitHub, visible to agents.")

    if file.startswith("js/") and file.endswith(".js"):
        code = re.sub(r"(?m)^\s*//.*$", "", text)
        for n, line in enumerate(code.split("\n"), 1):
            for rx, what in JS_BANNED:
                if rx.search(line):
                    fail(file, n, "unsafe-source", what)
    if file.startswith("css/"):
        for n, line in enumerate(lines, 1):
            if re.search(r"@import|url\(\s*['\"]?(https?:)?//", line, re.I):
                fail(file, n, "unsafe-source", "remote resource in CSS")
            if re.search(r"expression\s*\(|behavior\s*:|-moz-binding", line, re.I):
                fail(file, n, "unsafe-source", "legacy script-in-CSS construct")
    if file == "index.html":
        csp = re.search(r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', text)
        if not csp:
            fail(file, 0, "unsafe-source", "missing Content-Security-Policy meta tag")
        else:
            for d in CSP_REQUIRED:
                if d not in csp.group(1):
                    fail(file, 0, "unsafe-source", f"CSP must include {d}")
        for m in re.finditer(r"<script\b([^>]*)>", text, re.I):
            if not re.search(r'\ssrc="js/[a-z0-9-]+\.js"', m.group(1)):
                fail(file, 0, "unsafe-source", "only local js/*.js files may be loaded as scripts (no inline scripts)")
        if re.search(r"<style|\sstyle=|\son[a-z]+=", text, re.I):
            fail(file, 0, "unsafe-source", "inline style or event-handler attribute")
        if re.search(r'(src|href)="(https?:)?//', re.sub(r'<a\s[^>]*>', '', text), re.I):
            fail(file, 0, "unsafe-source", "remote resource in index.html")

    if file.endswith(".py") and file not in PY_PROCESS_ALLOWED:
        for n, line in enumerate(lines, 1):
            for rx, what in PY_BANNED:
                if rx.search(line):
                    fail(file, n, "unsafe-source", what)


def check_supply_chain(files: list[str]) -> None:
    for f in files:
        low = f.lower()
        name = Path(f).name
        if name in ("package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "requirements.txt", "pyproject.toml", "Pipfile"):
            fail(f, 0, "supply-chain", "This project has no dependencies; a manifest or lockfile would add some.")
        if low.endswith((".dll", ".so", ".dylib", ".exe", ".bat", ".ps1", ".wasm", ".min.js")):
            fail(f, 0, "supply-chain", "Binary, executable or vendored/minified code.")
        if re.search(r"(^|/)(vendor|node_modules|lib)/", f):
            fail(f, 0, "supply-chain", "Vendored third-party code.")
        ext = Path(f).suffix.lower()
        if ext in BINARY_OK and not f.startswith(BINARY_OK[ext]):
            fail(f, 0, "supply-chain", f"{ext} files belong under {BINARY_OK[ext][0]}")


def check_workflows(files: list[str]) -> None:
    for f in files:
        if not re.match(r"^\.github/workflows/.+\.ya?ml$", f):
            continue
        text = (ROOT / f).read_text(encoding="utf-8")
        for n, line in enumerate(text.split("\n"), 1):
            m = re.match(r"^\s*-?\s*uses:\s*([^\s#]+)", line)
            if m and not m.group(1).startswith("./") and not re.search(r"@[0-9a-f]{40}$", m.group(1)):
                fail(f, n, "unpinned-action", f"{m.group(1)} must be pinned to a full commit SHA.")
        if "pull_request_target" in text:
            fail(f, 0, "workflow", "pull_request_target runs untrusted PR code with secrets.")
        if not re.search(r"^permissions:", text, re.M):
            fail(f, 0, "workflow", "Top-level 'permissions:' block required (least privilege).")
        if re.search(r"\$\{\{\s*github\.event\.(issue|pull_request|comment|review|head_commit)\.(title|body|message|head\.ref)", text):
            fail(f, 0, "workflow", "Untrusted event text interpolated into a workflow (script injection).")


def check_history() -> None:
    if not (ROOT / ".git").exists():
        return
    try:
        log = subprocess.run(["git", "log", "--format=%H%n%B%n--END--"], cwd=ROOT, capture_output=True, check=True).stdout.decode("utf-8", "replace")
    except (OSError, subprocess.CalledProcessError):
        return
    trailer = re.compile(r"^co-authored-by:.*(claude|anthropic|copilot|openai|chatgpt|cursor|gemini)", re.I | re.M)
    for block in log.split("--END--"):
        sha = block.strip().split("\n")[0] if block.strip() else ""
        if sha and trailer.search(block):
            fail(f"commit {sha[:10]}", 0, "ai-coauthor", "Commit carries an AI co-author trailer.")


def allowlisted_agent_files() -> set[str]:
    path = ROOT / ".agent-files-allowlist"
    if not path.exists():
        return set()
    return {s.strip() for s in path.read_text(encoding="utf-8").split("\n") if s.strip() and not s.strip().startswith("#")}


def main() -> int:
    files = list_files()
    allowed = allowlisted_agent_files()
    for f in files:
        if any(rx.search(f) for rx in AGENT_FILES) and f not in allowed:
            fail(f, 0, "agent-config", "AI agent instruction/config file: auto-loaded by coding agents, a prompt-injection "
                                       "vector. Review it and add it to .agent-files-allowlist, or delete it.")
        p = Path(f)
        if p.suffix.lower() in TEXT_EXT or p.name in ("LICENSE", "CODEOWNERS", "commit-msg"):
            try:
                text = (ROOT / f).read_text(encoding="utf-8")
            except UnicodeDecodeError:
                fail(f, 0, "encoding", "Text file is not valid UTF-8.")
                continue
            scan_text(f, text)
    check_supply_chain(files)
    check_workflows(files)
    check_history()

    if findings:
        print(f"Security scan found {len(findings)} issue(s):\n", file=sys.stderr)
        for file, line, rule, detail in findings:
            print(f"  x [{rule}] {file}{':' + str(line) if line else ''} - {detail}", file=sys.stderr)
        return 1
    print(f"Security scan passed ({len(files)} files checked).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
