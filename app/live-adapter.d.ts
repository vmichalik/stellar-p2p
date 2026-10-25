/** Proposed production boundary. No implementation or live credentials are supplied.
 * Canonical source: contracts/escrow/interface.json in the escrow workstream.
 * Monetary values and u64 values cross JSON as decimal strings, never JS floats.
 */
export type Integer = string;
export type Address = string;
export type ChainState = 'Funded' | 'Reserved' | 'Paying' | 'Released' | 'Refunded' | 'Resolved';
export interface Deployment {
  networkPassphrase: string;
  rpcUrl: string;
  contract: Address;
  token: Address;
  tokenDecimals: number;
}
export interface Terms {
  seller: Address;
  token_amount: Integer;
  fiat_minor: Integer;
  currency: 'EUR';
  rail: 'revolut';
  recipient: string; // 32-byte commitment; encoding must match policy + contract.
  offer_expires_at: Integer; // Unix seconds, not UI milliseconds.
  reservation_seconds: Integer;
}
export interface ChainOrder {
  id: Integer;
  terms: Terms;
  state: ChainState;
  buyer: Address | null;
  reserved_at: Integer;
  pay_by: Integer;
  locked_at: Integer;
}
export interface ConfirmedTransaction {
  hash: string;
  networkPassphrase: string;
  contract: Address;
  ledger: Integer;
  status: 'confirmed';
}
export interface ConfirmedOrder {
  order: ChainOrder; // Re-fetched from the configured contract after confirmation.
  transaction: ConfirmedTransaction;
}
export type PolicyStatus =
  | { status: 'pending' | 'unavailable' | 'rejected'; orderId: Integer }
  | { status: 'verified'; orderId: Integer; authorization: string };
export interface ReconciledReceipt {
  orderId: Integer;
  orderState: 'Released' | 'Refunded' | 'Resolved';
  buyerReceivedAtoms: Integer;
  sellerReturnedAtoms: Integer;
  transaction: ConfirmedTransaction;
}
export interface LivePactlaneServices {
  readonly mode: 'live';
  readonly deployment: Deployment;
  connectWallet(
    party: 'buyer' | 'seller',
  ): Promise<{ account: Address; networkPassphrase: string }>;
  getOrder(orderId: Integer): Promise<ChainOrder>;
  fund(terms: Terms): Promise<ConfirmedOrder>;
  reserve(orderId: Integer, buyer: Address): Promise<ConfirmedOrder>;
  // Only a confirmed Paying order with locked_at unlocks payment instructions.
  beginPayment(orderId: Integer): Promise<ConfirmedOrder>;
  // Progress is display-only. Authorization comes from the trusted policy service.
  launchPaymentProof(orderId: Integer, onProgress: (label: string) => void): Promise<void>;
  getPolicyStatus(orderId: Integer): Promise<PolicyStatus>;
  release(orderId: Integer, authorization: string): Promise<ConfirmedOrder>;
  // Both parties must authorize the same call and buyer allocation.
  resolve(orderId: Integer, buyerTokens: Integer): Promise<ConfirmedOrder>;
  refundExpiredReservation(orderId: Integer): Promise<ConfirmedOrder>;
  // Confirm actual token transfers and network/contract identity before a receipt.
  reconcileReceipt(orderId: Integer, transaction: ConfirmedTransaction): Promise<ReconciledReceipt>;
}
