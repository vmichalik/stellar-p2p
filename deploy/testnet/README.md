# Testnet deployment candidate

This is the release checklist for a future Pactlane testnet deployment. No contract, asset or wallet is provisioned by these instructions.

Before execution, record the accepted integration commit, optimized escrow WASM hash, testnet network passphrase and RPC, configured token contract and decimals, public policy-signing key, and the existing authorized deployer account. Keep private keys outside Git and use the approved wallet or CLI credential mechanism.

## Required checks

1. Rebuild the imported escrow snapshot with the supported Stellar CLI and run the same suite against native Rust and the optimized WASM.
2. Reproduce the shared JS/Rust claim and identity vectors using the imported payment-policy package.
3. Confirm the app accepts a whole offer and waits for confirmed `begin_payment` before displaying payment instructions.
4. Use the explicitly synthetic test signer only in a synthetic rehearsal. A live policy signer must reject browser callbacks and unverified bank evidence.
5. Confirm the intended test asset with the owner. Do not describe a custom test token as issuer-backed USDC.
6. Establish the existing authorization for deployment, account funding, signing and testnet transaction submission. A deployment-ready artifact alone does not grant it.

## Transaction evidence to capture when authorized

Use one funded whole offer and record exact contract/order IDs and transaction hashes for funding, reservation, payment lock and release. Reconcile buyer, seller and escrow token balances. Submit the same payment claim again and confirm no second token transfer. Exercise a separate held order to demonstrate mutual consent recovery; do not reuse the released order for that scenario.

Keep synthetic settlement separate from an authenticated payment proof. Testnet transactions prove the contract integration performed, while acceptance of a real transfer requires independent verifier and policy evidence. Record both boundaries explicitly in the final handoff.

## Current blockers

Escrow, policy and app snapshots are integrated. The actual app-model → policy → compiled-WASM local rehearsal passes with synthetic payment evidence. The Node wallet/RPC candidate is tested with mocked wallet/RPC and a real disk journal. The Node browser bridge, chain reader/indexer and mutual-recovery collector are implemented locally. Host composition, private policy/offer ports and browser/counterparty wiring remain software gaps; see `integration/README.md`.

A read-only call to `https://soroban-testnet.stellar.org` at 13:03 UTC on 25 October 2026 returned protocol 29 and the expected testnet passphrase; latest ledger was 5,381,965. This matches the artifact's required protocol. It is not deployment or transaction evidence.

No testnet deployment, submitted transaction, configured live signer, approved asset or confirmed live token balance is established by this branch. Configure those only under the owner's specific authorization. Public fixture signing keys are forbidden for live policy and the RPC candidate.
