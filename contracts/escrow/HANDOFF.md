# Contract work handoff

- Objective: deliver Pactlane's first whole-offer EUR/Revolut Stellar escrow and a frozen canonical protocol shared with the JS payment-policy signer.
- Execution host: Mac mini, macOS Apple Silicon, 25 October 2026.
- Repository: private `vmichalik/stellar-p2p`.
- Worktree: `/Users/vijay/Documents/workspace-personal-projects/pactlane-escrow`.
- Branch: `pactlane-escrow`; baseline `807412686da2cdad494ee284675dbefc35110257`; frozen implementation commit **`5be4b168102a53160a3d7423b98d3627f25e806a`** (`Build Pactlane escrow and freeze cross-language protocol v1`). This handoff is a subsequent documentation-only commit. Neither commit was pushed by this thread.
- Local changes: implementation is committed, scoped entirely to `contracts/escrow/`. The main checkout's unrelated proof documents/evidence were preserved. Root package/scripts are unchanged; integration owns any root command additions. Ignored `target/` and `protocol/node_modules/` contain only local build/dependency output.
- Artifacts: Rust source/tests, locks, generated `interface.json`, integration README, `PROTOCOL.md`, strict JS reference encoder/two public synthetic vectors, and tracked optimized `artifacts/pactlane_escrow.wasm` with `artifacts/deployment-candidate.json`.
- Current checks: **29 native contract tests**, the same **29 compiled-WASM tests**, **11 JS protocol tests**, and syntax checks for **21 modules/inline scripts** all passed. Optimized build passed (13,326 bytes; SHA-256 `8940569853b21a957fc5a81402666e95ed75f054ce2223926231ffc2c0c506dd`). Diff/whitespace review and deployment-candidate hashes passed. The unchanged 32 TLSNotary JS tests passed during earlier baseline work and were not re-run for this protocol-only update.
- Tooling limitation: `cargo fmt` could not run because rustfmt is absent from the existing toolchain. No component was installed. Source was reviewed manually.
- Isolation note: this is a normal Git worktree. The app attachment tool rejected attachment because it is not an app-managed worktree; filesystem/Git isolation succeeded.
- Recovery policy approved by Vijay on 25 October 2026: if payment proof is unavailable after `begin_payment`, hold funds until both parties authorize settlement. A later valid payment-policy signature can still release the order. There is no automatic refund or arbitrator. An uncooperative party can keep funds locked. The implementation already matches this choice; recording approval changed documentation only.
- Evidence boundary: all settlement tests use synthetic payments and a synthetic token. No bank request, authenticated payment proof, real USDC settlement, testnet transaction, deployment, signer/account change, push or publication was performed here. Local settlement tests do not clear the TLSNotary payment-proof gate.
- Next action: integration cherry-picks the frozen source snapshot; policy re-syncs to the exact encoder/package/vector hashes and verifies its evidence/replay/recovery checks. The app must confirm `begin_payment` before fiat instructions. Configure and verify testnet prerequisites separately, then record actual deployment/transaction/balance evidence.

## Frozen protocol pin

Version: **`pactlane.protocol.v1`**. Pin the implementation commit and scoped package lock with these exact hashes:

- `protocol/protocol.mjs`: `08e73cbd4d2507ef85c62317638a4d4fcefd922d9de1ba3822793450cbd2127e`.
- `protocol/vectors.json`: `354e82ac989709a518b150506ec7424601e7a6ed8d63e20e3825ef7e026e3dcb`.
- `interface.json`: `c451882cfec7d323d48949225c1773e0d3eeb827c879fad40679d5b8457189b6`.
- Official JS Stellar SDK: exactly `17.1.0`; Node >=22.12.0, checked here with Node 26.7.0.

The final encoder includes integer-string length/range checks and normalizes SDK `Uint8Array` results to Node `Buffer`. Older vendored copies must be re-synced. No further interface/protocol change is planned without a concrete defect and a new explicit snapshot.

`PROTOCOL.md` specifies exact ScVal-XDR domains, field ordering/types, source identity requirements, cross-deployment consumption and manual-resolution reconciliation. Recipient commitments bind stable recipient ID plus offer salt. Nullifiers bind the fixed source namespace, verified payer scope and stable transfer ID, independently of order/network/deployment. The on-chain `PaymentClaim` interface remains unchanged.

Source identity authority: observed recipient/account/payment IDs must come from verified provider evidence or an independently authenticated verifier/account binding. Expected recipient ID/salt come from authenticated seller configuration and must hash to immutable `Terms.recipient`; the observed recipient must independently match. Current on-chain orders supply trade terms. The TLS shape/semantics check has not established required identities. Missing verified identity rejects live signing; client labels and expected order values are never substitutes.

Both frozen vectors are public and synthetic: EUR 20 / 22 USDC whole-offer settlement, plus encoding-only G-addresses and `u64::MAX`/`i128::MAX` values above JS's safe-number range. The published test signing seed must never be used as a deployment signer.

## Compatibility evidence

Commands actually run for this snapshot:

```sh
cargo test --locked --offline --manifest-path contracts/escrow/Cargo.toml
stellar contract build --locked --manifest-path contracts/escrow/Cargo.toml
PACTLANE_ESCROW_WASM=... cargo test --locked --offline --manifest-path contracts/escrow/Cargo.toml
npm --prefix contracts/escrow/protocol test
npm run check
```

The frozen JS signature was submitted unchanged to actual escrow `release`, producing exactly 220,000,000 base units for the buyer, with no second transfer on replay. Both native and compiled-WASM tests pass with default host limits. Fixture registration explicitly uses the same deployment address in both modes: automatic registration chose different IDs and correctly failed domain checking during the first attempt. The vectors/protocol were not changed to correct that test-harness difference.

Rust 1.99.1, Stellar CLI 28.1.0 and SDK 29.0.1 were reused. The pinned JS SDK was installed only in the scoped worktree with lifecycle scripts disabled; no global package/component changes were made.

## Deployment candidate and blockers

Tracked binary: `artifacts/pactlane_escrow.wasm`, byte-identical to the optimized WASM tested above. `stellar contract info env-meta` reports **Protocol v29**. `artifacts/deployment-candidate.json` contains exact artifact/network/protocol hashes and unresolved constructor configuration.

Constructor argument order is `token: Address`, `signer: BytesN<32>` (raw trusted policy Ed25519 public-key bytes). Real token/signer values remain unconfigured, as do the source account and deployed contract ID. Network is Stellar testnet, passphrase `Test SDF Network ; September 2015`, network ID `cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472`.

Before a separately authorized deployment, provide an approved testnet USDC address/checked decimals, trusted policy public key, existing authorized account/fee budget and reachable RPC, and verify the live network supports this artifact's v29 environment. Public Horizon access failed from the restricted network, so current testnet protocol compatibility remains unverified. This workstream creates no account/signing/deployment authorization.

Live integration also requires verified stable identities/units, durable cross-deployment nullifier issuance/consumption, and reconciliation of manually resolved payments. Policy owns that implementation. Whole-offer fills remain fixed; splits are only recovery approved by both wallets.

## Implementation file manifest

All paths below are relative to `contracts/escrow/` in implementation commit `5be4b168102a53160a3d7423b98d3627f25e806a`. This handoff is added separately.

```text
Cargo.lock
Cargo.toml
PROTOCOL.md
README.md
artifacts/deployment-candidate.json
artifacts/pactlane_escrow.wasm
interface.json
protocol/generate-vectors.mjs
protocol/package-lock.json
protocol/package.json
protocol/protocol.mjs
protocol/protocol.test.mjs
protocol/vectors.json
src/lib.rs
src/test.rs
```
