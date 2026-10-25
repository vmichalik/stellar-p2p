# Pactlane

Pactlane explores direct EUR-to-USDC trades between two people who already have a bank account and a Stellar wallet. I started from a simple question: “I’ve sent the euros. What has to happen before I get my USDC?” The prototype makes the offer, payment lock, evidence decision, release, and recovery visible. The first audience and expected benefits remain hypotheses, not validated demand or measured savings.

The public app at [pactlane.io](https://pactlane.io) is a synthetic demo. Its 25 October audit observed source revision `88ba889` and manifest SHA-256 `57976a8918229887b98629139bf2f94ed729bad6acf2181b3f51b8fd886ebebe`; this local work did not change it. This private checkout also contains a separate host and browser workbench, policy references, and wallet/RPC recovery path.

**Evidence boundary:** a disposable Stellar testnet rehearsal passed release, replay rejection, and mutual recovery on 25 October 2026 using the reviewed WASM, a synthetic PLTEST token, and programmatic disposable keys. It did not use USDC, Freighter UI, or accepted bank evidence. The live payment gate remains `NOT_CLEARED`. See the [captured rehearsal](evidence/release/testnet-rehearsal-2026-10-25.json) and [current status](docs/status.md).

## Read the architecture

Start with the [standalone illustrated study](docs/architecture/study.html), which works offline and includes the system map, state machine, privacy boundaries, recovery flow, talk tracks, and judge questions. The [editable architecture handbook](docs/architecture/index.md) links to focused guides on the [escrow](docs/architecture/escrow-contract.md), [policy and replay protection](docs/architecture/policy-and-claims.md), [TLSNotary evidence](docs/architecture/tlsnotary-evidence.md), [privacy](docs/architecture/privacy-and-data.md), and [operations](docs/architecture/operations-and-readiness.md).

## Try the public synthetic demo

Open [pactlane.io](https://pactlane.io), create Ben’s 22 USDC offer, approve its demo deposit, switch to Ana, reserve it, and confirm the payment lock. Only then do the €20 Revolut instructions appear. Demo controls let you simulate unavailable or mismatched verification. Wallets, payments, and receipts in this public app are simulated; it does not connect to the host services described below.

The fixed example uses `fiat_minor = 2000` (EUR cents) and `token_amount = 220000000` (seven-decimal token atoms). Those are synthetic example terms, not a quote or real payment.

## Current implementation

The repo contains a Soroban escrow, frozen canonical claim protocol, operator-run payment policy, durable replay and transaction journals, local compiled-WASM rehearsal, and a testnet-only Node host and browser workbench. The host can read configured chain state, verify a deployment against the reviewed WASM, expose wallet requests to Freighter, and collect both parties’ authorization for contract recovery. Payment validation still fails closed: the live TLSNotary normalizer throws `TLSN_PAYMENT_SCHEMA_UNVERIFIED` until accepted source semantics and identities are established.

The testnet evidence is a synthetic systems rehearsal, not an authenticated payment-to-USDC result. Pactlane is not trustless or anonymous, and the contract does not verify a TLSNotary transcript. Revolut sees its customer and payment; the counterparty sees payment details; Stellar addresses and token movements are public; the policy operator sees evidence fields and controls a signing key.

## Local checks

Node.js 22.13 or later is required.

```sh
npm ci --ignore-scripts
npm run setup:integration
npm run test:all
npm run check
npm run format:check
npm run rehearse:local
```

For the host and browser workbench setup, see [integration/README](integration/README.md). The [verification record](docs/verification.md) names checks actually run; the [build plan](docs/build-plan.md) describes the remaining evidence needed. These commands do not publish the app or configure production services.

## Code map

```text
app/                 Public synthetic browser app and adapter interface
contracts/escrow/    Soroban escrow, canonical protocol, vectors and reviewed WASM
policy/              Evidence rules, signer boundary and SQLite replay registry
integration/         Local rehearsal, testnet host, browser client, wallet/RPC adapter
tlsn/                Proof tooling and source-pinned verifier preparation
deploy/              Static demo and testnet instructions
evidence/            Sanitized records; no bank values or raw proofs
```

Private keys, bank identifiers, raw proofs, and private runtime logs stay outside Git. Do not describe the synthetic app or PLTEST rehearsal as a real bank transfer, USDC settlement, or production service.

## Read next

- [Status](docs/status.md) — implemented, checked, testnet-observed, and unproven
- [Build plan](docs/build-plan.md) — remaining work and acceptance conditions
- [Architecture](docs/architecture.md) — concise system and trust model
- [Handoff](docs/handoff.md) — execution environment and resume steps
- [Verification](docs/verification.md) — check provenance and limits
