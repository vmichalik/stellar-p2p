# Pactlane protocol v1

Status: frozen `pactlane.protocol.v1` integration snapshot for the first whole-offer EUR/Revolut escrow. The Rust contract's `PaymentClaim` wire format is unchanged. This specification fixes the previously open identity encodings. The reference JS implementation and public synthetic vectors live in `protocol/`.

Encoder SHA-256: `08e73cbd4d2507ef85c62317638a4d4fcefd922d9de1ba3822793450cbd2127e`. Vector-file SHA-256: `354e82ac989709a518b150506ec7424601e7a6ed8d63e20e3825ef7e026e3dcb`. Pin both the source revision and these hashes when copying the reference into another worktree. Do not silently mix a vendored encoder with a different snapshot.

## Identity input contract

All source identities are opaque, case-sensitive ASCII strings of 1–256 bytes, each byte in `0x21..0x7e` (no whitespace). Do not trim, lowercase, Unicode-normalize, parse as numbers, or substitute display names, recipient labels, URL parameters, browser callbacks, or cookies. Provider-specific canonicalization belongs in the verified-evidence adapter and must be fixed before signing; the protocol hashes the resulting exact bytes.

- `recipient_id`: stable provider-issued identifier for the recipient represented in the immutable offer's payment instructions and the authenticated outgoing transfer.
- `payer_scope`: stable provider-issued identity of the sending account. It namespaces payment IDs that may only be unique within an account. It is an account identifier, never an authentication token. It must come from verified evidence or an independently authenticated verifier/account binding.
- `payment_id`: stable provider-issued identity of the outgoing transfer, obtained from verified evidence. Retries, receipts and alternative views of the same transfer must map to this same identity.
- `recipient_salt`: 32 nonzero-as-a-whole random bytes, generated once for the offer using a cryptographically secure RNG. Keep the salt and bank identifiers off chain; share them with the policy service through the authorized offer-data channel. The public vectors use a predictable synthetic salt only.

`revolut` is the fixed rail symbol. `https://app.revolut.com` is the fixed ASCII source-origin byte string, without a trailing slash. Callers cannot override either namespace in v1. These are identity requirements, not a claim that the current TLSNotary plugin has established those fields. Missing or unstable identities block live signing; this spec does not authorize any additional bank disclosure.

| Input | Authority |
| --- | --- |
| Recipient ID in outgoing payment | Verified provider evidence; compare against the offer's configured recipient ID |
| Configured recipient ID and salt | Authenticated seller offer configuration whose hash matches immutable `Terms.recipient` |
| Payer scope and payment ID | Verified provider evidence or an independently authenticated verifier/account binding; never a client label |
| Seller/buyer/token/amounts/currency/rail/reservation/deadline | Current on-chain order and immutable deployment configuration |
| Payment state, direction, recipient, amount/currency and payment timestamp | Verified provider evidence, interpreted by the strict payment-policy adapter |
| Claim expiry | Policy's explicit bounded validity decision, after verifying evidence and current order/ledger time |
| Network and escrow address | Trusted deployment configuration, checked against the network/order queried |

The shape/semantics check has not established source-account or recipient identity availability. If either required verified identity is missing, reject live signing and leave the order held. Do not replace missing values with a recipient display name, a browser-provided identifier or the order's expected value.

## Recipient commitment

```text
recipient_xdr = ScVal-XDR([
  Symbol("PACTLANE_RECIPIENT_V1"),
  Symbol("revolut"),
  Bytes(ASCII("https://app.revolut.com")),
  Bytes(ASCII(recipient_id)),
  Bytes(recipient_salt)                  // exactly 32 bytes
])
recipient = SHA256(recipient_xdr)        // raw 32 bytes
```

The resulting `recipient` is used unchanged in `Terms.recipient` and `PaymentClaim.recipient`. The salt and identity are not stored on chain. Salting prevents straightforward precomputation when the salt remains private; disclosure and low-entropy identifiers still have privacy limits. Reusing a salt across offers can permit linkage.

## Payment nullifier

```text
payment_identity_xdr = ScVal-XDR([
  Symbol("PACTLANE_NULLIFIER_V1"),
  Symbol("revolut"),
  Bytes(ASCII("https://app.revolut.com")),
  Bytes(ASCII(payer_scope)),
  Bytes(ASCII(payment_id))
])
nullifier = SHA256(payment_identity_xdr) // raw 32 bytes
```

Do not include order ID, contract address, network, recipient, amount, timestamps, a random salt, or a request/session ID in this payload. Changing any of those must not make the same payment reusable. The policy service must ensure a single authenticated sending account always maps to one canonical `payer_scope`; aliases cannot create new identities for the same payment. This is deterministic pseudonymization, not anonymity.

The contract's persistent used-nullifier set is per deployment. The policy service must maintain a durable global consumption registry keyed by this same nullifier across every deployment and network it serves. Reserve issuance atomically before signing; retries for the same order must return the same claim rather than issuing it for another order. Confirm chain outcome and reconcile failed/unknown submissions before releasing an issuance reservation.

`resolve` has no proof and therefore no payment nullifier. Before authorizing manual resolution of an actual fiat payment, reconcile its identity with the policy registry and mark it consumed even when tokens are refunded or split. Reconcile `Resolved` orders/events with off-chain recovery records; do not infer a payment identity from an event that does not carry it. An unresolved or unknown identity remains blocked for further signing.

## Signed release claim

```text
network_id = SHA256(UTF8(network_passphrase))
claim_xdr = ScVal-XDR([
  Symbol("PACTLANE_PAYMENT_V1"),
  Bytes(network_id),
  Address(escrow_contract),
  PaymentClaim
])
digest = SHA256(claim_xdr)
signature = Ed25519.Sign(policy_private_key, digest)
```

The Ed25519 message is the 32 raw digest bytes, not hex/base64 text, an Ethereum personal message, a transaction, or Stellar authorization XDR. The constructor takes the corresponding 32 raw public-key bytes. The contract address must be a canonical `C...` address; buyer/seller may be canonical `G...` or `C...` addresses. Multiplexed addresses are outside this first version.

`PaymentClaim` is a ScVal map with symbol keys in this exact lexical order:

| Key | ScVal type |
| --- | --- |
| `buyer` | Address |
| `currency` | Symbol (`EUR`) |
| `expires_at` | U64 |
| `fiat_minor` | I128 (EUR cents) |
| `nullifier` | Bytes (32) |
| `order_id` | U64 |
| `paid_at` | U64 |
| `pay_by` | U64 |
| `rail` | Symbol (`revolut`) |
| `recipient` | Bytes (32) |
| `reserved_at` | U64 |
| `seller` | Address |
| `token` | Address |
| `token_amount` | I128 (token base units) |

XDR includes the outer ScVal vector discriminant, presence marker and length, and the map presence marker/length. Strings used as identities/origin are **Bytes**, not ScVal String or Symbol. Monetary values and timestamps in JSON vectors are canonical decimal strings. JS callers use `bigint` or those strings; the reference encoder rejects JS Numbers, leading zeros, signs and overflow. It also rejects missing/extra claim fields, unknown rails/currencies, noncanonical addresses and malformed byte encodings.

The reference encoder validates encoding and basic domain constraints; it does not authorize signing or replace the policy's source/order/time checks. The contract still enforces exact order terms, `locked_at <= paid_at < pay_by`, `paid_at <= ledger_time`, `expires_at > ledger_time`, and an unused nullifier. A later proof of an in-window payment can release after `pay_by`.

## Shared artifacts and compatibility

- `protocol/protocol.mjs`: strict JS reference encoder using the pinned official Stellar SDK.
- `protocol/vectors.json`: public synthetic inputs and exact identity XDR, claim XDR, digest, Ed25519 public key and signature.
- `protocol/protocol.test.mjs`: independently reproduces the frozen vectors and tests identity/domain/precision rejection.
- Rust tests consume the same frozen vectors, compute identity commitments with Soroban `ToXdr`, compare `claim_digest`, and submit the vector signature through actual escrow `release`. The tests run in native and compiled-WASM modes.

Identity preimages in vectors are deliberately fake. Their public fixture signing seed is test-only and must never be a deployment signer. Regeneration is an explicit local command, not part of the normal test path; review every changed vector as a protocol change.

Live integration remains blocked until the verified-evidence adapter establishes the required stable identities and units. A real token, signing public key, source account, RPC provider and deployed address must come from the separately authorized deployment configuration. No testnet account, signer or deployment is created by the protocol tooling.
