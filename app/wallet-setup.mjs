import { browserWallet } from './wallet-dialog.mjs';
import { STELLAR_NETWORKS } from './freighter-connector.mjs';
const select = document.querySelector('#wallet-network');
const connect = document.querySelector('#connect-wallet');
const disconnect = document.querySelector('#disconnect-wallet');
const result = document.querySelector('#wallet-result');
let wallet;
const messages = {
  WALLET_NETWORK_MISMATCH: 'Switch Freighter to the selected network and try again.',
  WALLET_EXTENSION_NOT_INSTALLED:
    'Freighter extension was not detected. Install it on desktop, or choose Freighter Mobile.',
  WALLET_CONNECTION_CANCELLED: 'Connection cancelled. No transaction was requested.',
  WALLET_MOBILE_NOT_CONFIGURED: 'Freighter Mobile needs the app’s WalletConnect configuration.',
  WALLET_METHOD_UNSUPPORTED:
    'This wallet session lacks message or authorization signing. Reconnect with Freighter Mobile.',
};
const reset = () => {
  result.textContent = 'Wallet disconnected or changed. Connect again to check it.';
  disconnect.hidden = true;
};
connect.addEventListener('click', async () => {
  connect.disabled = true;
  select.disabled = true;
  result.textContent = 'Waiting for Freighter. Review the connection request in your wallet.';
  try {
    await wallet?.disconnect();
    const network = STELLAR_NETWORKS[select.value];
    wallet = await browserWallet({ networkPassphrase: network.passphrase, onInvalidate: reset });
    const account = await wallet.requestAccess();
    if (account.error) throw Error('WALLET_UNAVAILABLE');
    const current = await wallet.getNetworkDetails();
    if (current.networkPassphrase !== network.passphrase) throw Error('WALLET_NETWORK_MISMATCH');
    result.textContent = `Connected to ${network.label}: ${account.address}. Connection only — no signature or transaction requested.`;
    disconnect.hidden = false;
  } catch (error) {
    result.textContent =
      messages[error.code] ??
      'Could not connect. Check Freighter, network selection and the WalletConnect project’s allowed app origin, then try again.';
  } finally {
    connect.disabled = false;
    select.disabled = false;
    connect.focus({ preventScroll: true });
  }
});
disconnect.addEventListener('click', async () => {
  try {
    await wallet?.disconnect();
  } finally {
    wallet = null;
    reset();
  }
});
