# Freighter connector and mainnet readiness

Built on the Mac mini in `/private/tmp/pactlane-wallet-readiness-20261025`, branch `codex/pactlane-wallet-readiness`, from the reviewed `0361bc4275e4c1d9d395c05c6261e83de338fcc7` candidate. The completion message supplies this lane's new revision. The original UI worktree and coordinator candidate are preserved. No publication, DNS change, deployment, bank login, wallet approval or fund movement was performed.

## What is implemented

The connected app now passes a wallet transport adapter into the existing host client. Desktop uses pinned Freighter API 6.0.1. Mobile uses pinned WalletConnect UniversalProvider 2.26.0, with a locally bundled QR encoder and no remote executable script. The mobile-first picker pairs Freighter by QR from another device or by copying the URI into Freighter's scanner on the same phone. No unverified custom deep link is invented.

The adapter requests exactly the methods Pactlane needs: `stellar_signMessage` (SEP-53 login), `stellar_signXDR` (sign-only transaction) and `stellar_signAuthEntry` (seller recovery authorization). It never requests or calls wallet-side transaction submission. It verifies approved methods, one exact chain/account, expiry and signer identity. Account/network/session changes discard results. Cancelled pairing settles immediately; a later approval is disconnected and cannot invalidate a later connection or become an authenticated trade. Generic mobile refusal is not converted into the desktop SDK's narrow definite-refusal result, preserving unknown-outcome journal behavior.

`/wallet` is a connection-only setup page: select mainnet or testnet and check the public address/network. It does not authenticate to the host, sign messages, send transactions or enable mainnet trading. The exchange itself stays testnet-bound. The existing host client, live-view adapter, host runtime, transaction journal, payment policy, recovery broker, contracts and demo model are unchanged. The live server only gains explicit static/config/vendor routes and an opt-in relay CSP.

## Configuration and operation

The supplied WalletConnect project ID was used through an ignored local `.env.wallet`, not committed. Reproduce with the sanitized `.env.wallet.example` and the actual public project ID. A project ID identifies the app on the relay; it is public client configuration, not a wallet key. Confirm the project's origin allowlist in the dashboard for the final HTTPS app origin.

Install pinned dependencies using the existing `node scripts/setup-integration.mjs`, then start:

```sh
node --env-file=.env.wallet scripts/serve-live-app.mjs
```

`PACTLANE_PUBLIC_ORIGIN` and `PACTLANE_WALLETCONNECT_APP_URL` must match exactly; HTTPS is required except for loopback. Metadata cannot point to another site. Only public `enabled`, `projectId` and `appUrl` are exposed by `/wallet-config.json`. No arbitrary configuration files or private host values are served. Omitting the project ID disables mobile connection and retains the default same-origin CSP. The local vendor bundle is generated in memory from locked installed packages, including a pinned runtime bundler; production installs must include those dependencies.

The local preview is a Mac-mini QA endpoint, not a remotely usable handoff. The reviewed deployment must route `/wallet`, `/wallet-config.json`, the new source modules and the explicitly allowed vendor bundle through the Node live server. The old synthetic static demo package alone cannot host this connected-wallet flow. Do not widen the demo build allowlist or copy wallet transport into it accidentally.

## Actual mainnet blockers

**The app is not ready to trade real funds on mainnet.** This change prepares wallet transport; it does not bypass or relabel the following blockers:

1. Browser/host/view/chain/recovery services remain explicitly pinned to testnet. Mainnet service support requires a separately reviewed change across those domain checks, not a browser toggle or search-and-replace of network strings.
2. No approved and independently verified mainnet escrow/token/RPC/policy-signer configuration, deployed artifact identity or deployment ledger is supplied.
3. Authenticated Revolut payment acceptance/normalization is unresolved. The existing runtime continues refusing new payment locks. Wallet connectivity cannot clear that gate.
4. Manual-payment reconciliation and deployment/private-policy composition remain unfinished. Real wallet, recovery and transaction/receipt validation must be completed against the exact approved deployment.
5. No reachable hosted wallet preview or physical Freighter Mobile/Desktop approval/signature check was completed by this lane. The connection-only page must not be presented as a verified trade or mainnet certification.

## Verification

New regressions cover mainnet/testnet wallet transport, all three signing response shapes, unsupported methods, ambiguous accounts, network/account mismatch, stale signing results, malformed signatures, UTF-8 message bounds, cancellation and late approvals. A real loopback HTTP bridge test verifies a real SEP-53 fixture signature through the new mobile adapter; the mainnet connector cannot authenticate to the testnet host and causes no mutation. This uses disposable fixture keys, not an owner wallet.

Final checks: **167 app/integration tests passed**, zero failures/skips; **98 module/inline syntax checks passed**; scoped formatting and `git diff --check` passed. Responsive review covered the wallet page/picker at 390px and 1440px and the exchange entry at 320px, with no horizontal overflow or browser warning/error logs. Screenshots are in `docs/ui/screenshots/wallet/` (setup phone, picker phone, setup desktop). The initial sandbox-only HTTP tests were blocked by `listen EPERM`; the approved loopback run passed. No guard was changed to make it pass.

Browser QA used the actual bundled provider and supplied project ID. A real relay pairing URI and local QR image were produced. No mobile wallet was approved; no pairing URI/QR secret was logged or saved in this handoff. Pairing cancellation and focus/control restoration were checked, including cancellation during initialization. Desktop/mobile layouts and the connected app's wallet-setup entry were inspected. The browser had no installed Freighter extension, so actual desktop account permission/signing remains an owner-device check. An exploratory WalletGuide lookup returned HTTP403; this did not prevent the separate relay pairing from working, and no unsupported deep link was added.

## Primary integration references

- [Freighter developer overview](https://github.com/stellar/freighter-developer-docs): separate extension/mobile integration paths.
- [Mobile connection](https://github.com/stellar/freighter-developer-docs/blob/main/mobile/connecting.md): approved Stellar namespace and capabilities must be checked.
- [Mobile signing](https://github.com/stellar/freighter-developer-docs/blob/main/mobile/signing.md): exact message, transaction and authorization response fields.
- [Freighter mobile connection guide](https://help.freighter.app/article/y848tzczm2-how-do-i-connect-to-dapps): QR and same-phone URI-paste flow.

Next action: integrate this scoped connector into the reviewed candidate, configure the approved reachable origin/project allowlist, and have the owner validate desktop and mobile connection plus testnet signing. Keep mainnet trading disabled until all deployment/payment gates above are satisfied. No new publication or real-fund authorization is implied by this source handoff.
