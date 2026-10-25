# Policy, signatures, and replay protection

The contract does not understand a bank statement. The policy service is the trusted bridge between verified payment evidence and a contract-readable authorization. The current public interface accepts an order ID and opaque evidence ID; server-controlled readers supply the evidence, chain snapshot, private offer data, and signing capability.

## Policy decision path

```mermaid
sequenceDiagram
    participant Caller
    participant Policy
    participant V as Verified-evidence reader
    participant C as Confirmed chain reader
    participant O as Private offer store
    participant R as Durable replay store
    participant K as Ed25519 signer
    Caller->>Policy: issue({orderId, evidenceId})
    Policy->>V: Read evidence by opaque ID
    Policy->>C: Read current order/config/ledger/nullifier state
    Policy->>O: Read recipient salt for this offer
    Policy->>Policy: Validate source semantics, amount, recipient, time, buyer, freshness
    Policy->>R: Check chain checkpoint; atomically reserve nullifier + order binding
    Policy->>K: Sign canonical 32-byte digest
    Policy->>R: Persist signature as issued
    Policy-->>Caller: Claim + signature (live route not yet connected)
```

The payment checks require an order in `Paying`; matching EUR, Revolut, and exact fiat cents; positive token amount; valid reservation/lock/deadline ordering; a completed payment time in the locked interval and no later than the confirmed ledger time; a valid buyer address distinct from seller; and a recomputed recipient commitment matching the stored order. The chain snapshot must be confirmed, bound to the configured network and contract, fresh, and configured with the same signer key.

The live evidence normalizer intentionally throws `TLSN_PAYMENT_SCHEMA_UNVERIFIED`. Synthetic fixture validation is a separate path and its field names are not claims about Revolut's real response schema. The policy skeleton therefore exists, but live issuance is blocked.

## Frozen claim encoding

Protocol v1 signs SHA-256 over canonical ScVal-XDR:

```text
SHA256(ScVal-XDR([
  Symbol("PACTLANE_PAYMENT_V1"),
  Bytes(SHA256(UTF8(network_passphrase))),
  Address(escrow_contract),
  PaymentClaim
]))
```

The Ed25519 message is the raw 32-byte digest. The claim binds order ID; buyer/seller; token address and integer amount; fiat integer amount and currency; rail; recipient commitment; reservation time and `pay_by`; payment time; short expiry; and 32-byte nullifier. Map keys have exact lexical order and exact ScVal types. No JS floating-point monetary numbers are accepted.

The browser or relay may submit the claim. The contract independently compares every term it knows against the stored order, recomputes the digest for its own network and address, checks the configured public key, and only then pays the buyer named by the claim.

## Identity commitments

**Recipient commitment:** `SHA256(ScVal-XDR([PACTLANE_RECIPIENT_V1, revolut, fixed source origin, exact provider recipient ID bytes, 32-byte offer salt]))`. The salt and provider identity stay off chain. The policy recomputes the commitment from evidence plus private offer configuration. A salt reduces simple guessing only while private; it is not encryption or anonymity. Reusing salts may link offers.

**Payment nullifier:** `SHA256(ScVal-XDR([PACTLANE_NULLIFIER_V1, revolut, fixed source origin, exact payer_scope bytes, exact payment_id bytes]))`. It intentionally excludes order, contract, network, amount, recipient, time, and random salt so the same payment cannot become fresh by changing those fields. Identity values are case-sensitive ASCII 1–256 bytes, with no whitespace or normalization. A payer scope namespaces transfer IDs that are unique only within an account; it is an account identity, not a credential.

These are deterministic pseudonyms, not anonymous identities. Required source and recipient identity availability remains unproven for real authenticated evidence.

## Durable replay and recovery control

The SQLite replay store is server-only, WAL-backed, uses full synchronization and restrictive file permissions, and binds each nullifier to an order. An atomic reservation happens before signing. Retries for one order can return the same claim; another order cannot reuse that payment. Records do not expire automatically. An operator must reconcile uncertain chain submissions before resolving holds.

The policy store must span every network/deployment served. Chain checkpoints advance only after relevant events have been processed. If a `Resolved` order appears without a complete manifest of the real payment identities, the store adds a manual hold that blocks all new issuance. Recovery can clear it only after a confirmed complete manifest is read and those payment nullifiers are consumed—even if tokens were split or refunded. An on-chain event alone does not identify the fiat transfer.

The contract's used-nullifier mapping prevents reuse on that deployment. The policy registry prevents reuse across deployments. Both are necessary; neither is a substitute for the other.

A reconciliation hold prevents new policy issuance. It cannot revoke a signature that has already left the signer. An existing claim remains usable until its expiry while the order still satisfies the contract rules. The short claim lifetime limits that interval; a terminal order cannot release again.
