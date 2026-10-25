"""Apply narrow local-only transport restrictions to the pinned upstream source."""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess

base = Path(__file__).resolve().parents[1]
path = base / '.toolchain/tlsn-extension-68bbd380d6e1/servers/verifier/src/main.rs'
source_root = path.parents[3]
privacy_verifier = source_root / 'servers/verifier/src/verifier.rs'
privacy_patch = base / 'infra/proof-benchmark/verifier-privacy.patch'
upstream_hash = 'dcde6884045b4fd89b662988527c129357468f99fea855088c926f0e5d60cc96'
patched_hash = '75736d41b5fb88f4e49eb3ad7b3711540cde5f0139192849f0137b9a137bd8dd'
patch_hash = 'aabc7aa749cc269f86c9875bfa249ed6bdde08923e84046e744eb86b2a3538f2'


def sha256(file_path):
    return hashlib.sha256(file_path.read_bytes()).hexdigest()


def apply_privacy_patch():
    if sha256(privacy_patch) != patch_hash:
        raise SystemExit('Verifier privacy patch checksum mismatch; preserving staged source.')
    provenance_path = source_root / 'verifier-privacy-provenance.json'
    provenance = {
        'upstreamRevision': '68bbd380d6e1a89d79748e5294661c752f5d1205',
        'sourceArchiveSha256': 'a8f7080ce953e59f930654fb08c9e66f6373fbadbd122593e3e1502bf83ff25a',
        'privacyPatchSha256': patch_hash,
        'upstreamVerifierSha256': upstream_hash,
        'patchedVerifierSha256': patched_hash,
        'transcriptFormattingRemoved': True,
        'proxyCommitmentRefused': True,
        'deployed': False,
    }
    if provenance_path.exists():
        try:
            if json.loads(provenance_path.read_text()) != provenance:
                raise SystemExit('Verifier privacy provenance conflicts with existing stage; preserving it.')
        except (OSError, ValueError):
            raise SystemExit('Verifier privacy provenance is unreadable; preserving existing stage.') from None
    current = sha256(privacy_verifier)
    if current == upstream_hash:
        result = subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '--input', str(privacy_patch)],
                                cwd=source_root, capture_output=True, text=True)
        if result.returncode or sha256(privacy_verifier) != patched_hash:
            raise SystemExit('Reviewed verifier privacy patch failed; preserving staged source.')
    elif current != patched_hash:
        raise SystemExit('Verifier source differs from pinned upstream/privacy patch; preserving staged source.')
    if sha256(privacy_verifier) != patched_hash:
        raise SystemExit('Patched verifier checksum mismatch; preserving staged source.')
    if not provenance_path.exists():
        provenance_path.write_text(json.dumps(provenance, indent=2) + '\n')


apply_privacy_patch()
before = path.read_text()
if '// stellar-proof-gate local restrictions' in before:
    print('Local verifier restrictions already present.')
    raise SystemExit(0)
changes = [
    ('SocketAddr::from(([0, 0, 0, 0], port))', 'SocketAddr::from(([127, 0, 0, 1], port))'),
    ('    let host = query.token;\n', '''    // stellar-proof-gate local restrictions: no general-purpose TCP proxy.
    let host = query.token;
    if !host_allowed(&host) {
        return Err((StatusCode::FORBIDDEN, "Target is not permitted".to_string()));
    }
'''),
    ('            let server_name_str = server_name.as_ref();\n', '''            let server_name_str = server_name.as_ref();
            if !host_allowed(server_name_str) {
                let _ = result_tx.send(VerificationResult {
                    results: vec![],
                    error: Some("TLS server is not permitted".to_string()),
                });
                cleanup_session(&state, &session_id).await;
                return;
            }
'''),
    ('// Health check endpoint handler\n', '''fn host_allowed(host: &str) -> bool {
    let allowed = std::env::var("TLSN_ALLOWED_HOSTS")
        .unwrap_or_else(|_| "app.revolut.com".to_string());
    allowed.split(',').any(|candidate| candidate.trim() == host)
}

// Health check endpoint handler
'''),
]
after = before
for old, new in changes:
    if after.count(old) != 1:
        raise SystemExit('Pinned source does not match the expected patch location.')
    after = after.replace(old, new)
path.write_text(after)
patch = ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
    fromfile='upstream/servers/verifier/src/main.rs', tofile='local/servers/verifier/src/main.rs'))
(base / 'tlsn/verifier-local-restrictions.patch').write_text(patch)
print('Verifier binds loopback and restricts authenticated/proxied target hostnames.')
