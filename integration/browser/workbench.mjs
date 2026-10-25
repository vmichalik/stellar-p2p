import { createHostClient, answerWalletRequest } from './client.mjs';

const $ = (id) => document.getElementById(id);
const capability = new URLSearchParams(location.hash.slice(1)).get('access');
if (capability) history.replaceState(null, '', location.pathname);
let client,
  lastTransaction,
  busy = false;
const pending = new Set();
const show = (value) => {
  $('result').textContent = JSON.stringify(value, null, 2);
};
const message = (value) => {
  $('message').textContent = value;
};
const code = (error) =>
  /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message ?? '') ? error.message : 'REQUEST_FAILED';
const orderId = () => {
  const id = $('order').value.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(id)) throw new Error('INVALID_ORDER_NUMBER');
  return id;
};
async function perform(action) {
  if (!client || busy) return;
  busy = true;
  message('Waiting for the host. Approve any wallet requests below.');
  try {
    const result = await action();
    if (result?.authorization) $('authorization').value = result.authorization;
    if (result?.transaction) lastTransaction = result.transaction;
    show(result);
    message(
      result?.transaction
        ? 'Transaction confirmed by RPC. Reconcile transfers for a receipt.'
        : 'Host response received.',
    );
  } catch (error) {
    message(code(error));
  } finally {
    busy = false;
  }
}
async function pollWallet() {
  if (!client) return;
  try {
    const { requests } = await client.request('/api/wallet/requests');
    const current = new Set(requests.map((r) => r.id));
    for (const element of $('wallet-requests').children)
      if (!current.has(element.dataset.request)) element.remove();
    for (const request of requests) {
      if (
        pending.has(request.id) ||
        [...$('wallet-requests').children].some((e) => e.dataset.request === request.id)
      )
        continue;
      const card = document.createElement('div');
      card.className = 'wallet-request';
      card.dataset.request = request.id;
      const label = document.createElement('p');
      label.textContent =
        request.kind === 'signAuthEntry'
          ? 'Approve a contract authorization for mutual recovery.'
          : request.kind === 'sign'
            ? 'Review and sign a testnet transaction.'
            : `Wallet request: ${request.kind}`;
      card.append(label);
      if (request.account) {
        const account = document.createElement('p');
        account.textContent = `Requested account: ${request.account}`;
        card.append(account);
      }
      const approve = document.createElement('button');
      approve.textContent = 'Continue in Freighter';
      const decline = document.createElement('button');
      decline.textContent = 'Decline';
      approve.onclick = async () => {
        pending.add(request.id);
        approve.disabled = true;
        decline.disabled = true;
        try {
          const result = await answerWalletRequest(request, globalThis.freighterApi);
          await client.request('/api/wallet/replies', { id: request.id, result });
          card.remove();
        } catch (error) {
          message(code(error));
          await client
            .request('/api/wallet/replies', { id: request.id, error: true })
            .catch(() => {});
          card.remove();
        } finally {
          pending.delete(request.id);
        }
      };
      decline.onclick = async () => {
        await client.request('/api/wallet/replies', { id: request.id, error: true });
        card.remove();
      };
      card.append(approve, decline);
      $('wallet-requests').append(card);
    }
  } catch (error) {
    $('connection').textContent = code(error);
  }
  setTimeout(pollWallet, 1000);
}
for (const button of document.querySelectorAll('[data-party]'))
  button.onclick = () =>
    perform(async () => {
      const result = await client.request('/api/connect', { party: button.dataset.party });
      if (button.dataset.party === 'buyer') $('buyer').value = result.account;
      return result;
    });
$('fund').onclick = () =>
  perform(() => client.request('/api/fund', { terms: JSON.parse($('terms').value) }));
for (const button of document.querySelectorAll('[data-action]'))
  button.onclick = () =>
    perform(() => {
      const path = `/api/orders/${orderId()}`,
        action = button.dataset.action;
      if (action === 'read') return client.request(path);
      if (action === 'authorize')
        return client.request(`${path}/policy`, { evidenceId: $('evidence').value.trim() });
      if (action === 'instructions' || action === 'policy')
        return client.request(`${path}/${action}`);
      const body =
        action === 'reserve'
          ? { buyer: $('buyer').value.trim() }
          : action === 'release'
            ? { authorization: $('authorization').value.trim() }
            : action === 'resolve'
              ? { buyerTokens: $('allocation').value.trim() }
              : {};
      return client.request(`${path}/${action}`, body);
    });
$('receipt').onclick = () =>
  perform(() => {
    if (!lastTransaction) throw new Error('CONFIRMED_TRANSACTION_REQUIRED');
    return client.request(`/api/orders/${orderId()}/receipt`, { transaction: lastTransaction });
  });
try {
  client = createHostClient({ capability });
  const result = await client.request('/api/config');
  $('deployment').textContent = JSON.stringify(result.config, null, 2);
  $('connection').textContent =
    'Private host connected. Check the deployment and select testnet in Freighter.';
  void pollWallet();
} catch (error) {
  $('connection').textContent = code(error);
}
