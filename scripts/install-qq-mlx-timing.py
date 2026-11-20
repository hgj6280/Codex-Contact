"""Install the optional timing adapter alongside this Mac's known MLX gateway."""
import argparse
from pathlib import Path
from tempfile import NamedTemporaryFile

original = "subprocess.Popen([str(ROOT/'venv/bin/mlx_lm.server'),"
observed = "subprocess.Popen([str(ROOT/'venv/bin/python'),str(ROOT/'qq-mlx-timing.py'),"


def atomic_write(path, content, mode):
    with NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temp = Path(handle.name)
        try:
            handle.write(content)
            handle.flush()
            temp.chmod(mode)
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)


def configure(root, rollback):
    gateway = root / 'server.py'
    script = root / 'qq-mlx-timing.py'
    data = gateway.read_text()
    before, after = (observed, original) if rollback else (original, observed)
    if "str(ROOT/'local_chat_worker.py')" in data:
        # Authentication belongs to the worker launcher, independently of timing.
        if rollback:
            script.unlink(missing_ok=True)
        else:
            atomic_write(script, Path(__file__).with_name(script.name).read_bytes(), 0o600)
        return
    if data.count(before) + data.count(after) != 1:
        raise SystemExit('Unrecognized gateway entry point; check server.py')
    if not rollback:
        adapter = Path(__file__).with_name(script.name)
        atomic_write(script, adapter.read_bytes(), 0o600)
    if before in data:
        atomic_write(gateway, data.replace(before, after).encode(), gateway.stat().st_mode & 0o777)
    if rollback:
        script.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    configure(args.directory, args.rollback)
