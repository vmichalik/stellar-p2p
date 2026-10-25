# Morning capture list

| Shot            | What to capture                                            | Source                                                                                            |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Offer           | A funded offer, exact EUR price and USDC amount.           | Current app; Demo mode visible for sample data.                                                   |
| Wallet approval | The seller’s deposit approval and confirmed funded state.  | The corresponding wallet and order.                                                               |
| Buyer           | Reservation and confirmed payment lock.                    | The same order throughout.                                                                        |
| Bank proof      | The accepted transfer-record result and disclosure review. | Existing approved record; hide personal data in the published capture.                            |
| Settlement      | Receipt with network, token, amount and transaction link.  | Actual mainnet trade when available; otherwise use the separately labeled PLTEST testnet receipt. |
| Recovery        | Exact allocation and both approvals.                       | A separate order so the story remains clear.                                                      |

Use [the walkthrough script](revised-demo-script.md). Capture the actual screens at a readable scale. Keep names, account identifiers, balances unrelated to the trade, cookies and raw responses out of published images. Match each receipt to its transaction before replacing a segment.

The app’s Demo mode is the marker for sample screens. A live capture belongs to its real network and trade; do not add a simulated hash or reuse the historical transfer for a new order.
