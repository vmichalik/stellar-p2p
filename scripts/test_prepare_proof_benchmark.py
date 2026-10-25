import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('prepare_benchmark', Path(__file__).with_name('prepare-proof-benchmark.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PrepareBenchmarkTests(unittest.TestCase):
    def test_checksum_failure_preserves_input_and_never_extracts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'archive'
            path.write_bytes(b'synthetic altered archive')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                prepare.checked_bytes(path, hashlib.sha256(b'expected').hexdigest())
            self.assertEqual(path.read_bytes(), b'synthetic altered archive')

    def test_offline_missing_archive_never_uses_network(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(prepare.urllib.request, 'urlopen') as network:
            with self.assertRaisesRegex(ValueError, 'Pinned archive missing'):
                prepare.fetch('https://example.invalid/archive', Path(directory) / 'missing', '0' * 64, True)
            network.assert_not_called()

    def test_noncanonical_inputs_are_rejected_before_staging(self):
        valid = ('proof-demo-test', 'https://mini.example.test:9492', 'cdg')
        prepare.validate_options(*valid)
        for app in ('bad/name', 'UPPERCASE', '-bad', 'x' * 64):
            with self.assertRaises(ValueError):
                prepare.validate_options(app, valid[1], valid[2])
        for origin in ('http://mini.example.test', 'https://mini.example.test/',
                       'https://user:secret@mini.example.test', 'https://mini.example.test?q=1',
                       'https://proof-demo-test.fly.dev'):
            with self.assertRaises(ValueError):
                prepare.validate_options(valid[0], origin, valid[2])

    def test_source_traversal_cannot_write_outside_stage(self):
        payload = io.BytesIO()
        with tarfile.open(fileobj=payload, mode='w:gz') as archive:
            entry = tarfile.TarInfo(f'tlsn-extension-{prepare.REVISION}/servers/../../escape')
            entry.size = 1
            archive.addfile(entry, io.BytesIO(b'x'))
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory) / 'stage'
            stage.mkdir()
            with self.assertRaisesRegex(ValueError, 'Unsafe source archive path'):
                prepare.extract_workspace(payload.getvalue(), stage)
            self.assertFalse((Path(directory) / 'escape').exists())

    def test_source_links_are_not_followed(self):
        payload = io.BytesIO()
        with tarfile.open(fileobj=payload, mode='w:gz') as archive:
            entry = tarfile.TarInfo(f'tlsn-extension-{prepare.REVISION}/servers/linked')
            entry.type = tarfile.SYMTYPE
            entry.linkname = '/outside'
            archive.addfile(entry)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'unsupported file type'):
                prepare.extract_workspace(payload.getvalue(), Path(directory))

    def test_missing_or_tampered_released_asset_fails_closed(self):
        for include_asset in (False, True):
            payload = io.BytesIO()
            with zipfile.ZipFile(payload, 'w') as archive:
                if include_asset:
                    archive.writestr('tlsn_wasm.js', b'synthetic tampered runtime')
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(ValueError, 'layout mismatch|asset checksum mismatch'):
                    prepare.extract_assets(payload.getvalue(), Path(directory))
                self.assertFalse((Path(directory) / 'tlsn_wasm.js').exists())

    def test_existing_unowned_or_changed_stage_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage, destination = root / 'prepared', root / 'existing'
            stage.mkdir()
            destination.mkdir()
            sentinel = destination / 'keep.txt'
            sentinel.write_text('existing owner data')
            metadata = {'format': prepare.STAGE_FORMAT, 'files': {}}
            with self.assertRaisesRegex(ValueError, 'not owned'):
                prepare.publish_stage(stage, destination, metadata)
            (destination / 'provenance.json').write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, 'stage differs'):
                prepare.publish_stage(stage, destination, metadata)
            self.assertEqual(sentinel.read_text(), 'existing owner data')

    def test_runtime_staging_includes_shape_renderer_source_but_not_full_transfer_launcher(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            stage = Path(directory) / 'stage'
            (root / 'tlsn/benchmark').mkdir(parents=True)
            (root / 'infra/proof-benchmark').mkdir(parents=True)
            stage.mkdir()
            (root / 'tlsn/benchmark/gateway.mjs').write_text('// synthetic gateway')
            public = ('extension-check.mjs', 'extension-check.html', 'extension-check.plugin.mjs',
                      'response-check.mjs', 'response-check.html')
            for name in public:
                (root / 'tlsn' / name).write_text('synthetic public diagnostic')
            (root / 'tlsn/revolut.plugin.mjs').write_text('synthetic authenticated transfer code')
            (root / 'tlsn/launcher.html').write_text('synthetic authenticated transfer UI')
            for name in ('Dockerfile', '.dockerignore', 'render-fly-config.mjs'):
                (root / 'infra/proof-benchmark' / name).write_text('synthetic build input')
            for name in ('configuration.mjs', 'start.mjs'):
                (root / 'infra/proof-benchmark' / name).write_text("import '../../tlsn/benchmark/core.mjs';")
            prepare.copy_runtime(root, stage)
            self.assertTrue(all((stage / name).exists() for name in public))
            self.assertTrue((stage / 'revolut.plugin.mjs').exists())
            self.assertFalse((stage / 'launcher.html').exists())
            self.assertFalse((stage / 'plugin.mjs').exists())


if __name__ == '__main__':
    unittest.main()
