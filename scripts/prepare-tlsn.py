"""Fetch hash-pinned public tooling. Never reads bank data or changes services."""
import argparse
import hashlib
import io
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REVISION = '68bbd380d6e1a89d79748e5294661c752f5d1205'
VERSION = '0.1.0.1501'
SOURCE_SHA = 'a8f7080ce953e59f930654fb08c9e66f6373fbadbd122593e3e1502bf83ff25a'
RELEASE_SHA = '1c312ad4305653b8d9351cf3eac46de4222a43be513260bf53053cfa1de45155'
ASSETS = {
    'tlsn_wasm.js': '523711ce5c7f1d5206bc05250153e74f3063ed7e420d0a0953ca24b4ea39dc4f',
    'tlsn_wasm_bg.wasm': 'bb3c73628f088867a1f99291275b56a379ce44fd239efca9445fb5908a97e318',
    'snippets/web-spawn-05868593a72e2d44/js/spawn.js': 'ef1d4a01ff707f368a03e3dd5d991af8c191d2dc607abb1f3a672f16a5ceb14a',
}


def checked_bytes(path, expected):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit('Tooling checksum mismatch. No source was extracted.')
    return data


def fetch(url, destination, expected, offline):
    if not destination.exists():
        if offline:
            raise SystemExit('Offline archive missing; run preparation online first.')
        temporary = destination.with_suffix(destination.suffix + '.download')
        try:
            with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
                shutil.copyfileobj(response, output)
            checked_bytes(temporary, expected)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    return checked_bytes(destination, expected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Use only checksum-verified local archives')
    args = parser.parse_args()
    tooling = ROOT / '.toolchain'
    tooling.mkdir(exist_ok=True)
    source = fetch(
        f'https://codeload.github.com/tlsnotary/tlsn-extension/tar.gz/{REVISION}',
        tooling / 'tlsn-extension-source.tar.gz', SOURCE_SHA, args.offline)
    release = fetch(
        f'https://github.com/tlsnotary/tlsn-extension/releases/download/{VERSION}/extension-{VERSION}.zip',
        tooling / f'tlsn-extension-{VERSION}.zip', RELEASE_SHA, args.offline)

    upstream = tooling / 'tlsn-extension-68bbd380d6e1'
    if not upstream.exists():
        with tarfile.open(fileobj=io.BytesIO(source), mode='r:gz') as archive:
            # Extract regular files only, strip the pinned root and reject traversal.
            prefix = f'tlsn-extension-{REVISION}/'
            for member in archive.getmembers():
                if not member.isfile() or not member.name.startswith(prefix):
                    continue
                name = Path(member.name[len(prefix):])
                if name.is_absolute() or '..' in name.parts:
                    raise SystemExit('Unexpected source archive path.')
                destination = upstream / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as input_file, destination.open('wb') as output:
                    shutil.copyfileobj(input_file, output)

    runtime = tooling / 'tlsn-browser-smoke'
    with zipfile.ZipFile(io.BytesIO(release)) as archive:
        for name, expected in ASSETS.items():
            matches = [entry for entry in archive.namelist() if entry == name or entry.endswith('/' + name)]
            if len(matches) != 1:
                raise SystemExit('Released runtime layout does not match the pinned assets.')
            data = archive.read(matches[0])
            if hashlib.sha256(data).hexdigest() != expected:
                raise SystemExit('Released runtime asset checksum mismatch.')
            destination = runtime / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)

    subprocess.run(['python3', str(ROOT / 'tlsn/prepare-verifier.py')], check=True)
    private_runtime = ROOT / '.private/tlsn/runtime'
    private_runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    config = private_runtime / 'config.yaml'
    if not config.exists():
        config.write_text('webhooks: {}\n')
        config.chmod(0o600)
    print('Pinned source and browser assets are ready. No verifier was started.')


if __name__ == '__main__':
    main()
