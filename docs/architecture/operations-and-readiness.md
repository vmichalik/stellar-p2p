# Operating the exchange

The browser is served by `integration/live-server.mjs`; its same-origin API uses authenticated wallet sessions and the host runtime. The host coordinates configured chain readers, private offer data, payment policy and wallet requests.

## Durable state

- The payment registry retains used identities across every deployment served by the signer.
- The transaction journal records preparation, signed transaction identity, submission and confirmation.
- The chain reconciler processes order events and advances checkpoints only after the ledger is fully handled.
- Manual recovery remains held for reconciliation when its payment identity is unknown.

Keep these stores private, durable and backed up. Reconcile unknown submissions by their existing transaction hash; a timeout is not a reason to submit another trade.

## Deployment configuration

Choose the network, RPC, reviewed contract/WASM, token, decimals, policy public key and fee cap. Verify each against the chain before enabling wallet submission. Use the approved wallet and server credential mechanism; public test fixture keys belong only in tests.

For the small mainnet trade, follow [the runbook](../release/mainnet-test.md). The public static site and the proof verifier are separate deployments. [Status](../status.md) records which connections are currently active.

## Useful diagnostics

A public extension proof checks the proof connection. A response check establishes HTTP and JSON shape. Complete-record acceptance establishes an authenticated transfer record. Policy acceptance binds it to the locked order. A chain receipt establishes token movement. Keep those results attached to their respective evidence.
