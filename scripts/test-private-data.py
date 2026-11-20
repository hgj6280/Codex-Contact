"""Exercise real local commits in a disposable repository. No QQ connection or remote."""
import os
import pathlib
import shutil
import subprocess
import tempfile

source = pathlib.Path(__file__).resolve().parents[1]


def run_tests(work):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
    def git(*args, extra=None, check=True):
        return subprocess.run(["git", *args], cwd=work, env={**env, **(extra or {})},
                              capture_output=True, text=True, check=check)
    git("init", "-q", "-b", "main")
    git("config", "user.name", "Fixture")
    git("config", "user.email", "fixture@users.noreply.github.com")
    git("config", "core.hooksPath", ".githooks")
    (work / "scripts").mkdir()
    shutil.copytree(source / ".githooks", work / ".githooks")
    shutil.copy(source / "scripts/check-private-data.py", work / "scripts")
    shutil.copy(source / ".gitignore", work)
    (work / "example.txt").write_text("测试用户 10001，测试群 20001\n")
    git("add", ".")
    git("commit", "-qm", "Allow synthetic identifiers")
    original = git("rev-parse", "HEAD").stdout
    print("PASS allowed synthetic user and group in a real commit")
    invalid = "x" + "@" + "qq.com"
    sample = "37" + "135" + "4286"
    credential = "sk-" + "x" * 32
    cases = [
        ("five-digit account", "example.txt", "QQ: " + "78"+"934", {}, "test", "number"),
        ("account without a label", "example.txt", sample, {}, "test", "number"),
        ("QQ email", "example.txt", invalid.upper(), {}, "test", "QQ email"),
        ("provider key", "example.txt", credential, {}, "test", "credential"),
        ("custom secret", "example.txt", 'client_secret = "' + "t"*35 + '"', {}, "test", "credential"),
        ("forced runtime file", "data/messages.json", "[]", {}, "test", "runtime"),
        ("renamed chat export", "notes.json", '{"post_type":"message","message_id":1,"raw_message":"sample"}', {}, "test", "runtime"),
        ("SQLite sidecar", "nested/test.sqlite-wal", "sample", {}, "test", "runtime"),
        ("SQLite payload with renamed file", "notes.txt", b"SQLite format 3\x00", {}, "test", "SQLite payload"),
        ("local key file", "desktop.key", "fixture", {}, "test", "credential"),
        ("backup", "nested/settings.bak", "fixture", {}, "test", "runtime"),
        ("log", "nested/service.log", "fixture", {}, "test", "runtime"),
        ("author identity", "example.txt", "new", {"GIT_AUTHOR_EMAIL": invalid}, "test", "author"),
        ("committer identity", "example.txt", "new", {"GIT_COMMITTER_EMAIL": invalid}, "test", "committer"),
        ("commit message", "example.txt", "new", {}, invalid, "QQ email"),
    ]
    for name, rel, content, overrides, message, expected in cases:
        git("reset", "-q", "--hard", "HEAD")
        path = work / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode())
        git("add", "-f", "--", rel)
        result = git("commit", "-qm", message, extra=overrides, check=False)
        if not result.returncode or expected not in result.stderr or git("rev-parse","HEAD").stdout != original:
            raise AssertionError(name + " was not rejected for the expected reason")
        print("PASS blocked " + name)
    git("reset", "-q", "--hard", "HEAD")
    (work / "example.txt").write_text(sample)
    git("add", "example.txt")
    (work / "example.txt").write_text("10001")
    result = git("commit", "-qm", "test the staged blob", check=False)
    if not result.returncode or "number" not in result.stderr or git("rev-parse","HEAD").stdout != original:
        raise AssertionError("staged blob was not checked")
    print("PASS blocked staged private value even with a clean worktree copy")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="qq-private-hook-") as tmp:
        run_tests(pathlib.Path(tmp))
