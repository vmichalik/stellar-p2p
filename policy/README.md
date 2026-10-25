# Payment policy

Pactlane’s payment service matches an authenticated Revolut transfer to a locked Stellar order, reserves its payment identity and signs the claim used for release. The live normalizer accepts opaque records issued by the authenticated verifier store.

The contract owns the protocol. `vendor/escrow-protocol.mjs` and `test/fixtures/protocol-vectors.json` are unchanged snapshots of its encoder and frozen public vectors, with SHA-256 hashes in `vendor/manifest.json`. Run the synchronization check against the integrated contract tree before release. Update these files by copying a reviewed contract revision; do not maintain a divergent encoder.

For sanitized app states and action tokens, use the browser-safe `./presentation` entry point described in [APP-STATES.md](APP-STATES.md). It distinguishes proof/payment problems, replay, mutual recovery and uncertain submitted transactions without granting execution authority or returning raw input.

## Run

Use Node 22.13 or later with `node:sqlite` available. This work was checked on Node 26.7.0 on the Mac mini.

```sh
cd policy
npm ci --ignore-scripts
npm test
# Defaults to the integrated repository's contracts/escrow/protocol/:
npm run check:protocol
# Or point at the separate contract-owner worktree:
npm run check:protocol -- /absolute/path/to/contract-worktree
```

The test suite uses frozen snapshots and requires no network, bank login, live key or chain submission. Its two protocol vectors cover the illustrative EUR 20 / 22 USDC claim and integer/address boundaries, including values beyond JavaScript's safe integer range.

## Caller boundary

`createLivePaymentPolicy` returns a server object with these methods. Pass only canonical decimal-string order IDs and opaque evidence/recovery references. Extra fields, browser evidence, digests, claims, amounts and order snapshots are rejected.

| Method                      | Input                   | Effect                                                                                                                                                                    |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue`                     | `{orderId, evidenceId}` | Load evidence and order through configured server adapters; validate; reserve; sign the internally constructed digest                                                     |
| `reconcileRelease`          | `{orderId, evidenceId}` | Require confirmed `Released` and `payment_used(nullifier)` before marking the issued identity settled                                                                     |
| `beginManualReconciliation` | `{orderId}`             | Create a durable global signing hold for a paying/reserved/resolved order                                                                                                 |
| `reconcileManualResolution` | `{resolutionId}`        | Load a complete, confirmed payment manifest through the server recovery adapter; require `Resolved`; permanently consume every payment identity before clearing that hold |

All errors crossing these methods are fixed `PolicyError.code` values. Exception messages, bank identities and raw evidence are not returned or logged. The successful claim contains on-chain terms and commitments, not the identity preimages or recipient salt. Signing-key access belongs to the host's existing authorized server credential mechanism.

`createEd25519SigningAdapter({publicKeyHex, signDigest})` accepts a server-controlled raw Ed25519 signing callback. The engine verifies every returned 64-byte signature against the configured on-chain public key. It signs the raw 32-byte canonical digest, never a caller digest or hex text. Both public fixture keys used here and in the contract vectors are rejected by the live factory. The live factory also rejects synthetic stores and unregistered signing-adapter objects.

## Required authoritative adapters

These are server-bootstrap dependencies, not request fields. There is no route that lets a browser select an adapter or set a trust flag. An integration must authenticate these upstreams and authorize its own HTTP callers.

- `verifierReader.readVerifiedRecord(evidenceId)`: obtain an independently accepted TLSNotary record through a trusted server channel. The normalizer accepts only records issued by the authenticated verifier store; browser objects, public connection proofs and test fixtures cannot enter this path.
- `ledgerReader.readOrder({domain, orderId, nullifier})`: obtain confirmed `get_order`, `get_config` and `payment_used(nullifier)` results from the configured Stellar escrow. Return one consistent ledger view, not separately fetched browser snapshots. The normalized record has `network_passphrase`, `contract`, `confirmed`, `ledgerSequence`, `ledgerTimestamp`, `config`, `order`, `offerData` and `paymentUsed`. `config` contains canonical contract `token` and raw signing-key hex `signer`; `order` contains decimal-string `id`, state, buyer, `reserved_at`, `locked_at`, `pay_by` and the exact contract `terms`. `offerData.recipientSalt` comes from the server's authorized private offer-data channel and must correspond to the immutable funded recipient commitment. Ledger age defaults to at most 60 seconds; future ledgers fail.
- `manualResolutionReader.readConfirmedManifest(resolutionId)`: load an independently confirmed recovery record with `orderId`, the **complete** list of `evidenceIds`, `complete:true` and `confirmed:true`. Those flags are assertions of a trusted reconciler, not sufficient evidence when supplied by a client. An on-chain `Resolved` event does not reveal the fiat payment identity. Unknown or incomplete manifests cannot clear a hold. The reader is optional; absence leaves manual reconciliation blocked.

All integers from adapters are canonical unsigned decimal strings. Fiat values are positive EUR cents and token values are positive i128 base units. The policy requires the exact completed outgoing transfer type, source host/method/status, recipient commitment, payer-scoped stable payment ID, amount and currency. Payment completion must satisfy `locked_at <= paid_at < pay_by` and `paid_at <= ledger_time`. Claims expire strictly after current time, defaulting to 120 seconds and capped at 300. An in-window payment may be proven after `pay_by`; the order must still be `Paying`.

## Accepted Revolut record

`tlsn-record.mjs` validates the complete authenticated HTTP response and JSON array before normalizing it. The record must match the transaction ID in the request and describe a completed outgoing EUR transfer through the supported Revolut username route.

- `amount` is a negative integer debit in cents; `-500` becomes a positive `amountMinor` of `500`.
- `completedDate` is normalized from milliseconds to Unix seconds, after checking temporal consistency.
- `registeredIdentityId` supplies the payer identity scope. A stable identity across pockets prevents the same payment gaining a new nullifier through another account view.
- `recipient.identityId` supplies the recipient identity. Account fields and transfer identity are checked as context; display names do not substitute for them.
- The current supported route requires zero fees and `amountWithCharges === amount`; unsupported charges are rejected.

An authenticated record was accepted on 25 October. [Evidence](../evidence/release/complete-record-accepted.json). Issuing a release claim additionally requires the approved wallet-to-bank bindings, current order state and replay checks. [Current deployment status](../docs/status.md).

## Durable consumption and manual recovery

`ReplayStore` uses SQLite WAL, `synchronous=FULL`, immediate transactions and unique global nullifier/order bindings. Store files are private and marked as either `LIVE` or `SYNTHETIC_ONLY`; a file cannot be reopened in the other mode. Use a private directory and one durable registry across **every deployment/network served by this signer**. Do not use `:memory:` for a deployed service. The host supplies file protection, backups and chain reconciliation; keep the registry durable across deployments.

The fixed canonical nullifier depends on rail, source origin, verified payer scope and stable payment ID. It excludes order, network, contract, recipient, amount and time. A changed order or deployment therefore cannot free the payment for reuse.

- `PENDING`: the payment/order reservation is committed **before** signing. Signing failure or uncertain delivery leaves it reserved. A retry for the same order signs the same persisted digest/expiry; a different order fails.
- `ISSUED`: return the same stored claim and signature after fresh order/evidence checks. Expiry never clears a payment binding. Renewal after expiry requires explicit chain/outcome reconciliation; no automatic renewal/unreserve path exists.
- `SETTLED`: confirmed release permanently consumes the identity.
- `MANUAL`: complete confirmed manual recovery permanently consumes the identity even for a refund or split. No marker is deleted on expiry, failure or cleanup.

A trusted chain indexer must process all contract events and call `advanceCheckpoint(escrowDomainKey(domain), ledgerSequence)` only after processing that ledger. Issuance requires a checkpoint at least as recent as its authoritative order snapshot. Indexing a `Resolved` event with an unidentified fiat payment must create `holdManualResolution(orderBinding(domain, orderId))` **before** advancing. The application should call `beginManualReconciliation` before presenting manual settlement authorization; the independent indexer must also catch resolutions submitted directly by wallets. Each unresolved hold blocks all issuance conservatively until a trusted complete manifest is reconciled. All served deployments must be registered/indexed; a checkpoint cannot stand in for coverage of an unknown deployment.

Low-level replay-store mutation methods are server-internal plumbing and are not authenticated RPC endpoints. Exposing `advanceCheckpoint`, hold clearing or raw `markReleased` calls to browser callers would break the boundary. Token balances and on-chain settlement remain the escrow's responsibility; this policy issues no transaction.

## Synthetic integration

Import `createSyntheticPaymentPolicy` from the explicit `./testing` entry point. It snapshots server fixture maps, fixes its own public test-only signer, and has no live signing-key injection, RPC client or release route. Responses are always branded `SYNTHETIC_POLICY_CLAIM_NOT_FOR_RELEASE`, `syntheticOnly:true`, `releaseGate:NOT_CLEARED`. The live entry point cannot consume those fixtures or that key. The successful synthetic end-to-end policy test includes lookup, order checks, canonical claim/digest, durable reservation and signature verification; it does not claim an authenticated bank payment or chain settlement.

Root `npm run setup:integration` installs the package; `npm run test:all` runs its tests and protocol-sync check. If root Prettier scans this package, exclude the byte-identical `policy/vendor/escrow-protocol.mjs` and `policy/test/fixtures/protocol-vectors.json` snapshots. The package's own `.prettierignore` covers them for package-local formatting.
