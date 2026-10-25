# Development handoff

Objective: finish one Revolut-to-Stellar P2P trade, starting from the payment-proof gate.

The packaged source lives in the private `vmichalik/stellar-p2p` repository on `main`. Use `git rev-parse HEAD` and `git status --short` to identify the exact revision and local changes before resuming. This is a new repo containing the prototype baseline; its initial commit date is the packaging date, not evidence that every experiment happened that day.

The original experiments ran on a remote Mac mini. The TLSNotary extension is installed in Chrome on Windows. Those machines do not share browser profiles, local files or loopback addresses.

The earlier private test services are separate from this checkout. Packaging this repo does not move, restart or publish them. Their runtime configuration and logs stay outside Git. Recheck readiness before reusing a service; an old command-session handle does not prove it is running.

## First actions in this checkout

1. Run `npm test` and `npm run check`.
2. Read [status](status.md) before making a live proof claim.
3. Prepare the pinned verifier and HTTPS route using [setup](setup.md).
4. Reproduce `/extension-check/` on the actual Windows device.
5. Only then revisit the authenticated response-shape check with the account owner’s approval.

## Current boundary

Public proof completed historically; authenticated TLSNotary payment proof unresolved. No payment-policy signer, TLSNotary-compatible contract, deployed escrow or settlement is established. The earlier Reclaim code is archived and should not be used as the active proof service.

## Keeping the repo clean

Use synthetic fixtures. Keep credentials, bank identifiers, proof transcripts and runtime logs in private local storage. Review the staged content before every push; an ignore rule cannot protect a file already tracked in Git. Record new live checks with the actual host, date, result and limitations, without publishing private account details.
