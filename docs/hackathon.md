# Hackathon notes

The project fits the idea of bringing an existing application pattern to Stellar. Discuss the path with organizers using the actual starting point: a preparation spike exists; the payment-to-escrow product is unfinished.

## Event facts

Checked against the official pages on 25 October 2026: HackMeridian is in Lisbon on 25–26 October. Submission closes at noon on Monday 26 October. The prize pool is $30,000 across six winners, paid in the equivalent value of XLM. Review is asynchronous using the demo video, pitch deck, GitHub repo and submission answers; finalists pitch on 28 October. AI-assisted development is allowed. The stated judging priority is Adoption, Discovery, then Continuation. [Event overview](https://www.hackmeridian.com/), [build guide](https://www.hackmeridian.com/build).

## What to show judges

Explain who needs this, show a working Stellar interaction, and make the next pilot concrete. Keep the demo focused on a single trade. A clear README and evidence of progress will carry more than an ambitious list of future integrations.

Stellar Composed is the likely Genesis track to discuss, based on the proposed combination of payment proofs and Stellar settlement. Track eligibility and the treatment of preparatory code should be confirmed with organizers. This repo does not claim eligibility or a prize category.

## Submission checklist

- [ ] Confirm path, track and treatment of preparatory work with organizers.
- [ ] Update the README with the final implemented scope.
- [ ] Record the demo with live, simulated and unfinished parts clearly labeled.
- [ ] Add verified testnet contract and transaction links.
- [ ] Include the operator trust model and payment-failure recovery policy.
- [ ] Give the required reviewers access to this private repo; keep bank material out.
- [ ] Submit video, deck, repo and answers before the deadline.

## Questions to resolve on site

Can we reuse an existing escrow implementation with order-bound claims? Which Stellar wallet gives the shortest reliable testnet flow? Is a verifier-signed payment claim acceptable for this prototype’s trust model? What would make the next pilot useful to the ecosystem?
