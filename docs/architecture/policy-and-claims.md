# Payment policy and one-use claims

The payment service answers one question: does this authenticated payment satisfy this locked order?

It checks the bank source, completed outgoing state, recipient, approved payer binding, exact EUR cents and completion time. The payment must complete at or after the lock and before the payment deadline. Verification may finish later.

## Sign the trade, not a browser assertion

The policy constructs the claim from trusted evidence and a confirmed chain snapshot. The claim includes the network, escrow address, order, parties, token, amounts, recipient commitment, payment time, expiry and nullifier. Ed25519 signs the raw SHA-256 digest of canonical ScVal-XDR. Shared vectors keep JavaScript and Rust encoding identical.

## Remember each payment

The nullifier is derived from the bank source, verified payer scope and stable payment ID. It excludes the order and deployment, so moving a payment to another order cannot give it a fresh identity.

Before signing, SQLite records the payment/order reservation. A restart or uncertain response does not remove it. A repeated request for the same valid order can return the stored claim; another order is rejected. The contract also checks its own used-payment set.

## Reconcile recovery

Both wallets can resolve a held order without a payment claim. The policy must still account for any bank payment associated with that recovery. An unidentified manual resolution holds further signing until the reconciler records the complete payment manifest.

See [policy APIs and storage](../../policy/README.md) for adapters, checkpoints and error boundaries.
