# Pactlane host

`serve.mjs` runs the Node host for the `/testnet/` browser client. It uses an explicit Stellar testnet deployment, a private offer file, one durable policy replay database, and a separate durable transaction journal. The host never stores wallet secrets. Submission stays disabled unless the deployment config explicitly sets `submissionEnabled: true`.

The host starts without a verifier adapter or signing key, so the testnet workbench and wallet/recovery flow can run while live payment validation stays closed. Proof requests return `LIVE_PAYMENT_VALIDATION_PENDING`, policy status returns `NOT_CLEARED`, and release authorization fails closed. A trusted adapter module can be supplied through `PACTLANE_ADAPTERS_MODULE`; its `createHostAdapters()` export can return `verifierReader.readVerifiedRecord`, `proof.launchProof`, `paymentStatus.readStatus`, and an optional `manualResolutionReader.readConfirmedManifest`. Those interfaces must be backed by an accepted live verifier and authorized signer. The adapter cannot provide or override a release authorization; the host issues it through the policy engine. The host does not include a fake or synthetic live adapter.

Deployment JSON fields are `networkPassphrase` (the Stellar testnet passphrase), `rpcUrl` (HTTPS), `contract`, `token`, `tokenDecimals` (7), `policySignerPublicKeyHex`, `maxFeeStroops`, `readerAccount`, `startLedger`, and `deploymentTransactionHash`. The CLI checks the creation transaction and its ledger, then hashes the actual deployed WASM against the reviewed artifact before serving. An unavailable historical transaction stops startup. `submissionEnabled` is optional and defaults to false. The reader account must be an explicit public testnet account; no public fixture signer is accepted.

Each replay database binds to exactly one network/escrow domain. Reusing it for a second deployment fails closed. The replay database is operator-global for the signer, so do not run the same signer against separate unshared stores. Existing unregistered database history is not guessed; it must be reviewed and migrated with verified coverage before this host can use it.

The private offer JSON contains `contract`, `seller`, `recipientId`, `recipientSalt` (64 lowercase hex characters), and `destination` (the private payment instructions object). `orderId` is optional and restricts instructions to an already known offer when set. Otherwise the host checks the configured seller and recipient commitment against each on-chain order before returning the destination. Keep that file and any 64-character raw signing seed in files readable only by the host account (`0600`). The optional policy signing seed must derive the configured public key. Never put bank statements, verifier response payloads, seeds, or tokens in the adapter module or logs.

Run with `PACTLANE_DEPLOYMENT_CONFIG`, `PACTLANE_PRIVATE_OFFER_CONFIG`, `PACTLANE_STATE_DIRECTORY`, and `PACTLANE_ORIGIN` set. `PACTLANE_POLICY_SIGNING_KEY` and `PACTLANE_ADAPTERS_MODULE` are optional; without them the proof gate remains closed. `PACTLANE_BIND_HOST` defaults to `127.0.0.1`; `PACTLANE_BIND_PORT` defaults to `8787`. For an HTTPS origin, place the host behind an authorized TLS reverse proxy that preserves the request Host and Origin. The CLI writes the access link to `access-link.txt` in the private state directory with mode `0600`. The browser reads the fragment into memory and removes it from the address bar. The capability is sent only as a same-origin API header. Do not paste the link into chat or logs.

The API requires a bearer capability and same-origin checks. A capability expires after one hour or when the server closes. GET requests without an `Origin` header require `Sec-Fetch-Site: same-origin` and an exact configured Host. It serves only the fixed testnet browser files and the installed official Freighter API bundle. The wallet bridge expires unclaimed requests after two minutes, stores no wallet key material, and displays no bank payloads.

`POST /api/orders/:id/policy` accepts only an `evidenceId`. The host passes that reference to the trusted policy engine, which fetches and normalizes verifier evidence itself. A successful non-synthetic authorization is checked against the configured domain, order, signer, digest, and signature, then saved in a private durable SQLite store behind an opaque reference. `POST /api/orders/:id/release` accepts that reference; browser-supplied claims, signatures, evidence payloads, and trust flags cannot create an authorization. Evidence jobs and authorizations survive restart and are not automatically cleared.

The indexer starts at the configured deployment ledger, fetches each ledger's complete event pages, places a durable manual hold before advancing past every `Resolved` order, and advances checkpoints only after a full page set was fetched and decoded. Policy snapshots synchronize the indexer before the replay store's reconciliation check. It never auto-clears holds. If a page fails or a cursor is incomplete, the checkpoint stays behind and policy issuance remains blocked.

After a confirmed `Released` receipt, the host looks up the evidence ID from its durable job store and asks the policy engine to reconcile the release. The engine rereads verifier evidence and chain state before marking the payment settled. This path does not clear manual recovery holds; only the policy engine's complete confirmed-manifest workflow can do that.

Run deployment-independent host checks with:

```sh
node --test integration/host/*.test.mjs
```

These checks do not connect to Stellar, load real credentials, submit transactions, or validate an authenticated Revolut payment. The actual TLSNotary Chrome/Revolut proof remains a separate live validation gate.
