"""Apply narrow local-only transport restrictions to the pinned upstream source."""
from pathlib import Path
import difflib

base = Path(__file__).resolve().parents[1]
path = base / '.toolchain/tlsn-extension-68bbd380d6e1/servers/verifier/src/main.rs'
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
