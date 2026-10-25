# Pactlane

The local live stack supports explicit testnet/mainnet configuration with submission disabled by default. See [network support and operator requirements](docs/release/mainnet-support.md). This is implementation capability, not a deployed mainnet exchange or accepted payment proof.

Buy USDC on Stellar with a payment from the bank app you already use.

I’m building a small version of [ZKP2P](https://www.zkp2p.xyz/) for Stellar. A seller locks USDC in escrow, a buyer pays them in Revolut, and a payment-policy signature lets the escrow release once. The first version focuses on one EUR payment rail and one whole offer.

**Current stage: integrated local prototype.** The buyer/seller demo, payment-policy package and escrow using Stellar Smart Contracts are implemented. A local rehearsal connects the app’s order model to the real policy signer and compiled escrow WASM, using synthetic payment evidence. A real authenticated payment has not been accepted, and this branch has no testnet deployment or live settlement.

The local presentation candidate adds a buyer/supplier explanation, explicit illustrative pricing, exact-amount summaries, mobile navigation and a desktop/disclosure guide. See the [presentation reconciliation](docs/ui/handoff.md#presentation-reconciliation-25-october-2026) for provenance and the checks run on both browser entry points.

## Try the demo

```sh
npm ci --ignore-scripts
npm run dev:app
```

Open the address printed by the server on that machine. Create Ben’s 22 USDC offer, approve its demo deposit, switch to Ana, reserve it, and confirm the payment lock. Only then do the €20 Revolut instructions appear. Demo settings let you try unavailable or mismatched verification. Every wallet, payment and receipt in this app is simulated.

The server binds to loopback. A Mac-mini loopback address is not a preview link for another device. No public Pactlane app URL is established by this branch.

## Live-service implementation

`npm run dev:live` serves a separate live browser and host after integration dependencies are prepared. It starts unconfigured, with no wallet or transaction action enabled. The host/client implementation includes authenticated Freighter sessions, confirmed chain views, durable transaction recovery, mutual authorization and reconciled receipts. See [the live service handoff](docs/release/live-services.md) for configuration and current evidence.

Local browser checks use fixture signatures and mocked chain services. A real payment, approved deployment and reachable hosted app remain unverified. New payment locks remain disabled while payment verification is unavailable. This entry point does not turn the synthetic demo into a live trade.

## The trade

1. The seller funds one fixed whole offer.
2. The buyer reserves it, then confirms `begin_payment` before seeing payment instructions.
3. The buyer pays the exact EUR amount in Revolut.
4. TLSNotary supplies authenticated evidence to an operator-run payment-policy service.
5. The policy checks source, recipient, amount, completed outgoing state, time and unused payment identity, then signs the canonical claim.
6. The escrow checks the signature and order/domain bounds, consumes the payment nullifier and releases the tokens atomically.

If proof is unavailable after the lock, funds stay held. A later valid proof may release them. Both wallets can instead agree to a release, refund or split. There is no unilateral timeout refund after the lock; an uncooperative party can leave funds locked.

Steps 1–6 work together in the **local synthetic rehearsal**. The browser demo is separate. Its callbacks cannot reach a live signer or authorize a network transaction.

## Check the integration

Node.js 22.13 or later is required; this checkout was checked with Node 26.7.0.

```sh
npm run setup:integration
npm run test:all
npm run check
npm run format:check
# With the compatible Rust/Cargo toolchain available:
npm run rehearse:local
npm run build:demo
```

`test:all` checks source, app, policy, shared protocol and wallet/RPC boundaries. The Rust rehearsal executes the committed compiled WASM with a synthetic token and payment, not Stellar testnet. See [integration setup](integration/README.md).

## Read next

| Document                                         | What it covers                                                |
| ------------------------------------------------ | ------------------------------------------------------------- |
| [Concept](docs/concept.md)                       | Who this is for and why Revolut comes first                   |
| [Architecture](docs/architecture.md)             | Trust, signing, identities and recovery                       |
| [Status](docs/status.md)                         | Observed results and live gaps                                |
| [Setup](docs/setup.md)                           | Local demo, checks and older private proof tooling            |
| [Build plan](docs/build-plan.md)                 | Remaining work and completion checks                          |
| [Pitch](docs/pitch.md)                           | Short pitch and honest demo outline                           |
| [Verification](docs/verification.md)             | Checks actually run                                           |
| [Handoff](docs/handoff.md)                       | Branch, components, blockers and next action                  |
| [Submission](docs/release/submission-package.md) | Prepared media, evidence scope and remaining submission gates |

## Code map

```text
app/                 Separate synthetic demo, live browser and Freighter client
contracts/escrow/    Soroban escrow, canonical protocol, vectors and reviewed WASM
policy/              Server evidence rules, signer boundary and SQLite replay registry
integration/         Local WASM rehearsal, authenticated host and wallet/RPC services
tlsn/                Earlier private proof launcher and bank-free diagnostics
deploy/              Static/demo and testnet handoff instructions
evidence/            Sanitized results; no bank values or raw proofs
archive/reclaim/     Retired signature experiment, outside the active path
```

The contract trusts a configured payment-policy signer. It does not verify a raw TLS transcript. The operator sees disclosed fields; Revolut sees its payment; Stellar settlement remains public. See [the trust model](docs/architecture.md#trust-model).

This private repo records the preparation spike and hackathon implementation without rewriting their history. Keep credentials, bank identifiers, raw proofs and private runtime logs outside Git.
