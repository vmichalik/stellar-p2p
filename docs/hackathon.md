# Hackathon notes

Pactlane explores a direct route from an existing bank app to Stellar assets. A buyer sees the whole quote before paying; a human supplier sets a price that can cover their costs and a margin. The intended proof shares selected payment fields with an operator. Show the local product and preparation history honestly: accepted bank evidence and network settlement remain unfinished.

## Event facts

Checked against the official pages on 25 October 2026: HackMeridian is in Lisbon on 25–26 October. Submission closes at noon on Monday 26 October. The prize pool is $30,000 across six winners, paid in the equivalent value of XLM. Review is asynchronous using the demo video, pitch deck, GitHub repo and submission answers; finalists pitch on 28 October. AI-assisted development is allowed. The stated judging priority is Adoption, Discovery, then Continuation. [Event overview](https://www.hackmeridian.com/), [build guide](https://www.hackmeridian.com/build).

The [official schedule](https://www.hackmeridian.com/schedule) explicitly places all times in Lisbon local time and lists submissions closing Monday 26 October at 12:00. This is noon Europe/Lisbon (UTC+0 on that date). Portal media limits, complete answer fields and private-repo reviewer access instructions remain unverified; the public portal exposes login only.

## What to show judges

Lead with the buyer and supplier, then show their trade. Explain the value of an upfront quote, a supplier’s chosen margin and selected payment disclosure. The €20 / 22 USDC offer is illustrative, not a market rate or guaranteed saving. Keep the main journey to one trade and use a clearly separate held order for recovery.

The [published rubric](https://www.hackmeridian.com/build) gives 20% each to alignment and user value, 15% each to technical execution and innovation, then 10% each to hackathon progress, market/ecosystem potential and UX. Explain how Stellar Smart Contracts hold the tokens and enforce a one-use release. Keep synthetic screens, the historical local-WASM result and mocked browser/chain recovery distinct. The operator sees disclosed fields and Stellar settlement is public; no guaranteed privacy, fee saving or live payout is claimed. Make the first proposed pilot concrete.

Stellar Composed is the likely Genesis track to discuss, based on the proposed combination of payment proofs and Stellar settlement. Track eligibility and the treatment of preparatory code should be confirmed with organizers. This repo does not claim eligibility or a prize category.

## Submission checklist

- [ ] Confirm path, track and treatment of preparatory work with organizers.
- [x] Update the README with the integrated local scope and live gaps.
- [x] Prepare a local silent demo and deck with synthetic, mocked and unfinished parts clearly labeled; see the [media handoff](release/submission-package.md).
- [ ] Reconcile the rendered presentation with the latest buyer/supplier narrative and Stellar Smart Contracts terminology; verify any revised exports separately.
- [ ] Confirm the portal's media limits and review/upload the final materials.
- [ ] Add verified testnet contract and transaction links.
- [x] Include the operator trust model and approved mutual recovery policy.
- [ ] Give the required reviewers access to this private repo; keep bank material out.
- [ ] Submit video, deck, repo and answers before the deadline.

## Questions to resolve on site

Is the operator-signed payment claim a useful first trust model? What evidence would judges need to distinguish this from a simulated on-ramp? Which first user group and pilot would add the most value to Stellar? Confirm how preparation work should be described and whether the selected path/track is eligible.
