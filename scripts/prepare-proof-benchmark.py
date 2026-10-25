#!/usr/bin/env python3
"""Stage the reviewed bank-free benchmark from hash-pinned public tooling. Never deploys."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REVISION = '68bbd380d6e1a89d79748e5294661c752f5d1205'
VERSION = '0.1.0.1501'
SOURCE_SHA256 = 'a8f7080ce953e59f930654fb08c9e66f6373fbadbd122593e3e1502bf83ff25a'
RELEASE_SHA256 = '1c312ad4305653b8d9351cf3eac46de4222a43be513260bf53053cfa1de45155'
PUBLIC_MAIN_SHA256 = 'b5849d6fc3c819494feaf6e90aaecd778ff3f4b6b5d82bfb58ab7803958caa94'
ASSETS = {
    'tlsn_wasm.js': '523711ce5c7f1d5206bc05250153e74f3063ed7e420d0a0953ca24b4ea39dc4f',
    'tlsn_wasm_bg.wasm': 'bb3c73628f088867a1f99291275b56a379ce44fd239efca9445fb5908a97e318',
    'snippets/web-spawn-05868593a72e2d44/js/spawn.js': 'ef1d4a01ff707f368a03e3dd5d991af8c191d2dc607abb1f3a672f16a5ceb14a',
}
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
STAGE_FORMAT = 'stellar-p2p-proof-benchmark-stage-v1'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_bytes(path, expected):
    data = path.read_bytes()
    if digest(data) != expected:
        raise ValueError('Public tooling checksum mismatch; no staging performed.')
    return data


def fetch(url, destination, expected, offline):
    if destination.exists():
        return checked_bytes(destination, expected)
    if offline:
        raise ValueError('Pinned archive missing from ignored cache; run preparation online first.')
    temporary = destination.with_suffix(destination.suffix + '.download')
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(MAX_ARCHIVE_BYTES + 1)
        if len(data) > MAX_ARCHIVE_BYTES or digest(data) != expected:
            raise ValueError('Public tooling checksum mismatch; no staging performed.')
        temporary.write_bytes(data)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return data


def validate_options(app, mini_origin, region):
    if not isinstance(app, str) or not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', app):
        raise ValueError('Provide a canonical Fly app name.')
    if not isinstance(region, str) or not re.fullmatch(r'[a-z]{3}', region):
        raise ValueError('Provide a three-letter Fly region code.')
    try:
        parsed = urlsplit(mini_origin)
        port = parsed.port
    except (ValueError, TypeError):
        raise ValueError('Provide the exact mini HTTPS origin.') from None
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment
            or not re.fullmatch(r'[a-z0-9.-]+', parsed.hostname)
            or parsed.netloc != parsed.hostname + (f':{port}' if port is not None else '')
            or port is not None and not 1 <= port <= 65535
            or mini_origin == f'https://{app}.fly.dev'):
        raise ValueError('Provide the exact mini HTTPS origin, distinct from the cloud origin.')


def extract_workspace(source, destination):
    prefix = f'tlsn-extension-{REVISION}/'
    with tarfile.open(fileobj=io.BytesIO(source), mode='r:gz') as archive:
        for member in archive:
            if not member.name.startswith(prefix):
                continue
            relative = Path(member.name[len(prefix):])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe source archive path.')
            if not str(relative).startswith('servers/'):
                continue
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError('Source archive contains an unsupported file type.')
            output = destination / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(archive.extractfile(member).read())


def extract_assets(release, destination):
    with zipfile.ZipFile(io.BytesIO(release)) as archive:
        for name, expected in ASSETS.items():
            matches = [entry for entry in archive.namelist() if entry == name or entry.endswith('/' + name)]
            if len(matches) != 1:
                raise ValueError('Pinned runtime layout mismatch.')
            data = archive.read(matches[0])
            if digest(data) != expected:
                raise ValueError('Pinned runtime asset checksum mismatch.')
            output = destination / name
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)


def copy_runtime(root, stage):
    benchmark = stage / 'benchmark'
    benchmark.mkdir()
    for path in (root / 'tlsn/benchmark').iterdir():
        if path.is_file() and path.suffix in ('.mjs', '.html'):
            shutil.copyfile(path, benchmark / path.name)
    for name in ('extension-check.mjs', 'extension-check.html', 'extension-check.plugin.mjs'):
        shutil.copyfile(root / 'tlsn' / name, stage / name)
    for name in ('response-check.mjs', 'response-check.html', 'revolut.plugin.mjs'):
        shutil.copyfile(root / 'tlsn' / name, stage / name)
    infra = root / 'infra/proof-benchmark'
    for name in ('Dockerfile', '.dockerignore', 'configuration.mjs', 'start.mjs', 'render-fly-config.mjs'):
        data = (infra / name).read_text()
        if name in ('configuration.mjs', 'start.mjs'):
            needle = "'../../tlsn/benchmark/"
            if data.count(needle) != 1:
                raise ValueError('Canonical runtime import layout changed; review staging before continuing.')
            data = data.replace(needle, "'./benchmark/")
        (stage / name).write_text(data)
    (stage / 'runtime').mkdir()
    (stage / 'runtime/config.yaml').write_text('webhooks: {}\n')


def file_manifest(directory):
    result = {}
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise ValueError('Stage contains an unsupported symbolic link.')
        if path.is_file() and path != directory / 'provenance.json':
            result[str(path.relative_to(directory))] = digest(path.read_bytes())
    return result


def publish_stage(prepared, destination, metadata):
    if destination.exists():
        try:
            existing = json.loads((destination / 'provenance.json').read_text())
        except (OSError, ValueError):
            raise ValueError('Existing stage is not owned by this helper; preserve and review it.') from None
        paths = {str(path.relative_to(destination)) for path in destination.rglob('*')
                 if path.is_file() and path != destination / 'provenance.json'}
        if (existing.get('format') != STAGE_FORMAT
                or existing.get('files') != metadata['files']
                or paths != set(metadata['files'])
                or file_manifest(destination) != metadata['files']):
            raise ValueError('Existing stage differs; preserve/review it before removing and rerunning.')
        return False
    (prepared / 'provenance.json').write_text(json.dumps(metadata, indent=2) + '\n')
    prepared.rename(destination)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True)
    parser.add_argument('--mini-origin', required=True)
    parser.add_argument('--region', default='cdg')
    parser.add_argument('--public-origin', help='Explicit HTTPS origin; default remains the Fly hostname')
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    validate_options(args.app, args.mini_origin, args.region)
    # Node performs the same exact-origin validation used by runtime startup, before any download.
    render_command = ['node', str(ROOT / 'infra/proof-benchmark/render-fly-config.mjs'),
                      args.app, args.mini_origin, args.region]
    if args.public_origin is not None:
        render_command.append(args.public_origin)
    render = subprocess.run(render_command, capture_output=True, text=True)
    if render.returncode:
        raise ValueError('Fly configuration validation failed; no staging performed.')
    private = ROOT / '.private'
    private.mkdir(mode=0o700, exist_ok=True)
    cache = private / 'benchmark-downloads'
    cache.mkdir(mode=0o700, exist_ok=True)
    source = fetch(f'https://codeload.github.com/tlsnotary/tlsn-extension/tar.gz/{REVISION}',
                   cache / 'tlsn-extension-source.tar.gz', SOURCE_SHA256, args.offline)
    release = fetch(f'https://github.com/tlsnotary/tlsn-extension/releases/download/{VERSION}/extension-{VERSION}.zip',
                    cache / f'extension-{VERSION}.zip', RELEASE_SHA256, args.offline)
    with tempfile.TemporaryDirectory(prefix='benchmark-stage-preparing-', dir=private) as temporary:
        stage = Path(temporary) / 'stage'
        stage.mkdir()
        extract_workspace(source, stage)
        patch = ROOT / 'infra/proof-benchmark/verifier-public.patch'
        result = subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '--input', str(patch)],
                                cwd=stage, capture_output=True, text=True)
        if result.returncode:
            raise ValueError('Reviewed source patch failed; no stage was published.')
        main_source = stage / 'servers/verifier/src/main.rs'
        if digest(main_source.read_bytes()) != PUBLIC_MAIN_SHA256:
            raise ValueError('Patched verifier differs from the reviewed public variant.')
        copy_runtime(ROOT, stage)
        extract_assets(release, stage / 'benchmark')
        (stage / 'fly.toml').write_text(render.stdout)
        metadata = {
            'format': STAGE_FORMAT,
            'preparedAt': datetime.now(timezone.utc).isoformat(),
            'upstreamRevision': REVISION,
            'sourceArchiveSha256': SOURCE_SHA256,
            'releaseArchiveSha256': RELEASE_SHA256,
            'localVariant': 'public-demo-loopback-fixed-target-budget-capped',
            'publicVerifierMainSha256': PUBLIC_MAIN_SHA256,
            'app': args.app,
            'miniOrigin': args.mini_origin,
            'cloudOrigin': args.public_origin if args.public_origin is not None else f'https://{args.app}.fly.dev',
            'region': args.region,
            'protocolOrDeadlineChanges': False,
            'webhooksEnabled': False,
            'deployedByHelper': False,
            'files': file_manifest(stage),
        }
        destination = private / 'benchmark-stage'
        created = publish_stage(stage, destination, metadata)
        print(f'{"Prepared" if created else "Verified existing"} ignored benchmark stage: {destination}')
        print('No build, deployment, listener, bank request or account change was performed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
