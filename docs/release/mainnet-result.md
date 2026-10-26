# A completed Revolut-to-USDC trade

On 26 October 2026, a buyer paid **€0.89 through Revolut** and received **1 Circle USDC on Stellar mainnet** through Pactlane. The transfer completed at 09:52:33 UTC in ledger 65144514.

[View the release](https://stellar.expert/explorer/public/tx/ec4220af4056b185d242977385484066789824a2a274f57b3439e1e4dd1b9864) · [Machine-readable evidence](../../evidence/release/mainnet-trade-2026-10-26.json).

## The trade

The seller funded order 0 with 1 USDC. The buyer reserved it and confirmed the payment lock before paying. TLSNotary authenticated the Revolut response. Pactlane checked the payer, recipient, exact EUR amount and completion time against that order, then signed the release claim. The buyer approved the release in Freighter.

| Step                 | Confirmed transaction                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Publish escrow code  | [b19f5ecb…](https://stellar.expert/explorer/public/tx/b19f5ecb60f33285c551d17b1cd19395f60d14903673fdaabafb3cdacdfd69a3) |
| Create escrow        | [4da4c1b4…](https://stellar.expert/explorer/public/tx/4da4c1b436f837ffa9c30e6eda8f5afcc989a9974f1057ab18f76fb944272daf) |
| Fund 1 USDC          | [6b5b1f14…](https://stellar.expert/explorer/public/tx/6b5b1f141b9fb7718119d2ce82322c2bf758e72d8d67312c4fdac122dc1492c9) |
| Reserve the offer    | [efee5f08…](https://stellar.expert/explorer/public/tx/efee5f08b5abb2a754dcee0f90012e52f46a0e78c0554b8926b1d7187d7afdda) |
| Lock the payment     | [ad3ea44c…](https://stellar.expert/explorer/public/tx/ad3ea44c19333f1849fee7737f05290874be3941f8b83c6b37ac4a4c9759ef77) |
| Release to the buyer | [ec4220af…](https://stellar.expert/explorer/public/tx/ec4220af4056b185d242977385484066789824a2a274f57b3439e1e4dd1b9864) |

## Settlement checks

The Circle USDC transfer events show exactly 10,000,000 token atoms entering escrow and the same amount leaving for the buyer. Independent balance reads confirm a 1 USDC increase for the buyer and a zero escrow balance after release. USDC uses seven decimal places on Stellar.

The contract's payment-used marker is set. The private policy store records the payment as settled, preserving its binding to order 0. Repeated proofs of the same bank transfer were matched as one payment. The older transfer used to establish the owner-reviewed identity binding was excluded by amount and payment time.

Publishing the code and creating the escrow cost 17.2118712 XLM, within the approved 25 XLM cap. All wallet approvals came from the owner. Bank identifiers, raw responses, cookies and signing keys stay out of this receipt.

The payment-proof release gate is **CLEARED for this completed trade**. The contract trusts Pactlane's configured payment signer; [the architecture](../architecture.md) explains that trust boundary and recovery.
