# Explicit network support

The live host supports Stellar testnet and explicit mainnet configuration. Testnet is the default; mainnet requires `network: 'mainnet'`. Unknown names or inconsistent passphrases fail. Submission defaults off; mainnet requires both `allowMainnetSubmission: true` and the host's `submissionEnabled: true`, with the reviewed deployment and trade configuration.

## Implemented boundary

One validated deployment pins network/passphrase, HTTPS RPC, escrow contract and WASM hash, exact token/SAC asset, seven decimals, policy public key, maximum fee and supported protocol. Wallet challenges and sessions include the deployment identity (network, escrow and token). Browser and host check it before wallet prompts and after signing. Transactions, policy claims, both recovery signatures, receipts, journals and catalog state use the same identity. A configured RPC is trusted for chain data; these checks are not an independent consensus proof.

Issued assets require their exact code and issuer. The SDK derives the network-specific Stellar Asset Contract address and compares it with the configured token. Chain reads verify the SAC executable and escrow code/configuration; transaction preflight checks token decimals. Receiving readiness reads the account and exact trustline, requires full authorization, and checks `limit - balance - buying liabilities` using integer atoms. It never creates a trustline or funds an account. Issuer accounts are deliberately unsupported as counterparties. Fresh simulation remains required and readiness can change after a read.

Receiving checks apply before new issued-asset reservations, releases and agreed recovery signatures and before the lower-level payment-instruction reader. Existing journaled outcomes reconcile before mutable receiving-capacity checks. Unknown signing/submission outcomes remain blocked across restart; no automatic retry is introduced. Historical testnet custom-token configuration remains available for local fixtures, but cannot yield fiat instructions without explicit asset identity.

The complete-record normalizer now accepts authenticated records from the trusted verifier store. The host keeps new payment locks and instructions disabled until the durable live policy composition is connected. Network selection cannot enable proof acceptance. See [the current runbook](mainnet-test.md).

## Required operator inputs

Use [the operator module](../../integration/operator.example.mjs) and [environment example](../../.env.live.example). All example deployment values are empty. No mainnet endpoint, deployment address or signing key is invented.

| Input                                 | Required evidence or constraint                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network                               | `testnet` or explicit `mainnet`; exact corresponding official passphrase                                                                                                      |
| RPC URL                               | Operator-selected HTTPS provider; no embedded credentials/query; matching `getNetwork` passphrase and ledger protocol                                                         |
| Escrow contract and deployment ledger | Confirmed deployment receipt on that network, with the reviewed WASM hash                                                                                                     |
| Token contract, asset code and issuer | Exact intended asset; derived SAC address must match; seven decimals verified on chain                                                                                        |
| Policy public key                     | Operator-controlled Ed25519 public key; shipped fixture keys rejected; no private key supplied by the example                                                                 |
| Maximum fee                           | Explicit integer stroop cap, including prepared transaction resource fees; no automatic mainnet cap chosen                                                                    |
| Private storage directory             | Absolute, deployment-specific path; `deployment.json` binds network/asset/code/policy/replay-store path                                                                       |
| Shared replay-store path              | Absolute path to the **same physical database** across networks/deployments and signer rotations for the same payment authority; required for mainnet or any live `policyFor` |
| Approved orders and offers            | Trusted operator composition; no public client can supply a deployment or private recipient binding                                                                           |
| Submission permissions                | Both flags off by default; mainnet needs both explicit flags plus separate execution authorization                                                                            |

Global payment nullifiers and manual-recovery holds remain global within the shared payment authority store; domain checkpoints stay network/contract-bound. A new deployment must not get a fresh evidence database. A reused deployment directory with a different identity/path fails. Legacy directories without the identity record, and legacy transaction keys lacking network/asset, fail closed for explicit migration review: preserve their unknown outcomes and backups. No automatic migration or deletion is performed here.

## Compatibility and current sources

Checked 25 October 2026: official mainnet Horizon metadata and testnet RPC report ledger protocol **29**, even though node binaries may support protocol 30. This repository pins Stellar SDK 17.1.0, so it accepts ledger protocol 29 only and fails on future versions. The official Protocol 30 guide calls for an SDK/XDR upgrade; widening support requires a separately reviewed compatibility change. Sources: [mainnet metadata](https://horizon.stellar.org), [RPC getNetwork](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getNetwork), [Protocol 30 guide](https://stellar.org/blog/developers/bell-protocol-30-upgrade-guide).

No SDF mainnet RPC endpoint is assumed. Verify provider access and the asset issuer with primary sources: [Stellar deployment guidance](https://developers.stellar.org/docs/build/smart-contracts/getting-started/deploy-increment-contract#run-your-own-networknode), [SAC identity](https://developers.stellar.org/docs/tokens/stellar-asset-contract), [trustlines and liabilities](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#trustlines), [authorization flags](https://developers.stellar.org/docs/tokens/control-asset-access), [Circle's current USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), [Freighter signing](https://docs.freighter.app/extension-freighter-api/signing.md). A symbol alone does not identify USDC.

## Validation

Network checks exercise both networks with disposable identities, SDK signatures/XDR, loopback HTTP and SQLite restart paths. [Dated network evidence](../../evidence/release/network-support-checks.json). [Current verification](../verification.md) records the integrated suite and chain receipts.

Use the [mainnet runbook](mainnet-test.md) for the approved small trade. Preserve unknown transactions and replay history when changing configuration.
