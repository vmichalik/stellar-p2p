# Payment privacy and recovery

Pactlane’s goal is to share the information needed to verify a trade while keeping users in control of disclosure.

| Party             | What it sees                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revolut           | Its customer, request credentials and bank payment.                                                                                                           |
| Counterparty      | The payment information available through the bank transfer.                                                                                                  |
| Proof verifier    | The response the user approves for disclosure. The current complete-record check includes transfer details, names, account IDs, balance and response headers. |
| Payment service   | Normalized transfer identity and fields needed to match an order and prevent reuse.                                                                           |
| Stellar observers | Public addresses, order state and token movements.                                                                                                            |

Request authentication values are not selected for verifier disclosure. Complete **response** headers can contain cookies; the consent screen explicitly names that scope. Narrower disclosures must preserve enough authenticated context to validate the same payment rules.

The deployed complete-record verifier suppresses its raw transcript output. The private receiver stores normalized payment fields with restricted file permissions. Its diagnostic database is ephemeral; a live operator needs durable evidence and replay storage with an explicit retention and backup policy.

## If verification stops

After the payment lock, tokens stay in escrow until valid verification or an agreement from both wallets completes. There is no unilateral timeout refund at this stage. If the other party will not agree and proof cannot complete, the funds remain held.

Review the exact allocation and both approvals before recovery. If a bank payment already exists, check it again rather than paying a second time.
