# Bank proof operations

The verifier accepted a complete authenticated Revolut transfer record on 25 October 2026 at 23:08:23.290 UTC. [Acceptance record](../evidence/release/complete-record-accepted.json), [proof stages](proof-status.md).

## Running service

The existing Fly application serves [the public connection check](https://stellar-p2p-proof-vijay.fly.dev/extension-check/) and owner-reviewed transfer checks. The complete-record application image is `sha256:d671ad22140f0e61e8e0f720a21bec0d343298dc79f94ba0a112856c654f5d29`, built from `3da2740`. [Deployment receipt](../evidence/release/complete-record-deployment.json).

The extension uses the pinned TLSNotary API/runtime and the explicit extension-origin allowlist. The [Pactlane extension](https://github.com/vmichalik/pactlane-tlsnotary) includes installation instructions, runtime provenance and release checksums. Keep the installed folder path when updating an unpacked extension so its allowed ID stays stable.

## Record handling

Complete-record mode requires the owner's review of the entire disclosed response: payment details, names, account identifiers, balance and response headers. Request credentials stay redacted. The pinned verifier can emit disclosed bytes at INFO, so this mode suppresses its stdout and stderr. The parent emits only fixed acceptance or rejection codes.

A private loopback callback uses a per-boot internal secret. The callback is not publicly routed. The receiver validates full response coverage and stores normalized fields in a database with mode 0600. A browser success message alone is not server acceptance.

The diagnostic evidence database is ephemeral. Mainnet composition must use durable evidence, replay and transaction stores, plus the approved signer and wallet-to-bank bindings. [Mainnet runbook](release/mainnet-test.md).

## If a check stops

Use the existing attempt's sanitized stage and error code first. Distinguish connection/setup, transcript parsing, disclosure, record acceptance and order-policy rejection. A public check uses the transfer-sized 4 KiB sent / 16 KiB received budgets. It isolates connection behavior without a bank request.

Keep raw bank logs, headers and transcripts local. If timeout cleanup leaves the extension stuck, fully quit Chrome before starting another explicitly requested attempt. A new disclosure is reviewed in the extension; operational diagnostics never bypass the order policy or release funds.
