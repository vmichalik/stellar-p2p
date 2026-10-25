# Live service continuation

The host connects wallet approvals, confirmed Stellar reads, transaction journals and the payment policy. Both browser modes use the shared website entry point; demo mode loads its own sample adapter. [Current source and deployment](../handoff.md).

## Host setup

`integration/host-runtime.mjs` exports `createHostRuntime`. With no deployment, it returns an unconfigured view; the UI prompts for neither a wallet nor a transaction. A trusted operator module can export `createRuntime({publicOrigin})` and be selected with `PACTLANE_HOST_MODULE`. This module is a local file, never an HTTP upload or public static asset.

The configured factory requires the validated `deployment` (network passphrase, HTTPS RPC URL, escrow contract, token, seven decimals, policy public key, escrow WASM hash and maximum fee), a confirmed `deploymentLedger` string and an absolute private `storageDirectory`. `orderIds` and owner-approved `sellerDrafts` supply the bounded MVP catalog. The durable catalog reserves capacity before signing and remembers confirmed funding results; this is not a complete market indexer. A missing order read does not hide valid orders. The host checks the deployed WASM/configuration and exact ledger freshness before every enabled mutation, including the first funding transaction. Optional `offerReader` and `policyFor` ports supply trusted private offer and policy data. Do not derive recipient identities, salts or verified bindings from browser input. Submission defaults to false and must reflect a separately authorized deployment/trade configuration.

`PACTLANE_LIVE_PORT` defaults to 17861. The listener binds only `127.0.0.1`; `PACTLANE_PUBLIC_ORIGIN` must exactly match the browser origin, with HTTPS required except for loopback. A remote device needs an authorized reachable route; the local listener is not that handoff. The server serves an explicit file allowlist and the installed Freighter 6.0.1 bundle, pinned by version and SHA-256, with a restrictive CSP. Configuration and SQLite files are not routes.

The complete-record receiver and normalizer are implemented and have accepted an authenticated record. Payment locking stays disabled until the host has the approved durable policy composition and bank-to-wallet bindings. The browser cannot enable it with a flag. [Mainnet composition](mainnet-test.md).

## Browser and wallet

`app/host-client.mjs` handles Freighter account access, exact SEP-53 challenge signing, session identity and operation polling. `app/live-view-adapter.mjs` holds only authoritative view state and confirmed results. Amounts remain integer strings/BigInt; no synthetic reducer or local settlement arithmetic is imported. Terminal order state alone does not establish a transfer receipt: receipt amounts require the service's reconciled token events and matching transaction, contract and network. Confirmed release/refund metadata is retained privately and restored for the owning account after reload; the receipt still rechecks RPC evidence. A terminal order without a known confirmed transaction shows that the receipt is unavailable.

The client uses same-origin credentials, rejects redirects, checks account/network before and after signing, and handles each wallet request once. Unknown outcomes retain the operation ID and can poll that operation; they never automatically resend a mutation. Logout or an account switch invalidates late private results. A timeout cannot cancel an already opened wallet prompt or submitted transaction.

`createBrowserBridge` authenticates the exact signed challenge and binds cookies, operations and wallet replies to a session. `GET /api/view` returns only allowed deployment, offer and account-owned fields. Fund/reserve identities come from the session. Other routes are session challenge/verify/read/delete, allowlisted commands, operation status and one-use wallet results. Services are instantiated per session; durable journals and payment stores are shared. No arbitrary dispatch or proof-success shortcut is exposed. Recovery is the explicit bounded two-session workflow described below.

## Durable retry handling

The transaction journal records attempt ownership, account/argument bindings, offered transaction hashes and append-only history. Preparation failure before the buyer receives a transaction can be retried on a new explicit action. Only the pinned Freighter refusal result, code `-4` with no signed envelope or signer, is treated as a definite wallet refusal. A revised allocation is allowed only after a durably retryable attempt. Stale attempt owners cannot store or submit a replacement.

Generic wallet failures, timeouts and every returned envelope retain the pending outcome for reconciliation. Logout, elapsed time and process restart never clear it. Legacy preparing rows remain blocked. No journal record is deleted to make a retry pass.

## Two-session recovery transport

`integration/recovery-broker.mjs` derives requests from a trusted order snapshot and the collector's exact unsigned authorization. A buyer starts `resolve(orderId, buyerTokens)` inside the normal durable transaction operation. The seller sees only their requests in `/api/view`, with the full token split, order, parties, network, contract and expiry.

An explicit seller action claims `POST /api/recovery/:id/claim` once. The claim binds the seller session and returns a one-use token plus authorization preimage. The browser compares the claim with the reviewed terms, permits only a shorter session-bound expiry, checks account/network, then calls Freighter `signAuthEntry`. Freighter returns a 64-byte signature over that preimage, not a complete authorization entry. `POST /api/recovery/:id/respond` sends the signature and signer address; the host reconstructs and validates the entry. The collector independently checks it before requesting the buyer's final envelope signature. Seller approval alone submits nothing.

Requests expire within 45 seconds, the buyer operation deadline and both participating session lifetimes. The runtime allows 24 ledgers for the authorization so the two sequential wallet prompts fit within the bounded operation; current ledger expiry is still enforced before and after buyer signing. Logout cancels pending requests. Unknown replies are never automatically claimed or signed again. A confirmed recovery is reconciled from its journal hash without asking either party to sign again. Recovery can operate on existing orders while payment verification is unavailable; new payment locking remains disabled.

## Recovery and policy boundaries

`createStellarServices.resolve(orderId, buyerTokens)` uses the buyer's final transaction signature plus the seller's exact Soroban authorization. The host validates allocation, invocation, nonce, expiry, network and simple Ed25519 account policies, then simulates before and after buyer signing. Multisig, contract wallets and delegated authorization remain unsupported. The live browser now exposes buyer-proposed exact splits and explicit seller approval/decline through the authenticated broker. There is no unilateral refund after payment lock.

`createChainReader` reads contract instance/configuration, order and optional used-nullifier in one ledger response, verifies WASM/token/signer identity and obtains that exact ledger's timestamp. `readOrder` is a private policy port containing the recipient salt; it waits for reconciliation and must never be exposed through HTTP. `readSnapshot` omits private offer data. Instructions require the bound buyer, confirmed lock and verified destination; the deadline is checked again after a slow private lookup.

`createChainReconciler` scans contiguous bounded event ranges from the confirmed deployment ledger. Full pages split; saturated single ledgers and missing retained history stop without advancing. It atomically records recovery holds and checkpoints, including order ID `0`. Every `Resolved` event creates the existing conservative global hold. Clearing it requires a trusted complete nonempty payment-identity manifest; the operator workflow is still unfinished. These reads trust the configured RPC and are not independent consensus proofs.

## Verification

The integrated tests cover the browser, authenticated HTTP bridge, runtime, recovery broker and collector with fixture signatures and controlled RPC responses. They check that both approvals precede recovery, receipt amounts match token events, and reconciliation never submits a second transaction. [Current verification](../verification.md).

The [PLTEST rehearsal](../../evidence/release/testnet-rehearsal-2026-10-25.json) separately records on-chain release and mutual recovery. [The mainnet runbook](mainnet-test.md) covers the remaining operator connection for the approved 1 USDC trade.
