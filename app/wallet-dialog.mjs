import { createFreighterConnector } from './freighter-connector.mjs';
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
export async function browserWallet({ networkPassphrase, onInvalidate } = {}) {
  let config = { enabled: false };
  try {
    const response = await fetch('/wallet-config.json', {
      redirect: 'error',
      credentials: 'same-origin',
    });
    const value = await response.json();
    if (
      response.ok &&
      value.enabled === true &&
      /^[a-f0-9]{32}$/i.test(value.projectId) &&
      value.appUrl === location.origin
    )
      config = value;
  } catch {
    /* Desktop remains usable when mobile configuration is unavailable. */
  }
  let vendor, dialog, cancelPairing;
  const close = () => {
    if (dialog) {
      dialog.close();
      dialog.remove();
      dialog = null;
    }
  };
  function create(title) {
    close();
    dialog = document.createElement('dialog');
    dialog.className = 'wallet-connection-dialog';
    dialog.setAttribute('aria-labelledby', 'wallet-dialog-title');
    const heading = document.createElement('h2');
    heading.id = 'wallet-dialog-title';
    heading.textContent = title;
    dialog.append(heading);
    document.body.append(dialog);
    return dialog;
  }
  async function load() {
    return (vendor ??= await import('/vendor/walletconnect.mjs'));
  }
  const wallet = createFreighterConnector({
    networkPassphrase,
    onInvalidate,
    choose: () =>
      new Promise((resolve, reject) => {
        const el = create('Connect Freighter');
        const intro = document.createElement('p');
        intro.textContent =
          'Choose the browser extension or connect the Freighter app on your phone. Your wallet keeps your keys.';
        el.append(intro);
        const choices = [
          ['extension', 'Freighter browser extension'],
          ['mobile', 'Freighter Mobile'],
        ];
        const preferMobile =
          matchMedia('(max-width: 760px)').matches || globalThis.stellar?.platform === 'mobile';
        if (preferMobile) choices.reverse();
        for (const [value, label] of choices) {
          const button = document.createElement('button');
          button.className =
            'button ' +
            (value === (preferMobile ? 'mobile' : 'extension') ? 'primary' : 'secondary');
          button.textContent = label;
          button.disabled = value === 'mobile' && !config.enabled;
          button.onclick = () => {
            close();
            resolve(value);
          };
          el.append(button);
        }
        if (!config.enabled) {
          const note = document.createElement('p');
          note.className = 'small-note';
          note.textContent =
            'Mobile connection needs the app’s WalletConnect project configuration.';
          el.append(note);
        }
        const cancel = document.createElement('button');
        cancel.className = 'button secondary';
        cancel.textContent = 'Cancel';
        const abort = () => {
          close();
          reject(
            Object.assign(new Error('WALLET_CONNECTION_CANCELLED'), {
              code: 'WALLET_CONNECTION_CANCELLED',
            }),
          );
        };
        cancel.onclick = abort;
        el.addEventListener('cancel', (e) => {
          e.preventDefault();
          abort();
        });
        el.append(cancel);
        el.showModal();
      }),
    loadMobile: async () => {
      if (!config.enabled) fail('WALLET_MOBILE_NOT_CONFIGURED');
      const el = create('Connecting to Freighter Mobile');
      const p = document.createElement('p');
      p.textContent = 'Preparing the secure WalletConnect connection…';
      el.append(p);
      const cancel = document.createElement('button');
      cancel.className = 'button secondary';
      cancel.textContent = 'Cancel connection';
      const abort = () => {
        wallet.cancel();
        close();
      };
      cancel.onclick = abort;
      el.addEventListener('cancel', (e) => {
        e.preventDefault();
        abort();
      });
      el.append(cancel);
      el.showModal();
      return (await load()).createProvider(config);
    },
    pair: async (uri, cancel) => {
      if (!uri) {
        close();
        return;
      }
      cancelPairing = cancel;
      const el = create('Open Freighter on your phone');
      const p = document.createElement('p');
      p.textContent =
        'On another device, scan this code using Freighter. On this phone, copy the connection code, open Freighter’s scanner and paste it there. Approve the account and network in Freighter.';
      el.append(p);
      const image = document.createElement('img');
      image.alt = 'WalletConnect pairing QR code';
      image.width = 240;
      image.height = 240;
      el.append(image);
      const field = document.createElement('textarea');
      field.readOnly = true;
      field.setAttribute('aria-label', 'WalletConnect connection code');
      field.value = uri;
      field.rows = 2;
      el.append(field);
      const copy = document.createElement('button');
      copy.className = 'button primary';
      copy.textContent = 'Copy connection code';
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(uri);
          copy.textContent = 'Connection code copied';
        } catch {
          field.focus();
          field.select();
        }
      };
      el.append(copy);
      const cancelButton = document.createElement('button');
      cancelButton.className = 'button secondary';
      cancelButton.textContent = 'Cancel connection';
      const abort = () => {
        cancelPairing?.();
        close();
      };
      cancelButton.onclick = abort;
      el.addEventListener('cancel', (e) => {
        e.preventDefault();
        abort();
      });
      el.append(cancelButton);
      el.showModal();
      try {
        const data = await (await load()).pairingImage(uri);
        if (image.isConnected) image.src = data;
      } catch {
        image.remove();
      }
    },
  });
  return wallet;
}
