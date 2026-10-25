import UniversalProvider from '@walletconnect/universal-provider';
import QRCode from 'qrcode';
export const createProvider = (config) =>
  UniversalProvider.init({
    projectId: config.projectId,
    metadata: {
      name: 'Pactlane',
      description: 'Peer-to-peer Stellar exchange',
      url: config.appUrl,
      icons: [],
    },
    relayUrl: 'wss://relay.walletconnect.com',
    logger: 'silent',
    telemetryEnabled: false,
  });
export const pairingImage = (uri) =>
  QRCode.toDataURL(uri, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
