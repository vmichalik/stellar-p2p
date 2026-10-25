# Integration workbench

`integration/` contains the local synthetic WASM rehearsal and the Node testnet host/browser workbench. These are separate from the public synthetic app at `https://pactlane.io`. A disposable testnet rehearsal passed on 25 October 2026; it used PLTEST and synthetic authorization, not real USDC or bank evidence. The release gate remains `NOT_CLEARED`.

Start with the [architecture study](../docs/architecture/study.html), [host security and setup](host/README.md), and [recovery authorization detail](RECOVERY.md).

## Local compiled-WASM rehearsal

The local harness connects the app's fixed order terms, the real policy engine, canonical Ed25519 claim verification, and compiled Soroban escrow WASM. Its evidence and token are synthetic. It is useful for checking order bounds, signature encoding, payout, and replay behavior without submitting a network transaction. See [local rehearsal evidence](../evidence/release/local-wasm-rehearsal.json).

The fixed example is €20 and 22 tokens: `fiat_minor = 2000` cents and `token_amount = 220000000` atoms at seven decimals. These are synthetic test terms.

## Host and browser boundary

The Node host (`host/serve.mjs`) verifies the configured deployment's creation transaction and on-chain WASM hash before serving the browser workbench. Deployment submission is disabled by default. The optional signing key does not have to be present; without a configured key and trusted evidence adapters, authorization stays closed.

The browser keeps its bearer capability in memory after reading the URL fragment, then removes the fragment from the address bar. Requests use a bearer header and must match the configured `Host` and `Origin`; the host also applies request bounds and rate limits. The private link is written to `access-link.txt` with mode `0600`; its value is not printed to stdout. Treat the link as a secret. A bearer capability grants access to the workbench; it is not proof of a person's identity.

The host never receives wallet seed material. The browser calls the installed Freighter API after a user prompt. The host can build and submit exact testnet transactions, reconcile the saved transaction hash after uncertain outcomes, and confirm receipts against the contract, order, and token events. The local fixture tests do not validate real Freighter behavior.

## Policy and live evidence

The policy route accepts an evidence identifier rather than a browser-supplied claim or evidence payload. A trusted policy adapter must fetch verifier evidence and the engine must normalize it. The live normalizer currently throws `TLSN_PAYMENT_SCHEMA_UNVERIFIED`, so proof and release requests remain closed without an accepted adapter and source-backed semantics. Synthetic fixtures cannot clear this gate.

The durable replay database is bound to one network/escrow domain; it must not be reused for another deployment without reviewed coverage. The indexer checkpoints only complete event pages and places a manual hold before it passes `Resolved` orders. Holds are not auto-cleared. Transaction journals prevent creating a second action merely because an RPC response was uncertain.

## Testnet rehearsal evidence

The captured [25 October run](../evidence/release/testnet-rehearsal-2026-10-25.json) passed with the reviewed WASM and a disposable PLTEST token. Order 0 paid 220,000,000 token atoms, a replay was rejected, and order 1 resolved as a mutual 110,000,000/110,000,000 split. The evidence includes confirmed public testnet transaction hashes and receipts.

The run used programmatic disposable keys through the wallet port, not the Freighter extension UI. It used synthetic payment authorization, not a bank request. It did not use USDC or validate production operations. An earlier recovery attempt exposed an auth-entry serialization bug; the passed run uses the rebuilt XDR-backed operation path after that fix.

## Verifier logging source patch

The source-level privacy patch removes transcript formatting from INFO and DEBUG logging and rejects Proxy commitment mode before connecting to the proxy target. The patched verifier passed `cargo check --offline`. It was not release-built, deployed, or runtime-retested as a service. This is not evidence about the current logs of a running verifier.

## Checks

Run deployment-independent host and browser tests with:

```sh
node --test integration/host/*.test.mjs integration/browser/*.test.mjs
```

These tests use fixtures/mocks where appropriate and do not submit transactions or validate authenticated bank evidence. The passed testnet run is historical evidence; this command does not reproduce it. See the parent [verification record](../docs/verification.md) for the exact checks run in the current checkout.
