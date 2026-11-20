"""Check the staged tree, a commit message, or every commit reachable from local refs."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import unicodedata

POLICY = ".githooks/reviewed-source.json"
EMAIL = re.compile(r"[a-z0-9_.+-]+@users\.noreply\.github\.com", re.I)
QQ_MAIL = re.compile(r"@qq\.com\b", re.I)
NUMBER = re.compile(r"(?<!\d)[1-9]\d{4,10}(?!\d)", re.ASCII)
FAKE = {str(base + i) for base in (10000, 20000) for i in range(1, 65)}
KEYS = [
    re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
    re.compile(r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{24,}|AIza[A-Za-z0-9_-]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[\w-]{16,})"),
    re.compile(r"\bBearer\s+[A-Za-z0-9_.+/-]{16,}={0,2}\b", re.I),
    re.compile(r"""(?ix)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|private[_-]?key|password|passwd|client[_-]?secret|secret|hub[_-]?key)\b["']?\s*[:=]\s*["']([a-z0-9+_./=-]{12,})["']"""),
    re.compile(r"(?im)^\s*(?:[A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|PASSWORD|SECRET)|TOKEN)\s*=\s*[a-z0-9_+/=-]{12,}\s*$"),
    re.compile(r"""(?im)^\s*(?:api[_-]?key|access[_-]?token|password|client[_-]?secret|key|token)\s*:\s*[a-z0-9_+/=-]{12,}\s*$"""),
    re.compile(r"""(?i)\bkey["']?\s*[:=]\s*["'][a-z0-9_+/=-]{20,}["']"""),
    re.compile(r"\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{12,}"),
]
BLOCK_DIR = re.compile(r"^(?:data(?: \d+)?|runtime(?: \d+)?|logs?|backups?|verification|tmp|cache|napcat-state|snowluma-state|qq-token-usage|chat-history|chat-records?|node_modules|__pycache__)$", re.I)
BLOCK_FILE = re.compile(r"(?:^\.env(?:\.|$)|^\.git-credentials$|^id_(?:rsa|dsa|ed25519|ecdsa)$|^(?:messages|cookies?|chat[-_]?history|chat[-_]?records?|credentials?|secrets?|tokens?)(?:\.|$)|\.sqlite(?:\d+)?(?:[.-]|$)|\.db(?:[.-]|$)|\.(?:pem|key|p12|pfx|jks|token|secret|session|jsonl|ndjson|pid|gz|zip|tar|tgz|bundle|dmg)$|\.(?:backup|old|bak|log)(?:\.|$))", re.I)
BLOCK_EXACT = {"modules/qq-llbot/app_settings.json", "modules/qq-llbot/llbot-cli", "config/local.codexremotecontact.chat-hub.plist"}
errors = []


def git(*args, input=None):
    return subprocess.check_output(["git", *args], input=input)


def fail(path, reason):
    # File names may themselves contain credentials or an account number.
    safe = path
    if QQ_MAIL.search(path) or any(p.search(path) for p in KEYS) or NUMBER.search(path):
        safe = "[redacted path]"
    errors.append(f"{safe}: {reason}")


def normalize(text):
    return unicodedata.normalize("NFKC", text)


def secrets(text):
    return QQ_MAIL.search(text) or any(p.search(text) for p in KEYS)


def number_signature(text):
    lines = []
    for line in text.splitlines():
        if any(m[0] not in FAKE for m in NUMBER.finditer(line)):
            lines.append(line)
    if lines:
        return hashlib.sha256("\n".join(lines).encode()).hexdigest()
    return None


def check_text(path, text, allowed=None):
    text = normalize(text)
    if secrets(text):
        fail(path, "QQ email or credential pattern")
    signature = number_signature(text)
    if signature and signature != allowed:
        fail(path, "unreviewed QQ-shaped number")


def check_identity(label, ident, expected):
    mail = re.search(r"<([^<>]+)>", ident)
    if not mail or mail[1] != expected or QQ_MAIL.search(ident):
        fail(label, "unexpected author or committer email")
    else:
        check_text(label, ident.split("<", 1)[0])


def check_tree(tree):
    rows = {}
    for entry in filter(None, git("ls-tree", "-rz", tree).split(b"\0")):
        meta, raw = entry.split(b"\t", 1)
        mode, typ, sha = meta.decode().split()
        rows[raw.decode("utf-8")] = (mode, typ, sha)
    policy = {"numbers": {}, "art": {}}
    if POLICY in rows:
        policy = json.loads(git("cat-file", "blob", rows[POLICY][2]))
    elif rows:
        fail(POLICY, "missing review manifest")
    # Batch reads only Git objects. Worktree links and runtime files are never opened.
    blobs = {v[2] for v in rows.values() if v[1] == "blob"}
    data = git("cat-file", "--batch", input="".join(x + "\n" for x in sorted(blobs)).encode())
    pos = 0
    contents = {}
    for sha in sorted(blobs):
        end = data.index(b"\n", pos)
        name, typ, size = data[pos:end].split()
        if name.decode() != sha or typ != b"blob":
            raise ValueError("unexpected Git object")
        pos = end + 1
        contents[sha] = data[pos:pos + int(size)]
        pos += int(size) + 1
    for path, (mode, typ, sha) in rows.items():
        parts = pathlib.PurePosixPath(path).parts
        if (mode not in ("100644","100755") or typ != "blob" or
                any(BLOCK_DIR.fullmatch(p) for p in parts) or BLOCK_FILE.search(parts[-1]) or
                parts[-1].casefold() == "project_status.md" or path in BLOCK_EXACT or path.startswith("modules/qq-llbot/bin/")):
            fail(path, "runtime, credential, link or archive path")
            continue
        if path.startswith("assets/qq-character/") and path not in (
                "assets/qq-character/LICENSE.md", "assets/qq-character/hugongjing/appearance.md"):
            fail(path, "unreleased character asset")
            continue
        check_text(path, path, policy.get("paths", {}).get(path))
        content = contents[sha]
        if content.startswith(b"SQLite format 3\x00"):
            fail(path, "SQLite payload")
            continue
        if re.search(rb'"(?:message_type|post_type)"\s*:\s*"(?:group|private|message)"', content) and re.search(rb'"(?:raw_message|message_id)"\s*:', content) and path.endswith((".json", ".txt")):
            fail(path, "serialized runtime event")
            continue
        if path == POLICY:
            # A manifest may only name ordinary paths and store hex digests.
            if (not set(policy) <= {"numbers","paths","art"} or
                    any(not re.fullmatch(r"[0-9a-f]{64}", d)
                        for section in policy.values() for d in section.values()) or
                    any(secrets(normalize(key)) for section in policy.values() for key in section)):
                fail(path, "invalid review manifest")
            continue
        try:
            if b"\x00" in content:
                raise ValueError()
            text = content.decode()
        except ValueError:
            fail(path, "unreviewed binary")
            continue
        check_text(path, text, policy["numbers"].get(path))


def main():
    p = argparse.ArgumentParser()
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--staged", action="store_true")
    group.add_argument("--history", action="store_true")
    group.add_argument("--message")
    args = p.parse_args()
    expected = git("config", "--local", "--get", "user.email").decode().strip()
    if not EMAIL.fullmatch(expected):
        raise ValueError("set the local GitHub noreply email first")
    if args.message:
        check_text("commit message", pathlib.Path(args.message).read_text())
    elif args.staged:
        for v in ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]:
            check_identity(v, git("var", v).decode(), expected)
        check_tree(git("write-tree").decode().strip())
    else:
        trees = set()
        commits = git("rev-list", "--all").decode().splitlines()
        if not commits:
            raise ValueError("no commits to verify")
        for commit in commits:
            ident_a, ident_c, msg, tree = git("show","-s","--format=%an <%ae>%x00%cn <%ce>%x00%B%x00%T",commit).decode().split("\x00")
            check_identity("author", ident_a, expected)
            check_identity("committer", ident_c, expected)
            check_text("commit message", msg)
            trees.add(tree.strip())
        for tree in trees:
            check_tree(tree)
        print(f"Scanned {len(commits)} commits and {len(trees)} complete trees.")
    for error in dict.fromkeys(errors):
        print(error, file=sys.stderr)
    return int(bool(errors))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError, KeyError, TypeError) as exc:
        sys.exit("Privacy check could not complete: " + type(exc).__name__)
