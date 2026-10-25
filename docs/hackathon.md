# Hackathon notes

Pactlane brings an existing P2P on-ramp pattern to Stellar. Show the preparation spike and event progress honestly: the integrated local product is built, while real payment evidence and network settlement remain unfinished.

## Event facts

Checked against the official pages on 25 October 2026: HackMeridian is in Lisbon on 25–26 October. Submission closes at noon on Monday 26 October. The prize pool is $30,000 across six winners, paid in the equivalent value of XLM. Review is asynchronous using the demo video, pitch deck, GitHub repo and submission answers; finalists pitch on 28 October. AI-assisted development is allowed. The stated judging priority is Adoption, Discovery, then Continuation. [Event overview](https://www.hackmeridian.com/), [build guide](https://www.hackmeridian.com/build).

The [official schedule](https://www.hackmeridian.com/schedule) explicitly places all times in Lisbon local time and lists submissions closing Monday 26 October at 12:00. This is noon Europe/Lisbon (UTC+0 on that date). Portal media limits, complete answer fields and private-repo reviewer access instructions remain unverified; the public portal exposes login only.

## What to show judges

Explain who needs this, show a working Stellar interaction, and make the next pilot concrete. Keep the demo focused on a single trade. A clear README and evidence of progress will carry more than an ambitious list of future integrations.

The [published rubric](https://www.hackmeridian.com/build) gives 20% each to alignment and user value, 15% each to technical execution and innovation, then 10% each to hackathon progress, market/ecosystem potential and UX. For Pactlane, spend the demo on the exact trade, confirmed lock, one-use payment and held-funds recovery. Name the operator trust assumption and actual verification limits. A small pilot proposal needs an identified user and measured trade completion, not another payment rail.

Stellar Composed is the likely Genesis track to discuss, based on the proposed combination of payment proofs and Stellar settlement. Track eligibility and the treatment of preparatory code should be confirmed with organizers. This repo does not claim eligibility or a prize category.

## Submission checklist

- [ ] Confirm path, track and treatment of preparatory work with organizers.
- [x] Update the README with the integrated local scope and live gaps.
- [ ] Record the demo with live, simulated and unfinished parts clearly labeled.
- [ ] Add verified testnet contract and transaction links.
- [x] Include the operator trust model and approved mutual recovery policy.
- [ ] Give the required reviewers access to this private repo; keep bank material out.
- [ ] Submit video, deck, repo and answers before the deadline.

## Questions to resolve on site

Is the operator-signed payment claim a useful first trust model? What evidence would judges need to distinguish this from a simulated on-ramp? Which first user group and pilot would add the most value to Stellar? Confirm how preparation work should be described and whether the selected path/track is eligible.
