# Stellar P2P

Buy USDC on Stellar with a payment from the bank app you already use.

I’m building a small version of [ZKP2P](https://www.zkp2p.xyz/) for Stellar. A seller locks USDC in escrow, the buyer pays them in Revolut, and a proof of that payment unlocks the USDC. The first version focuses on one payment rail and one complete trade.

**Current stage: proof prototype.** The browser extension and private verifier have completed a proof of a public Revolut response. An authenticated transfer proof is still unresolved. Escrow, the payment-policy service and the TLSNotary-to-Soroban claim adapter are next; no funds have been released.

## The trade we want to show

1. A seller offers USDC and locks it in a Soroban escrow.
2. A buyer reserves the offer and sees the exact EUR amount and recipient.
3. The buyer sends that payment in Revolut.
4. TLSNotary proves the relevant parts of Revolut’s response.
5. A verifier checks the payment against the order and signs a short claim.
6. The escrow checks the signer, expiry and payment nullifier, then releases USDC once.

Steps 1–3 and 5–6 describe the intended product. The code here is the proof tooling for step 4, plus an archived Soroban signature experiment.

## Start here

```sh
npm test
npm run check
```

These checks use synthetic inputs and need Node.js 22 or later. They do not need a bank login, extension or running verifier. No npm dependencies are required for the active test suite.

To run the browser prototype, follow [setup](docs/setup.md). It needs the pinned TLSNotary extension, a local verifier and a private HTTPS route reachable from the browser device.

| Read                                 | What’s in it                                         |
| ------------------------------------ | ---------------------------------------------------- |
| [Concept](docs/concept.md)           | User, problem, scope and why Revolut comes first     |
| [Architecture](docs/architecture.md) | Proof flow, trust model and proposed claim           |
| [Status](docs/status.md)             | What was observed, what failed and what remains open |
| [Build plan](docs/build-plan.md)     | The next work, in order, with completion checks      |
| [Pitch and demo](docs/pitch.md)      | Plain-language pitch and a demo outline              |
| [Hackathon notes](docs/hackathon.md) | Submission checklist and questions for mentors       |
| [Handoff](docs/handoff.md)           | Where to resume and how to verify the checkout       |

## Code map

```text
tlsn/                Browser launcher, payment plugin and public diagnostics
scripts/             Pinned runtime preparation and source checks
evidence/            Sanitized record of earlier checks
archive/reclaim/     Earlier signature adapter and Soroban experiment
```

The active path uses TLSNotary MPC-TLS. The planned contract would trust the configured verifier’s signing key; full TLS transcript verification stays off chain. A browser callback alone cannot authorize a release. See the [trust model](docs/architecture.md#trust-model).

Private proofs, bank identifiers, credentials, logs and downloaded tooling are excluded. This repo is a development handoff; the preparation spike predates the hackathon build. Keep that distinction in the submission.
