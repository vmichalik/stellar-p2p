# Live service continuation

Objective: connect Pactlane to confirmed Stellar state and wallet approvals. Execution host: Mac mini; isolated checkout `/private/tmp/pactlane-coordinator-review-20261025`, branch `codex/pactlane-live-services`. This continuation starts from `60883fe9f4d8f1e589d81384f1e8709c4beaf82b`. Check `git rev-parse HEAD` and `git status --short` for the current revision and local changes.

The separate live browser entry point, authenticated host and wallet client are implemented locally. `npm run dev:live` serves them on loopback, initially unconfigured. `npm run dev:app` remains the synthetic demo. Neither command deploys a contract or enables transactions. Bank tests remain paused, and accepted payment evidence is still missing.

## Host setup

`integration/host-runtime.mjs` exports `createHostRuntime`. With no deployment, it returns an unconfigured view; the UI prompts for neither a wallet nor a transaction. A trusted operator module can export `createRuntime({publicOrigin})` and be selected with `PACTLANE_HOST_MODULE`. This module is a local file, never an HTTP upload or public static asset.

The configured factory requires the pinned testnet `deployment` (network passphrase, HTTPS RPC URL, escrow contract, token, seven decimals, policy public key, escrow WASM hash and maximum fee), a confirmed `deploymentLedger` string and an absolute private `storageDirectory`. `orderIds` and owner-approved `sellerDrafts` supply the bounded MVP catalog. The durable catalog reserves capacity before signing and remembers confirmed funding results; this is not a complete market indexer. A missing order read does not hide valid orders. The host checks the deployed WASM/configuration and exact ledger freshness before every enabled mutation, including the first funding transaction. Optional `offerReader` and `policyFor` ports supply trusted private offer and policy data. Do not derive recipient identities, salts or verified bindings from browser input. Submission defaults to false and must reflect a separately authorized deployment/trade configuration.

`PACTLANE_LIVE_PORT` defaults to 17861. The listener binds only `127.0.0.1`; `PACTLANE_PUBLIC_ORIGIN` must exactly match the browser origin, with HTTPS required except for loopback. A remote device needs an authorized reachable route; the local listener is not that handoff. The server serves an explicit file allowlist and the installed Freighter 6.0.1 bundle, pinned by version and SHA-256, with a restrictive CSP. Configuration and SQLite files are not routes.

Payment verification remains unavailable. The runtime refuses every new `beginPayment` call and reports `paymentProof: false`; the UI withholds the payment-lock action and fiat instructions. Existing locked trades show held funds. Changing a browser flag cannot enable the host action. Future payment enablement needs an accepted normalizer, trusted policy composition and another reviewed change.

## Browser and wallet

`app/host-client.mjs` handles Freighter account access, exact SEP-53 challenge signing, session identity and operation polling. `app/live-view-adapter.mjs` holds only authoritative view state and confirmed results. Amounts remain integer strings/BigInt; no synthetic reducer or local settlement arithmetic is imported. Terminal order state alone does not establish a transfer receipt: receipt amounts require the service's reconciled token events and matching transaction, contract and network. Confirmed release/refund metadata is retained privately and restored for the owning account after reload; the receipt still rechecks RPC evidence. A terminal order without a known confirmed transaction shows that the receipt is unavailable.

The client uses same-origin credentials, rejects redirects, checks account/network before and after signing, and handles each wallet request once. Unknown outcomes retain the operation ID and can poll that operation; they never automatically resend a mutation. Logout or an account switch invalidates late private results. A timeout cannot cancel an already opened wallet prompt or submitted transaction.

`createBrowserBridge` authenticates the exact signed challenge and binds cookies, operations and wallet replies to a session. `GET /api/view` returns only allowed deployment, offer and account-owned fields. Fund/reserve identities come from the session. Other routes are session challenge/verify/read/delete, allowlisted commands, operation status and one-use wallet results. Services are instantiated per session; durable journals and payment stores are shared. No arbitrary dispatch, proof-success shortcut or cross-session recovery command is exposed.

## Durable retry handling

The transaction journal records attempt ownership, account/argument bindings, offered transaction hashes and append-only history. Preparation failure before the buyer receives a transaction can be retried on a new explicit action. Only the pinned Freighter refusal result, code `-4` with no signed envelope or signer, is treated as a definite wallet refusal. A revised allocation is allowed only after a durably retryable attempt. Stale attempt owners cannot store or submit a replacement.

Generic wallet failures, timeouts and every returned envelope retain the pending outcome for reconciliation. Logout, elapsed time and process restart never clear it. Legacy preparing rows remain blocked. No journal record is deleted to make a retry pass.

## Recovery and policy boundaries

`createStellarServices.resolve(orderId, buyerTokens)` uses the buyer's final transaction signature plus the seller's exact Soroban authorization. The host validates allocation, invocation, nonce, expiry, network and simple Ed25519 account policies, then simulates before and after buyer signing. Multisig, contract wallets and delegated authorization remain unsupported. Counterparty approval transport is unfinished, so the live browser does not expose recovery. There is no unilateral refund after payment lock.

`createChainReader` reads contract instance/configuration, order and optional used-nullifier in one ledger response, verifies WASM/token/signer identity and obtains that exact ledger's timestamp. `readOrder` is a private policy port containing the recipient salt; it waits for reconciliation and must never be exposed through HTTP. `readSnapshot` omits private offer data. Instructions require the bound buyer, confirmed lock and verified destination; the deadline is checked again after a slow private lookup.

`createChainReconciler` scans contiguous bounded event ranges from the confirmed deployment ledger. Full pages split; saturated single ledgers and missing retained history stop without advancing. It atomically records recovery holds and checkpoints, including order ID `0`. Every `Resolved` event creates the existing conservative global hold. Clearing it requires a trusted complete nonempty payment-identity manifest; the operator workflow is still unfinished. These reads trust the configured RPC and are not independent consensus proofs.

## Evidence and remaining work

The previous service-only checks remain recorded in [live-service-checks.json](../../evidence/release/live-service-checks.json), including the read-only public testnet observation at 14:08:46 UTC. That observation established API response shapes, not a Pactlane deployment or approved trade asset. The new browser/host checks are recorded separately in [live-browser-host-checks.json](../../evidence/release/live-browser-host-checks.json): 286 JavaScript tests, eight Python checks and 87 syntax checks passed, with zero skips. RPC and wallet dependencies are mocked; real SDK signatures/XDR, loopback HTTP and SQLite restart paths are exercised. Native/WASM contract suites were not rerun because their source and artifact did not change. Historical evidence is not silently relabeled.

The actual browser/HTTP rehearsal passed at desktop, 390px and 320px widths: seller funding, buyer reservation, disabled locking while verification is unavailable, then a disposable mock runtime enabled the future lock/instructions/policy/release/receipt path. Reload required explicit receipt reconciliation. There was one release, no stored private destination, no page errors or horizontal overflow. Two anonymous session reads returned the expected 401. Freighter, policy and chain behavior were mocked with public fixture keys; this is not an authenticated payment or live-chain success.

Remaining work: approved deployment/private offer/policy configuration; accepted TLS payment semantics and normalization; seller recovery approval routing; complete manual-payment reconciliation; real authorized wallet/testnet validation; a reachable hosted handoff; silent video/deck and submission. The local app is useful integration progress, not payment-to-chain success. No real wallet signature, transaction, bank retry or deployment was performed by this continuation.
