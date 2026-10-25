"""Prepare an offline, labelled 60-second diagnostic extension; never install it."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.1.0.1501'
VERSION_NAME = VERSION + '-setup60s-local'
ORIGINAL_SHA256 = '1c312ad4305653b8d9351cf3eac46de4222a43be513260bf53053cfa1de45155'
WORKER = '399.bundle.js'
PACKAGE = 'tlsnotary-' + VERSION_NAME + '.zip'
CHANGES = (
    ('const g=3e4;', 'const g=6e4;'),
    ('setupProver timed out after 30000ms', 'setupProver timed out after 60000ms'),
    ('setupProverRelay timed out after 30000ms', 'setupProverRelay timed out after 60000ms'),
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare(archive, output):
    data = archive.read_bytes()
    if digest(data) != ORIGINAL_SHA256:
        raise SystemExit('Pinned release checksum mismatch; no extension prepared.')
    if output.exists():
        raise SystemExit('Output already exists; choose an unused --output directory. Nothing was overwritten.')

    files = {}
    timestamps = {}
    with zipfile.ZipFile(io.BytesIO(data)) as original:
        for entry in original.infolist():
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or '..' in name.parts or '\\' in entry.filename:
                raise SystemExit('Unexpected archive path; no extension prepared.')
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise SystemExit('Archive links are not supported; no extension prepared.')
            if entry.is_dir():
                continue
            if entry.filename in files:
                raise SystemExit('Duplicate archive entry; no extension prepared.')
            files[entry.filename] = original.read(entry)
            timestamps[entry.filename] = entry.date_time

    if WORKER not in files or 'manifest.json' not in files:
        raise SystemExit('Pinned release layout changed; no extension prepared.')
    before = dict(files)
    text = files[WORKER].decode('utf-8')
    for old, new in CHANGES:
        if text.count(old) != 1:
            raise SystemExit('Pinned worker layout changed; no extension prepared.')
        text = text.replace(old, new, 1)
    files[WORKER] = text.encode('utf-8')

    old_manifest = json.loads(files['manifest.json'])
    if old_manifest.get('version') != VERSION or old_manifest.get('manifest_version') != 3:
        raise SystemExit('Pinned manifest version changed; no extension prepared.')
    manifest = dict(old_manifest)
    manifest['name'] = 'TLSNotary (local setup 60s)'
    manifest['version_name'] = VERSION_NAME
    files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode('utf-8')
    changed = {name for name in files if files[name] != before[name]}
    if changed != {WORKER, 'manifest.json'}:
        raise SystemExit('Unexpected modified-file set; no extension prepared.')
    if any(old_manifest.get(key) != manifest.get(key)
           for key in set(old_manifest) | set(manifest) if key not in {'name', 'version_name'}):
        raise SystemExit('Unexpected manifest change; no extension prepared.')

    audit = {
        'baseRelease': VERSION,
        'originalSha256': ORIGINAL_SHA256,
        'localVersionName': VERSION_NAME,
        'setupTimeoutMs': 60000,
        'changesApplyTo': ['direct MPC setup', 'relay setup'],
        'cryptographicRuntimeChanged': False,
        'permissionsChanged': False,
        'modifiedFiles': [],
        'unchangedFiles': [],
        'packageFile': PACKAGE,
    }
    for name in sorted(files):
        record = {'path': name, 'sha256': digest(files[name])}
        if name in changed:
            record['originalSha256'] = digest(before[name])
            audit['modifiedFiles'].append(record)
        else:
            audit['unchangedFiles'].append(record)

    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix='.' + output.name + '-prepare-', dir=output.parent) as temporary:
        staged = Path(temporary) / 'prepared'
        runtime = staged / 'extension'
        runtime.mkdir(parents=True, mode=0o700)
        for name, body in files.items():
            path = runtime / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
        package_path = staged / PACKAGE
        with zipfile.ZipFile(package_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
            for name in sorted(files):
                # Preserve pinned input timestamps and fixed permissions/order,
                # so reruns do not introduce the current machine's file mtimes.
                entry = zipfile.ZipInfo(name, date_time=timestamps[name])
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                package.writestr(entry, files[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        audit['packageSha256'] = digest(package_path.read_bytes())
        (staged / 'audit.json').write_text(json.dumps(audit, indent=2) + '\n')
        if output.exists():
            raise SystemExit('Output appeared during preparation; nothing was overwritten.')
        os.rename(staged, output)

    print(json.dumps({
        'output': str(output), 'extension': str(output / 'extension'),
        'package': str(output / PACKAGE), 'packageSha256': audit['packageSha256'],
        'modifiedFiles': sorted(changed), 'unchangedFiles': len(files) - len(changed),
        'installed': False, 'published': False,
    }))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path,
                        default=ROOT / '.toolchain' / ('tlsn-extension-' + VERSION + '.zip'),
                        help='Existing official release ZIP; no network download is attempted')
    parser.add_argument('--output', type=Path, default=ROOT / '.private/extension-setup60',
                        help='Unused private output directory (contains extension, package and audit)')
    args = parser.parse_args()
    try:
        prepare(args.archive.expanduser().resolve(), args.output.expanduser().resolve())
    except (OSError, ValueError, UnicodeError, zipfile.BadZipFile):
        raise SystemExit('Unable to prepare the pinned release; check the archive, output and filesystem access.') from None


if __name__ == '__main__':
    main()
