/** Same-origin transport. The capability stays in memory and never enters a URL request. */
export function createHostClient({ capability, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9_-]{40,}$/.test(capability ?? '')) throw new Error('ACCESS_LINK_REQUIRED');
  return Object.freeze({
    async request(path, body) {
      if (!/^\/api\/[a-zA-Z0-9/\-]+$/.test(path)) throw new Error('INVALID_API_PATH');
      const reply = await fetchImpl(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${capability}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      const data = await reply.json();
      if (!reply.ok || data.error) {
        const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(data.error ?? '')
          ? data.error
          : 'REQUEST_FAILED';
        throw new Error(code);
      }
      return data.result;
    },
  });
}

/** Use only the official locally installed Freighter API. Never handles wallet seeds. */
export async function answerWalletRequest(request, api) {
  if (!api) throw new Error('FREIGHTER_REQUIRED');
  let reply;
  switch (request.kind) {
    case 'connect':
      reply = await api.requestAccess();
      break;
    case 'selected':
      reply = await api.getAddress();
      break;
    case 'network':
      reply = await api.getNetworkDetails();
      break;
    case 'sign':
      reply = await api.signTransaction(request.transactionXdr, {
        networkPassphrase: 'Test SDF Network ; September 2015',
        address: request.account,
      });
      break;
    case 'signAuthEntry':
      reply = await api.signAuthEntry(request.preimageXdr, {
        networkPassphrase: 'Test SDF Network ; September 2015',
        address: request.account,
      });
      break;
    default:
      throw new Error('UNSUPPORTED_WALLET_REQUEST');
  }
  if (reply.error) throw new Error('WALLET_ACTION_DECLINED');
  if (request.kind === 'network') return reply.networkPassphrase;
  if (request.kind === 'connect' || request.kind === 'selected') return reply.address;
  if (reply.signerAddress !== request.account) throw new Error('WALLET_ACCOUNT_MISMATCH');
  if (request.kind === 'sign') return reply.signedTxXdr;
  return { signedAuthEntry: reply.signedAuthEntry, signerAddress: reply.signerAddress };
}
