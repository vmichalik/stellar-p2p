# Live service continuation

Objective: connect the existing Pactlane app to confirmed Stellar state and wallet approvals without relying on demo transitions. This local continuation is based on `6f20b8ff03492399e73b46d425e51ab311df6228` in `/private/tmp/pactlane-coordinator-review-20261025`, branch `codex/pactlane-live-services`, on the Mac mini. Use `git rev-parse HEAD` and `git status --short` for the current commit and changes.

The Node modules below are implemented. They have not been connected to the browser app or deployed. The app still imports `createDemoAdapter`. Bank tests remain paused, live normalization still rejects unverified evidence, and no transaction submission is enabled by default.

## Recovery authorization

`integration/recovery-authorization.mjs` is connected to `createStellarServices.resolve(orderId, buyerTokens)`. The buyer initiates recovery and signs the final transaction envelope. The seller separately signs the exact Soroban authorization entry for that order and allocation. No third wallet is required.

Supply a server-controlled `recovery.seller` port with `selected()`, `network()` and `signAuthorization(request)`. The request contains `entryXdr`, `account`, `networkPassphrase`, `expirationLedger`, `contract`, `orderId` and decimal-string `buyerTokens`; return the signed authorization-entry XDR. The host checks the invocation, nonce, expiration, seller signature and both account policies, then enforces simulation before and after the buyer signs. It supports simple Ed25519 accounts; multisig, contract wallets and delegated authorization are rejected. `validForLedgers` defaults to 12 and is bounded to 2–60.

The existing durable order-wide journal reserves before either approval. A failed or cancelled preparation is not permission to delete the record or submit a new allocation. Reconciliation remains necessary. The browser still needs counterparty approval routing; the HTTP bridge does not expose `resolve` until that is connected.

## Consistent chain reads and reconciliation

`createChainReader` in `integration/chain-reader.mjs` requires the configured testnet deployment, including `escrowWasmSha256`, a trusted RPC and a private `offerReader`. It reads the contract instance/configuration, order and optional used-nullifier in one `getLedgerEntries` response, verifies code/token/signer identity and reads the timestamp for that exact ledger. Monetary and identifier values remain decimal strings. This trusts the configured RPC; it is not independent consensus verification.

Its `readOrder({domain, orderId, nullifier})` is a **private policy port**, including the private recipient salt. Never expose it through HTTP. It recomputes the recipient commitment from the server-owned offer record and calls `reconciler.syncThrough` before returning. `readSnapshot` omits private offer data. `instructionsFor(account).read` requires the bound buyer, confirmed payment lock, unexpired payment window and verified destination binding; it checks the deadline again after a slow private lookup.

`createChainReconciler({domain, deploymentLedger, server, store})` in `integration/chain-reconciler.mjs` scans from a confirmed deployment ledger or durable checkpoint. Bounded `getEvents` ranges and validated XDR determine coverage; `latestLedger` alone does not. Full pages split into smaller ranges. A saturated single ledger or missing retained history stops without advancing. This follows the [standard RPC range implementation](https://raw.githubusercontent.com/stellar/stellar-rpc/main/cmd/stellar-rpc/internal/methods/get_events.go).

`ReplayStore.reconcileChainBatch` commits all manual-recovery holds and the contiguous checkpoint atomically. Deployment origin is pinned; stale duplicate scans cannot recreate a cleared hold, and blind `advanceCheckpoint` calls are rejected once indexing starts. Order ID `0` is valid. Every `Resolved` event retains the existing conservative global hold until a trusted complete payment-identity manifest reconciles it. Empty or unknown manifests cannot clear the hold; the operator workflow for this remains unfinished.

## Authenticated browser transport

`createBrowserBridge({publicOrigin, createServices, ...limits})` in `integration/browser-bridge.mjs` returns a Node HTTP `handler` and `close()`. The caller owns the listener and authenticated service composition. HTTPS is required except for an explicitly configured local loopback origin.

- `POST /api/session/challenge` with `{account}` returns an origin/network/account-bound challenge and an HttpOnly pre-auth cookie.
- Sign the exact challenge using Freighter `signMessage`, then `POST /api/session/verify` with `{challengeId, signature}` where the signature is canonical base64. The SDK verifies the Stellar signed-message format, consumes the challenge once and issues a session cookie.
- `POST /api/commands` with `{action,args}` starts an allowlisted service operation; `GET /api/operations/:id` returns its state and any wallet request.
- Handle the wallet request in the browser, then `POST /api/operations/:id/wallet-results/:requestId` with `{result}` or `{error}`. Requests and results are bound to that session and operation and are consumed once.
- `GET /api/session` reads identity; `DELETE /api/session` ends the session.

Instantiate `createStellarServices` per session with the bridge's supplied wallet port. Its mutable selected accounts must not be shared across sessions. Keep persistent replay and transaction stores shared as required by their contracts. Fund/reserve identities come from the authenticated session; output projections exclude private salts, recipient records, headers and arbitrary service fields. A login proves control of the signing key; the service must still enforce on-chain account and transaction authorization.

The bridge exposes neither a proof-success shortcut nor arbitrary service dispatch. Proof launch and cross-session recovery authorization remain unwired. A timed-out transport job is an unknown outcome, not cancellation of a signed transaction; the journal is never cleared by logout or timeout.

## Validation

The complete local JavaScript suite passed **232 tests with zero skips**: 110 root, 55 policy, 11 protocol and 56 integration. Eight Python preparation tests passed; syntax checks covered 77 source/generated modules and inline scripts. Prettier and diff checks passed. These use mocked RPC/wallets, actual SDK signatures/XDR, actual loopback HTTP and SQLite restart cases. Native/WASM contract tests were not rerun because contract source/artifact did not change.

A separate read-only public testnet check at 14:08:46 UTC confirmed protocol 29, a native-token ledger entry and its exact matching ledger timestamp at sequence 5,382,747. This validates RPC response shapes, not a Pactlane deployment or payment. [Machine-readable evidence](../../evidence/release/live-service-checks.json) records both scopes.

## Next implementation

1. Compose a host with persistent stores, the confirmed deployment ledger, approved deployment configuration, private offer binding and the real verifier/policy ports. Run the reconciler before signing. Do not create recipient identities or mark bindings verified from browser input.
2. Add the Freighter browser client and a live view adapter with cached `snapshot()/subscribe()` and asynchronous actions. Await connect/reserve/refund/form operations. Keep decimal strings or BigInt internally; do not reuse demo transitions that fabricate balances and confirmations.
3. Connect counterparty recovery approvals and show the exact allocation in both wallets. Keep fiat instructions behind the confirmed lock and use reconciled chain events for receipts.
4. Verify the real browser and authorized testnet path. The local mocked-RPC and signed-fixture checks do not establish that path. Accepted bank evidence and a source-backed normalizer remain required for payment-driven release.

The existing silent-video and truthful-demo instructions remain in effect. No new bank request, deployed service, real wallet signature or transaction was performed by this continuation.
