# Freighter connector and mainnet readiness

Desktop and mobile connectors use the same deployment-bound wallet interface. [Host composition](live-services.md) and [network configuration](mainnet-support.md) describe how it joins the exchange.

## What is implemented

The connected app now passes a wallet transport adapter into the existing host client. Desktop uses pinned Freighter API 6.0.1. Mobile uses pinned WalletConnect UniversalProvider 2.26.0, with a locally bundled QR encoder and no remote executable script. The mobile-first picker pairs Freighter by QR from another device or by copying the URI into Freighter's scanner on the same phone. No unverified custom deep link is invented.

The adapter requests exactly the methods Pactlane needs: `stellar_signMessage` (SEP-53 login), `stellar_signXDR` (sign-only transaction) and `stellar_signAuthEntry` (seller recovery authorization). It never requests or calls wallet-side transaction submission. It verifies approved methods, one exact chain/account, expiry and signer identity. Account/network/session changes discard results. Cancelled pairing settles immediately; a later approval is disconnected and cannot invalidate a later connection or become an authenticated trade. Generic mobile refusal is not converted into the desktop SDK's narrow definite-refusal result, preserving unknown-outcome journal behavior.

`/wallet` is a connection-only setup page: select mainnet or testnet and check the public address/network. It does not authenticate to the host, sign messages, send transactions or enable mainnet trading. The exchange selects its network from the validated host deployment; the setup page cannot change that identity.

## Configuration and operation

The supplied WalletConnect project ID was used through an ignored local `.env.wallet`, not committed. Reproduce with the sanitized `.env.wallet.example` and the actual public project ID. A project ID identifies the app on the relay; it is public client configuration, not a wallet key. Confirm the project's origin allowlist in the dashboard for the final HTTPS app origin.

Install pinned dependencies using the existing `node scripts/setup-integration.mjs`, then start:

```sh
node --env-file=.env.wallet scripts/serve-live-app.mjs
```

`PACTLANE_PUBLIC_ORIGIN` and `PACTLANE_WALLETCONNECT_APP_URL` must match exactly; HTTPS is required except for loopback. Metadata cannot point to another site. Only public `enabled`, `projectId` and `appUrl` are exposed by `/wallet-config.json`. No arbitrary configuration files or private host values are served. Omitting the project ID disables mobile connection and retains the default same-origin CSP. The local vendor bundle is generated in memory from locked installed packages, including a pinned runtime bundler; production installs must include those dependencies.

The Node host serves the setup page and its explicit asset/configuration routes. Demo mode keeps all connections blocked, including mobile relays. See [the mainnet runbook](mainnet-test.md) for the approved deployment and trade configuration.

## Verification

New regressions cover mainnet/testnet wallet transport, all three signing response shapes, unsupported methods, ambiguous accounts, network/account mismatch, stale signing results, malformed signatures, UTF-8 message bounds, cancellation and late approvals. A real loopback HTTP bridge test verifies a real SEP-53 fixture signature through the new mobile adapter; the mainnet connector cannot authenticate to the testnet host and causes no mutation. This uses disposable fixture keys, not an owner wallet.

The original connector checks included responsive layouts and real relay pairing/cancellation without wallet approval. Current combined checks are recorded in [verification](../verification.md); physical-device signing remains part of the configured trade run.

## Primary integration references

- [Freighter developer overview](https://github.com/stellar/freighter-developer-docs): separate extension/mobile integration paths.
- [Mobile connection](https://github.com/stellar/freighter-developer-docs/blob/main/mobile/connecting.md): approved Stellar namespace and capabilities must be checked.
- [Mobile signing](https://github.com/stellar/freighter-developer-docs/blob/main/mobile/signing.md): exact message, transaction and authorization response fields.
- [Freighter mobile connection guide](https://help.freighter.app/article/y848tzczm2-how-do-i-connect-to-dapps): QR and same-phone URI-paste flow.
