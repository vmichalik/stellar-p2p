# Pactlane: the user problem and product promise

Researched 25 October 2026. Current direction: someone who needs Stellar USDC may prefer a direct trade that avoids another exchange account and additional identity-document collection, and lets the person supplying USDC earn the trading margin. These are reasons to test the product, not validated demand or delivered privacy guarantees. This revision supersedes the earlier decision to treat privacy only as a supporting benefit.

## Downstream purpose and alternatives, checked 25 October 2026

The [concept](concept.md) starts with the buyer's preference for using their existing payment account without handing identity documents to another institution. They still need a reason to hold USDC on Stellar, such as funding a specific Stellar app or paying a recipient who uses that asset and network. EURC also exists on Stellar, so getting euros onchain does not itself require buying dollars.

Kraken's [current network table](https://support.kraken.com/articles/360000678446-cryptocurrencies-available-on-kraken) explicitly supports Stellar USDC. Its [EUR SEPA funding options](https://support.kraken.com/articles/360000381846-cash-deposit-options-fees-minimums-and-processing-times-) include free deposits without a listed withdrawal hold; transaction eligibility, trading and withdrawal costs still apply. [Ramp's EU/EEA table](https://support.rampnetwork.com/en/articles/432-what-cryptoassets-does-ramp-network-support) supports Stellar USDC buying/selling and its European methods include bank transfers. Do not pitch missing Stellar access or blanket exchange cost/delay as the problem.

Payment-to-release coordination explains how the direct trade could work. The privacy preference and seller economics explain why someone might choose it. Next research must test those motivations against actual previous purchases, then compare repeat purchases and seller economics with the existing route.

## Decision

Lead with: "I already have a bank account. I want USDC in my wallet without opening another exchange account and giving another company my passport. I'd rather pay the person supplying the USDC."

The initial audience is a Stellar wallet user with EUR in Revolut who values avoiding additional institutional onboarding or already uses P2P liquidity. Start with a small Stellar-community cohort. The seller needs compensation for supplying USDC and taking payment risk, as well as an exact payment match before release. These are audience hypotheses, not measured preferences.

Pactlane is being built to verify the payment and release a funded offer without the seller inspecting receipts and manually approving every normal trade. It still trusts a payment verifier and an escrow contract. We have not measured reductions in waiting, disputes, disclosure or total cost.

**Headline:** Trade euros for USDC on Stellar.

**Supporting line:** Pay someone through Revolut. Receive USDC in your Stellar wallet.

**Concept explanation:** We're building a way to trade using the payment account you already have, with only the payment details needed to check the trade. The person supplying USDC can earn a margin in their price.

**Trade-flow prompt:** After you pay, know what happens next.

This direction is implemented in UI commit `5bd17fde42340d898435eaecd873ba25366c32ee` and integration source `88ba889f1927ec9283b45c2120d9c8df6a661419`. The app now puts the motivation before the quote, offers a first-person explanation, names the payment recipient and explains the possible seller margin. Its mobile navigation and desktop setup guide make the next action clearer without implying cross-device resume. Intended privacy benefits remain separate from the simulated functionality. This revision is published at [pactlane.io](https://pactlane.io), with the revised silent video and dub script. The [25 October public audit](../evidence/release/public-narrative-2026-10-25.json) records frozen source `88ba889`, Worker `e95529b6-f423-483e-a19c-f95c44e43508`, matching assets and all 67 required checks passing. The known video range limitation remains; direct Chrome playback works.

## What the evidence supports

| Candidate pain | Evidence | Positioning decision |
| --- | --- | --- |
| Payment confirmation and release uncertainty | OKX documents paid-but-not-released trades, contacting the counterparty, evidence uploads and support review. Its response target is not an estimate of typical trade delay. [Dispute guidance](https://www.okx.com/en-us/help/how-do-i-raise-a-dispute-when-using-p2p-trading) | The practical problem the escrow and proof flow address after someone chooses P2P. These failure modes exist; their frequency remains unmeasured. |
| Platform fees | OKX advertises no P2P service fee; sellers set rates and payment providers can charge. [OKX](https://www.okx.com/en-gb/help/what-is-p2p-trading). Bybit's fee schedule depends on currency, role and verification circumstances; unlisted currencies have no transaction fee, with a specific EUR exception for Azerbaijan-verified users. [Bybit](https://www.bybit.com/en/help-center/article/P2P-on-Bybit-Fees-Explained) | Do not lead with “zero fees” or “cheaper.” Show exact EUR paid and USDC received. Compare all-in quotes only when measured for the same amount, geography, time and destination network. |
| Exchange cost | Revolut Portugal says fiat/stablecoin exchanges do not incur a crypto fee. This does not establish zero FX cost, spread or withdrawal cost. [Revolut Portugal](https://help.revolut.com/en-PT/help/wealth/cryptocurrencies/getting-cryptocurrency-exposure/how-much-does-it-cost-to-buy-or-sell-cryptocurrency/) | A generic “exchanges are expensive” claim is too weak. Any eventual savings claim needs a live, comparable quote. |
| Additional identity collection | [Kraken's verification requirements](https://support.kraken.com/articles/360000672203-document-requirements-for-verification) include identity documents and potentially address/face evidence. [Coinbase's May 2025 incident](https://www.coinbase.com/blog/protecting-our-customers-standing-up-to-extortionists) exposed government-ID images and account information. | Leading motivation to test: avoid another institution holding identity documents. Existing bank KYC does not erase this preference. Production onboarding obligations and actual data minimization remain unresolved. |
| Who earns the margin | The implemented quote pairs agreed EUR and USDC amounts. EUR goes directly to the seller; the contract releases the full agreed USDC amount and has no platform-fee recipient. A margin could be included in the offered price. The demo does not calculate seller profit. | Let individuals earn by supplying USDC. This is a distribution preference, separate from cheapness. Do not claim all fees go to people or that companies cannot provide liquidity. |
| Limited exchange access | [Kraken](https://support.kraken.com/articles/where-is-kraken-licensed-or-regulated) lists Japan among prohibited regions, while [Revolut](https://help.revolut.com/en-PT/help/profile-and-plan/profile-plan/verifying-identity/what-countries-are-supported/) supports residents of Japan. | Account availability can differ. This example establishes a mismatch, not a working or permitted Pactlane route in Japan. Validate each target market; the EUR/Revolut prototype does not establish global access. |
| Access to Stellar USDC | Airtm already supports direct USDC withdrawals on Stellar. [Airtm](https://help.airtm.com/en/support/solutions/articles/47001199969-direct-withdrawals-crypto-btc-eth-dai-xlm-stellar-usdc-busd-usdt-) | Stellar is the chosen destination, not proof that no on-ramp exists. Do not claim “first Stellar on-ramp.” |
| Proof-based P2P | ZKP2P/Peer already develops cryptographically verified P2P on/off-ramping, including Revolut. [Official project](https://github.com/zkp2p/), [V2 announcement](https://paragraph.com/@zkp2p/introducing-zkp2p-v2) | Acknowledge the prior art. Pactlane's hackathon contribution is applying a scoped payment-to-release flow to Stellar, with explicit lock and recovery semantics. |

The evidence establishes current product features and documented problems, not user counts, dispute rates or market size. Platform and country eligibility can change. Do not transfer a fee from one region or product to another.

## What privacy and pricing still require

The configured payment proof selects amount, currency, recipient code, transaction ID, state, completion date and type, plus response metadata and the request path. Authentication values are excluded from the configured verifier disclosure; they are still sent to Revolut to make the request. The verifier currently logs disclosed transcript fields. Source: `tlsn/revolut.plugin.mjs` and the released verifier's `src/verifier.rs`. No private logs were read for this review.

Before making a production privacy promise, remove payment plaintext from routine logs, establish retention and deletion, finish payer/payment binding, and determine the service's onboarding requirements. Revolut knows the payment, the counterparty receives payment information and Stellar settlement is public. The replay registry also retains payment/order bindings. Selective disclosure alone does not establish anonymity or zero retention.

The seller's possible margin is part of the offered EUR/USDC price, not a separate fee automatically redistributed by the contract. The contract does not distinguish an individual seller from a company. Any future Pactlane, proof-service, payment-provider or network charges need separate labels and recipients. Current fixture pricing and "Demo fee €0.00" establish none of those costs.

For cost research, [Ramp's published processing rates](https://support.rampnetwork.com/en/articles/12634-fees-and-exchange-rates-when-buying-crypto) include up to 1.40% for manual bank transfer and 3.9% for EUR/USD/GBP cards, plus a minimum-fee component and possible network/partner/bank costs. [Kraken Pro's base stablecoin/FX trading tier](https://www.kraken.com/features/fee-schedule) is 0.20%, excluding funding, spread and withdrawal costs. Compare final usable Stellar USDC for the same EUR spend, geography and time. Preference for paying a peer does not establish a lower total price.

## Put the promise into the experience

| Surface | Copy and behavior |
| --- | --- |
| Entry | Use the headline and supporting line above. Keep a concise “Simulated walkthrough · No live payment or settlement” badge visible. |
| Quote | “You pay €[amount] to [seller]. You receive [exact amount] USDC.” Whole-offer acceptance. Explain that any seller margin is included in their offered rate; don't invent an amount without a defined comparison rate. Label additional charges and their recipients only when implemented. Keep fixture pricing “Demo fee” and preserve token precision. |
| Before payment | “Confirm the payment lock before sending euros.” Recipient instructions appear only after confirmed lock. Explain: “After locking, USDC stays held until payment is accepted or both wallets approve recovery.” |
| Payment deadline | Say “Send payment within …”. It is not a guarantee that proof finishes before that time. A timely payment may be verified later. |
| Progress | State who acts next, what has been confirmed, and what remains. A spinner or browser callback is not payment acceptance. |
| Consent | “Review the information requested for this payment check.” Name the verifier, selected fields and actual retention. In the demo, identify sample data. Don't imply a current zero-retention guarantee or replace the disclosure explanation with a generic “private” badge. |
| Verification failure | “Payment verification incomplete. USDC remains held. Retry verification or agree a recovery with the seller.” Keep “Don't pay again” when a payment may already exist. |
| Recovery | “Recovery requires approval from both parties. There is no automatic refund after payment begins.” Show exact allocations, approvals still needed and held amount. An uncooperative party can leave the trade unresolved. |
| Receipt | Show the exact amounts and actual evidence type. A demo receipt is not a chain explorer transaction. Use “View receipt details” for an internal modal. |
| Trust explanation | “Pactlane's verifier checks payment evidence and authorizes release. The Stellar contract checks that authorization.” The contract does not directly validate a bank transcript. |

## Pitch and demo

Revised opening narration: “If I need USDC for a Stellar app or payment, I don’t want another exchange account or another company holding my passport. I’d rather use the payment account I have and pay the person supplying the USDC. That’s why I’m building Pactlane. This walkthrough uses sample payments.”

The main story follows seller funding, buyer whole-offer reservation, confirmed payment locking, then fiat instructions, sample payment verification and a simulated receipt. A separate order demonstrates unavailable proof and two-wallet recovery. The local policy/compiled-WASM rehearsal is distinct implementation evidence. Do not intercut it as if it proves the browser made a live payment.

Revised closing narration: “That’s the prototype: a funded direct trade, with a payment check before release. Reliable live verification is still the next hurdle, followed by a confirmed testnet trade. You can try the demo at pactlane dot io.” The recovery sequence explicitly explains that a locked trade can remain unresolved if either person will not cooperate.

The new public demo address is `https://pactlane.io`. Use `https://proof.pactlane.io` for proof tooling only after DNS, certificate and public-origin configuration are verified. Domain ownership does not establish service availability. Keep video audio absent for Vijay's own dub.

## What could invalidate the idea

The extension, proof generation, fixed offer sizes, unfamiliar verifier and two-party recovery may introduce more friction than they remove. Reliable liquidity and seller risk are prerequisites. Cryptographic evidence of a payment record does not make the underlying payment irreversible or eliminate chargebacks, account freezes and every dispute. The current prototype has not demonstrated accepted live payment semantics or fewer disputes.

Interview buyers and liquidity providers separately. Ask about their last actual purchase: why Stellar USDC, which routes were available, what they paid and received, and whether identity collection changed their choice. Ask before suggesting our solution. Test whether they prefer paying a peer at the same all-in price, and what extra cost or friction they would accept. Ask sellers about acquisition costs, payment risk and the margin needed to keep supplying USDC. Then test understanding of the lock, disclosure and recovery dependency. Demo enthusiasm is not willingness to trade.

Identity-data exposure and payment-to-release failures are documented. Whether this audience values a direct trade enough to choose Pactlane remains unvalidated, as do sustainable seller returns and lower all-in prices.
