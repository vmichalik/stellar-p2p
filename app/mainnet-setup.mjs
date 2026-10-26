const $ = (id) => document.getElementById(id);
let state,
  prepared,
  connected = false,
  polling;
const api = async (method, value) => {
  const response = await fetch('/bootstrap/' + method, {
    method: value === undefined ? 'GET' : 'POST',
    headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'SETUP_UNAVAILABLE');
  return result;
};
function render() {
  $('receipts').replaceChildren();
  for (const item of state.completed) {
    const p = document.createElement('p'),
      a = document.createElement('a');
    a.href = 'https://stellar.expert/explorer/public/tx/' + item.hash;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.kind === 'upload' ? 'Code published ✓' : 'Escrow created ✓';
    p.append(a);
    $('receipts').append(p);
  }
  const done = state.completed.some((x) => x.kind === 'deploy');
  $('step').textContent = done
    ? 'Your escrow is ready.'
    : !connected
      ? 'Connect your seller wallet'
      : state.completed.length
        ? 'Create the escrow'
        : 'Publish the escrow code';
  $('action').textContent = done
    ? 'Open the exchange'
    : !connected
      ? 'Connect Freighter'
      : prepared
        ? 'Review and sign in Freighter'
        : 'Check the deployment fee';
  $('detail').textContent = done
    ? 'Open Pactlane with the seller wallet connected to fund the 1 USDC offer.'
    : prepared
      ? `Maximum fee for this step: ${(Number(state.pending.fee) / 1e7).toFixed(7)} XLM. Review the transaction in your wallet.`
      : 'Use the seller wallet ending BMXT on Stellar mainnet.';
  $('action').disabled = ['submitted', 'failed', 'rejected'].includes(state.pending?.status);
  if (state.pending?.status === 'submitted') {
    $('status').textContent = state.pending.rpcError
      ? `Submission is unconfirmed (${state.pending.rpcError}). Checking the exact transaction; please leave this page open.`
      : 'Waiting for Stellar to confirm this transaction…';
    polling ??= setInterval(refresh, 4000);
  } else {
    clearInterval(polling);
    polling = null;
  }
  if (state.pending?.status === 'failed')
    $('status').textContent = 'The transaction failed. Leave this page open for review.';
  if (state.pending?.status === 'rejected')
    $('status').textContent =
      `Stellar declined this submission (${state.pending.rpcError}). Leave this page open for review.`;
}
async function refresh() {
  try {
    const before = state?.completed.length;
    state = await api('status');
    if (state.completed.length !== before) prepared = null;
    render();
  } catch {
    $('status').textContent =
      'Connection interrupted. The submitted transaction is saved; waiting to reconnect.';
  }
}
$('action').onclick = async () => {
  $('action').disabled = true;
  $('status').textContent = '';
  try {
    if (state.completed.some((x) => x.kind === 'deploy')) {
      location.href = 'https://pactlane.io/';
      return;
    }
    if (!connected) {
      const a = await freighterApi.requestAccess(),
        n = await freighterApi.getNetworkDetails();
      if (a.error || a.address !== state.owner) throw Error('SELECT_SELLER_WALLET');
      if (n.networkPassphrase !== state.networkPassphrase) throw Error('SELECT_STELLAR_MAINNET');
      connected = true;
    } else if (!prepared) {
      const p = await api('prepare', {});
      state = p;
      prepared = p.xdr;
    } else {
      const a = await freighterApi.getAddress(),
        n = await freighterApi.getNetworkDetails();
      if (a.address !== state.owner || n.networkPassphrase !== state.networkPassphrase)
        throw Error('WALLET_CHANGED');
      const signed = await freighterApi.signTransaction(prepared, {
        networkPassphrase: state.networkPassphrase,
        address: state.owner,
      });
      if (signed.error || signed.signerAddress !== state.owner)
        throw Error('SIGNATURE_NOT_COMPLETED');
      state = await api('submit', { signedXdr: signed.signedTxXdr });
      prepared = null;
    }
    render();
  } catch (error) {
    $('status').textContent =
      {
        SELECT_SELLER_WALLET: 'Select the seller wallet ending BMXT in Freighter.',
        SELECT_STELLAR_MAINNET: 'Select Stellar mainnet in Freighter.',
        SIGNATURE_NOT_COMPLETED: 'The signature was not completed. Your wallet controls approval.',
        DEPLOYMENT_FEE_CAP_EXCEEDED:
          'The fee exceeds your approved cap. Leave the page open for review.',
      }[error.message] || `Setup paused: ${error.message}.`;
    $('action').disabled = false;
  }
};
await refresh();
