import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { issuedDeployment } from './test-fixtures/issued-asset.mjs';
import { setTimeout as pause } from 'node:timers/promises';
import {
  Address,
  Keypair,
  SorobanDataBuilder,
  TransactionBuilder,
  hash,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { createHostClient } from '../app/host-client.mjs';
import { createLiveServer } from './live-server.mjs';
import {
  fixture,
  alice,
  bob,
  deployment,
  address,
  amount,
  sym,
} from './test-fixtures/host-runtime.mjs';

// Complete browser transport over actual loopback HTTP; only RPC and Freighter
// are mocked, with disposable keys. This does not submit to any Stellar network.
for (const network of ['testnet', 'mainnet'])
  test(
    `both browser sessions authorize one exact recovery and reconcile the split on ${network}`,
    { timeout: 15_000 },
    async (t) => {
      const f = fixture(t, {
        deployment:
          network === 'mainnet'
            ? { ...issuedDeployment(deployment, 'mainnet'), allowMainnetSubmission: true }
            : deployment,
      });
      const cfg = f.configOptions.deployment;
      const buyerKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x61));
      const sellerKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x62));
      const split = '100000001',
        returned = '119999999';
      const current = f.orders.get('1');
      const buyerPrompt = Promise.withResolvers(),
        allowBuyer = Promise.withResolvers();
      const controller = new AbortController();
      const counts = { sellerSign: 0, buyerSign: 0, methods: [] };
      let reviewed,
        sent,
        buyerApproved = false;
      f.server.getAccountEntry = async (account) =>
        new xdr.AccountEntry({
          accountId: Keypair.fromPublicKey(account).xdrPublicKey(),
          balance: 0n,
          seqNum: 10n,
          numSubEntries: 0,
          inflationDest: null,
          flags: 0,
          homeDomain: '',
          thresholds: Buffer.from([1, 0, 0, 0]),
          signers: [],
          ext: xdr.AccountEntryExt.v0(),
        });
      const readSimulation = f.server.simulateTransaction;
      f.server.simulateTransaction = async (tx, resources, mode) => {
        const invoke = tx.operations[0].func.invokeContract;
        if (invoke.functionName.toString() !== 'resolve') return readSimulation(tx);
        counts.methods.push(mode);
        const rootInvocation = new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invoke),
          subInvocations: [],
        });
        const sellerEntry = new xdr.SorobanAuthorizationEntry({
          rootInvocation,
          credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
            new xdr.SorobanAddressCredentials({
              address: new Address(bob).toScAddress(),
              nonce: 42n,
              signatureExpirationLedger: 0,
              signature: xdr.ScVal.scvVoid(),
            }),
          ),
        });
        return {
          _parsed: true,
          transactionData: new SorobanDataBuilder(),
          minResourceFee: '0',
          events: [],
          latestLedger: 100,
          result: {
            retval: xdr.ScVal.scvVoid(),
            auth: mode === 'record' ? [sellerEntry] : tx.operations[0].auth,
          },
        };
      };
      const transfer = (recipient, atoms) =>
        new xdr.ContractEvent({
          ext: xdr.ExtensionPoint.v0(),
          contractId: new Address(cfg.token).toScAddress().contractId,
          type: xdr.ContractEventType.contract,
          body: xdr.ContractEventBody.v0(
            new xdr.ContractEventV0({
              topics: [sym('transfer'), address(cfg.contract), address(recipient)],
              data: amount(atoms),
            }),
          ),
        });
      f.server.sendTransaction = async (tx) => {
        assert.equal(buyerApproved, true, 'Seller authorization alone cannot submit');
        assert.equal(tx.source, alice);
        assert.ok(
          tx.signatures.some((signature) =>
            buyerKey.verify(tx.hash(), signature.signature.toBytes()),
          ),
        );
        assert.equal(counts.sellerSign, 1);
        f.counts.submit++;
        sent = tx;
        current.state = 'Resolved';
        return { status: 'PENDING', hash: Buffer.from(tx.hash()).toString('hex') };
      };
      f.server.getTransaction = async () => ({
        status: 'SUCCESS',
        ledger: 100,
        envelopeXdr: sent.toEnvelope(),
        events: { contractEventsXdr: [[transfer(alice, split), transfer(bob, returned)]] },
      });
      const runtime = f.create({
        orderIds: ['1'],
        sellerDrafts: [],
        submissionEnabled: true,
        replayStorePath: join(f.storageDirectory, '..', 'shared-payments.sqlite'),
      });
      let app;
      const server = createServer((req, res) => app.handler(req, res));
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const origin = `http://127.0.0.1:${server.address().port}`;
      app = await createLiveServer({ publicOrigin: origin, runtime, operationTimeoutMs: 10_000 });
      t.after(async () => {
        controller.abort();
        allowBuyer.resolve();
        app.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      });
      function browser(key, overrides = {}) {
        // Node fetch needs a cookie jar; the production client still supplies only
        // same-origin relative paths, exactly as it does in a browser.
        const cookies = new Map();
        const fetcher = async (path, init) => {
          assert.match(path, /^\/api\//);
          assert.equal(init.credentials, 'same-origin');
          const response = await fetch(origin + path, {
            ...init,
            headers: {
              ...init.headers,
              Origin: origin,
              Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
            },
          });
          for (const value of response.headers.getSetCookie()) {
            const pair = value.split(';')[0],
              separator = pair.indexOf('=');
            const name = pair.slice(0, separator);
            if (/Max-Age=0(?:;|$)/i.test(value)) cookies.delete(name);
            else cookies.set(name, pair.slice(separator + 1));
          }
          return response;
        };
        return createHostClient({
          location: { origin },
          fetch: fetcher,
          pollIntervalMs: 5,
          operationTimeoutMs: 10_000,
          freighter: {
            requestAccess: async () => ({ address: key.publicKey() }),
            getAddress: async () => ({ address: key.publicKey() }),
            getNetworkDetails: async () => ({ networkPassphrase: cfg.networkPassphrase }),
            signMessage: async (message) => ({
              signedMessage: key.signMessage(message),
              signerAddress: key.publicKey(),
            }),
            signTransaction: async () => {
              throw Error('Unexpected transaction signer');
            },
            signAuthEntry: async () => {
              throw Error('Unexpected authorization signer');
            },
            ...overrides,
          },
        });
      }
      const buyer = browser(buyerKey, {
        async signTransaction(value, options) {
          counts.buyerSign++;
          assert.equal(options.address, alice);
          assert.equal(options.networkPassphrase, cfg.networkPassphrase);
          const tx = TransactionBuilder.fromXDR(value, cfg.networkPassphrase);
          assert.equal(tx.operations[0].auth.length, 1);
          assert.equal(tx.operations[0].auth[0].credentials.addressV2.signature.type, 'scvVec');
          buyerPrompt.resolve();
          await allowBuyer.promise;
          buyerApproved = true;
          tx.sign(buyerKey);
          return { signedTxXdr: tx.toXDR(), signerAddress: alice };
        },
      });
      const seller = browser(sellerKey, {
        async signAuthEntry(value, options) {
          counts.sellerSign++;
          assert.equal(options.address, bob);
          assert.equal(options.networkPassphrase, cfg.networkPassphrase);
          const preimage = xdr.HashIdPreimage.fromXDR(value, 'base64');
          assert.equal(preimage.type, 'envelopeTypeSorobanAuthorizationWithAddress');
          const auth = preimage.sorobanAuthorizationWithAddress;
          assert.equal(Address.fromScAddress(auth.address).toString(), reviewed.seller);
          assert.equal(auth.signatureExpirationLedger, reviewed.expirationLedger);
          assert.equal(auth.nonce, 42n);
          assert.deepEqual(
            Buffer.from(auth.networkId.toBytes()),
            Buffer.from(hash(cfg.networkPassphrase)),
          );
          const invocation = auth.invocation.function.contractFn;
          assert.equal(
            Address.fromScAddress(invocation.contractAddress).toString(),
            reviewed.contract,
          );
          assert.equal(invocation.functionName.toString(), 'resolve');
          assert.deepEqual(invocation.args.map(scValToNative), [
            BigInt(reviewed.orderId),
            BigInt(reviewed.buyerTokens),
          ]);
          assert.equal(auth.invocation.subInvocations.length, 0);
          assert.equal(f.counts.submit, 0);
          return {
            signedAuthEntry: Buffer.from(sellerKey.sign(hash(preimage.toXDR()))).toString('base64'),
            signerAddress: bob,
          };
        },
      });
      await buyer.authenticate();
      await seller.authenticate();
      await buyer.command('connectWallet', { party: 'buyer' });
      const resolving = buyer.command(
        'resolve',
        { orderId: '1', buyerTokens: split },
        { signal: controller.signal },
      );
      resolving.catch(() => {});
      for (let attempt = 0; attempt < 100; attempt++) {
        const view = await seller.view();
        reviewed = view.recoveryRequests?.[0];
        if (reviewed) break;
        await pause(10);
      }
      assert.ok(reviewed, 'Buyer request reaches the authenticated seller view');
      assert.equal(reviewed.buyer, alice);
      assert.equal(reviewed.seller, bob);
      assert.equal(reviewed.buyerTokens, split);
      assert.equal(reviewed.sellerTokens, returned);
      assert.equal(reviewed.status, 'queued');
      assert.equal(reviewed.network, network);
      assert.equal(reviewed.networkPassphrase, cfg.networkPassphrase);
      assert.equal(reviewed.token, cfg.token);
      assert.equal(reviewed.deploymentId, runtime.deployment.deploymentId);
      assert.deepEqual(
        (await buyer.view()).recoveryRequests,
        [],
        'Buyer refresh is valid while its own request is pending; seller actions appear only in seller view',
      );
      assert.doesNotMatch(JSON.stringify(reviewed), /entryXdr|preimageXdr|claimToken|signature/);
      const approved = await seller.approveRecovery(reviewed);
      assert.equal(approved.approved, true);
      await buyerPrompt.promise;
      assert.equal(
        f.counts.submit,
        0,
        'Both the seller response and opened buyer prompt still leave funds held',
      );
      assert.equal(current.state, 'Paying');
      allowBuyer.resolve();
      const result = (await resolving).result;
      assert.equal(result.order.state, 'Resolved');
      assert.deepEqual(counts.methods, ['record', 'enforce', 'enforce']);
      assert.equal(f.counts.submit, 1);
      const receipt = (
        await buyer.command('reconcileReceipt', { orderId: '1', transaction: result.transaction })
      ).result;
      assert.equal(receipt.buyerReceivedAtoms, split);
      assert.equal(receipt.sellerReturnedAtoms, returned);
      assert.equal(receipt.orderState, 'Resolved');
      const repeated = (await buyer.command('resolve', { orderId: '1', buyerTokens: split }))
        .result;
      assert.deepEqual(repeated.transaction, result.transaction);
      assert.equal(
        f.counts.submit,
        1,
        'A repeated confirmed action reconciles the existing journal entry',
      );
      assert.equal(counts.sellerSign, 1);
      assert.equal(counts.buyerSign, 1);
      assert.deepEqual((await seller.view()).recoveryRequests, []);
    },
  );
