# Pactlane

Buy USDC on Stellar with the bank app you already use.

Pactlane connects people who want USDC with people who supply it. The seller sets a price and funds escrow. The buyer pays them through Revolut, then verifies the payment to release the USDC to their Stellar wallet.

[Open Pactlane](https://pactlane.io/) · [Try the demo](https://pactlane.io/?demo=1) · [How it works](docs/architecture.md) · [Chrome extension](https://github.com/vmichalik/pactlane-tlsnotary)

On 26 October 2026, Pactlane completed its first mainnet trade: a buyer paid **€0.89 through Revolut**, verified the transfer with TLSNotary and received **1 USDC** from escrow. [View the Stellar transaction](https://stellar.expert/explorer/public/tx/ec4220af4056b185d242977385484066789824a2a274f57b3439e1e4dd1b9864).

## Why this is useful

Someone who already uses Revolut should have a direct way to fund a Stellar wallet. Pactlane makes the exchange easy to follow: who supplies the USDC, how many euros to pay, when the money is held and what happens next. Suppliers choose their own price and can include a margin for providing liquidity.

The first use case is EUR to Stellar USDC. The longer-term goal is a marketplace where familiar payment apps connect people to the assets and applications they want to use.

## Try one trade

Demo mode uses sample wallets and payments. No installation is needed.

1. Open **Sell USDC**, create Ben’s offer and approve the deposit.
2. Open the buyer view, connect Ana’s wallet and reserve the funded offer.
3. Confirm the payment lock, then review the Revolut payment instructions.
4. Verify the payment and receive the USDC. Open **My trades** for the receipt.

The settings button lets you try a failed payment check and recovery. Offers appear in the marketplace only after funding.

## Why Stellar

Stellar Smart Contracts hold the tokens and enforce the trade’s rules. Freighter handles wallet approvals. TLSNotary authenticates the bank response; Pactlane’s payment service matches it to the locked order and signs a release claim. The contract checks that signature, the order and the payment’s one-use identifier before transferring tokens.

This builds on the proof-based peer-to-peer model pioneered by [ZKP2P](https://github.com/zkp2p), with a Stellar escrow, exact EUR amounts, payment locking and two-wallet recovery.

## Evidence you can inspect

- [Completed mainnet trade](docs/release/mainnet-result.md): the matched Revolut payment, all six Stellar transactions, exact USDC movement and payment replay protection.
- [Authenticated Revolut record](evidence/release/complete-record-accepted.json): a completed outgoing transfer was accepted by the verifier.
- [Stellar testnet rehearsal](evidence/release/testnet-rehearsal-2026-10-25.json): escrow deployment, release, replay rejection and mutual recovery using the PLTEST test asset.
- [Browser flow](evidence/release/demo-mode-browser-2026-10-25.json): funding through receipt, mode separation and mobile navigation.

[Current status](docs/status.md) links the implementation and its verified results.

## Run locally

Use Node.js 22.13 or later.

```sh
npm ci --ignore-scripts
npm run dev:app
```

Open the printed demo URL. For the full server and test suites, follow [setup](docs/setup.md).

## Explore the implementation

| Area                                          | Start here                             |
| --------------------------------------------- | -------------------------------------- |
| Trade flow and trust model                    | [Architecture](docs/architecture.md)   |
| Escrow and exact claim format                 | [Contract](contracts/escrow/README.md) |
| Payment matching and replay protection        | [Policy](policy/README.md)             |
| Wallets, chain reads and transaction recovery | [Integration](integration/README.md)   |
| Judge’s walkthrough and criteria              | [HackMeridian](docs/hackathon.md)      |
| Product direction                             | [Concept](docs/concept.md)             |

The contract trusts Pactlane’s configured payment signer. After the payment lock, a failed check keeps funds in escrow until a valid proof arrives or both wallets agree on recovery. See [payment privacy and recovery](docs/architecture/privacy-and-data.md).
