# Static demo candidate

`npm run build:demo` prepares `dist/demo` from the app's explicit asset allowlist. It copies no policy service, signer, bank credentials, proof tooling, test data or server environment. The output includes a hashed manifest marked `synthetic-demo` with live payment verification and settlement set to false.

Build only after importing a stable app snapshot. Review the generated manifest and app labels before publishing. The build command does not publish, provision hosting or change an existing cloud service.

Serve `dist/demo` from an HTTPS static host. Apply the security headers in `_headers` using the hosting platform's supported configuration. In particular, `connect-src 'none'` keeps this synthetic demo from contacting bank, proof, wallet or policy services. A provider that ignores `_headers` needs equivalent explicit header configuration.

Publishing needs the selected account, hostname and existing authorization to be confirmed. A reachable URL must then be checked in a fresh browser on a separate device. Until that happens, the artifact is a deployment candidate, not a public demo.

Testnet settlement belongs in a separate, explicitly configured integration adapter. Do not add a signing key, release API or live proof callback to this static artifact to make the synthetic path appear live.
