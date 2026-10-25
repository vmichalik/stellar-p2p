extern crate std;

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, IssuerFlags, Ledger, MockAuth, MockAuthInvoke},
    token, IntoVal,
};

struct Fixture {
    env: Env,
    contract: Address,
    token: Address,
    seller: Address,
    buyer: Address,
    key: SigningKey,
}

impl Fixture {
    fn new() -> Self {
        let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        env.ledger().set_network_id([7; 32]);
        let admin = Address::generate(&env);
        let seller = Address::generate(&env);
        let buyer = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(admin);
        asset.issuer().set_flag(IssuerFlags::RevocableFlag);
        let token = asset.address();
        token::StellarAssetClient::new(&env, &token).mint(&seller, &1_000_000);
        // Public synthetic test seed, never used outside this test environment.
        let key = SigningKey::from_bytes(&[42; 32]);
        let args = (
            token.clone(),
            BytesN::from_array(&env, &key.verifying_key().to_bytes()),
        );
        // Native and WASM registration otherwise choose different IDs. Freeze
        // the explicit test deployment so both execute the same signed domain.
        let contract = Address::generate(&env);
        let contract = if let Ok(path) = std::env::var("PACTLANE_ESCROW_WASM") {
            let wasm = std::fs::read(path).expect("compiled escrow WASM");
            env.register_at(&contract, wasm.as_slice(), args)
        } else {
            env.register_at(&contract, Escrow, args)
        };
        Self {
            env,
            contract,
            token,
            seller,
            buyer,
            key,
        }
    }

    fn client(&self) -> EscrowClient<'_> {
        EscrowClient::new(&self.env, &self.contract)
    }

    fn terms(&self) -> Terms {
        Terms {
            seller: self.seller.clone(),
            token_amount: 100_000,
            fiat_minor: 950,
            currency: symbol_short!("EUR"),
            rail: symbol_short!("revolut"),
            recipient: BytesN::from_array(&self.env, &[3; 32]),
            offer_expires_at: 4_000,
            reservation_seconds: 600,
        }
    }

    fn paying(&self) -> u64 {
        let id = self.client().fund(&self.terms());
        self.client().reserve(&id, &self.buyer);
        self.client().begin_payment(&id);
        id
    }

    fn claim(&self, id: u64) -> PaymentClaim {
        let order = self.client().get_order(&id);
        PaymentClaim {
            order_id: id,
            seller: self.seller.clone(),
            buyer: self.buyer.clone(),
            token: self.token.clone(),
            token_amount: order.terms.token_amount,
            fiat_minor: order.terms.fiat_minor,
            currency: order.terms.currency,
            rail: order.terms.rail,
            recipient: order.terms.recipient,
            reserved_at: order.reserved_at,
            pay_by: order.pay_by,
            paid_at: 1_050,
            expires_at: 1_900,
            nullifier: BytesN::from_array(&self.env, &[5; 32]),
        }
    }

    fn sign(&self, claim: &PaymentClaim) -> BytesN<64> {
        let digest = self.client().claim_digest(claim).to_array();
        BytesN::from_array(&self.env, &self.key.sign(&digest).to_bytes())
    }

    fn balance(&self, address: &Address) -> i128 {
        token::Client::new(&self.env, &self.token).balance(address)
    }
}

#[test]
fn funding_moves_exact_tokens_and_allocates_unique_ids() {
    let f = Fixture::new();
    let first = f.client().fund(&f.terms());
    let second = f.client().fund(&f.terms());
    assert_eq!((first, second), (0, 1));
    assert_eq!(f.balance(&f.seller), 800_000);
    assert_eq!(f.balance(&f.contract), 200_000);
    assert_eq!(f.client().get_order(&first).state, State::Funded);
    assert_eq!(f.client().get_config().token, f.token);
}

#[test]
fn invalid_terms_cannot_move_funds() {
    let f = Fixture::new();
    for field in 0..10 {
        let mut terms = f.terms();
        match field {
            0 => terms.token_amount = 0,
            1 => terms.token_amount = -1,
            2 => terms.fiat_minor = 0,
            3 => terms.currency = symbol_short!("USD"),
            4 => terms.rail = symbol_short!("other"),
            5 => terms.recipient = BytesN::from_array(&f.env, &[0; 32]),
            6 => terms.reservation_seconds = 0,
            7 => terms.reservation_seconds = MAX_RESERVATION_SECONDS + 1,
            8 => terms.offer_expires_at = 1_000,
            _ => terms.offer_expires_at = 1_001 + MAX_OFFER_SECONDS,
        }
        assert_eq!(f.client().try_fund(&terms), Err(Ok(Error::InvalidTerms)));
    }
    assert_eq!(f.balance(&f.seller), 1_000_000);
    assert_eq!(f.balance(&f.contract), 0);
    assert_eq!(f.client().fund(&f.terms()), 0);
}

#[test]
fn failed_deposit_rolls_back_order_and_id_allocation() {
    let f = Fixture::new();
    let mut terms = f.terms();
    terms.token_amount = 1_000_001;
    assert!(f.client().try_fund(&terms).is_err());
    assert_eq!(f.client().try_get_order(&0), Err(Ok(Error::NotFound)));
    assert_eq!(f.client().fund(&f.terms()), 0);
}

#[test]
fn seller_authorization_is_required_for_funding_and_cancellation() {
    let f = Fixture::new();
    f.env.set_auths(&[]);
    assert!(f.client().try_fund(&f.terms()).is_err());
    f.env.mock_all_auths();
    let id = f.client().fund(&f.terms());
    f.env.set_auths(&[]);
    assert!(f.client().try_refund(&id).is_err());
    assert_eq!(f.balance(&f.contract), 100_000);
    f.env.mock_all_auths();
    f.client().refund(&id);
    assert_eq!(f.balance(&f.seller), 1_000_000);
}

#[test]
fn reserve_and_begin_payment_require_the_correct_buyer() {
    let f = Fixture::new();
    let id = f.client().fund(&f.terms());
    f.env.set_auths(&[]);
    assert!(f.client().try_reserve(&id, &f.buyer).is_err());
    f.env.mock_all_auths();
    f.client().reserve(&id, &f.buyer);
    f.env.set_auths(&[]);
    assert!(f.client().try_begin_payment(&id).is_err());
    let stranger = Address::generate(&f.env);
    let invocation = MockAuthInvoke {
        contract: &f.contract,
        fn_name: "begin_payment",
        args: (id,).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth { address: &stranger, invoke: &invocation }]);
    assert!(f.client().try_begin_payment(&id).is_err());
    f.env.mock_auths(&[MockAuth { address: &f.buyer, invoke: &invocation }]);
    assert_eq!(f.client().begin_payment(&id).state, State::Paying);
}

#[test]
fn seller_and_escrow_cannot_be_the_buyer_and_second_reservation_fails() {
    let f = Fixture::new();
    let id = f.client().fund(&f.terms());
    assert_eq!(f.client().try_reserve(&id, &f.seller), Err(Ok(Error::InvalidBuyer)));
    assert_eq!(f.client().try_reserve(&id, &f.contract), Err(Ok(Error::InvalidBuyer)));
    f.client().reserve(&id, &f.buyer);
    assert_eq!(f.client().try_reserve(&id, &Address::generate(&f.env)), Err(Ok(Error::WrongState)));
}

#[test]
fn expired_offer_cannot_be_reserved() {
    let f = Fixture::new();
    let id = f.client().fund(&f.terms());
    f.env.ledger().set_timestamp(4_000);
    assert_eq!(f.client().try_reserve(&id, &f.buyer), Err(Ok(Error::Expired)));
    f.client().refund(&id);
    assert_eq!(f.balance(&f.seller), 1_000_000);
}

#[test]
fn reservation_deadline_is_capped_by_offer_expiry() {
    let f = Fixture::new();
    let id = f.client().fund(&f.terms());
    f.env.ledger().set_timestamp(3_900);
    assert_eq!(f.client().reserve(&id, &f.buyer).pay_by, 4_000);
}

#[test]
fn unused_reservation_can_only_be_refunded_at_or_after_deadline() {
    let f = Fixture::new();
    let id = f.client().fund(&f.terms());
    f.client().reserve(&id, &f.buyer);
    f.env.ledger().set_timestamp(1_599);
    assert_eq!(f.client().try_refund(&id), Err(Ok(Error::TooEarly)));
    f.env.ledger().set_timestamp(1_600);
    assert_eq!(f.client().try_begin_payment(&id), Err(Ok(Error::Expired)));
    f.env.set_auths(&[]);
    f.client().refund(&id);
    assert_eq!(f.balance(&f.seller), 1_000_000);
    assert_eq!(f.client().get_order(&id).state, State::Refunded);
    assert_eq!(f.client().try_refund(&id), Err(Ok(Error::WrongState)));
    f.env.mock_all_auths();
    assert_eq!(f.client().try_reserve(&id, &f.buyer), Err(Ok(Error::WrongState)));
}

#[test]
fn payment_lock_never_expires_into_a_seller_refund() {
    let f = Fixture::new();
    let id = f.paying();
    for now in [1_000, 1_600, 100_000] {
        f.env.ledger().set_timestamp(now);
        assert_eq!(f.client().try_refund(&id), Err(Ok(Error::WrongState)));
    }
    assert_eq!(f.balance(&f.contract), 100_000);
}

#[test]
fn valid_signature_releases_once_without_relayer_authorization() {
    let f = Fixture::new();
    let id = f.paying();
    let claim = f.claim(id);
    let signature = f.sign(&claim);
    f.env.ledger().set_timestamp(1_100);
    f.env.set_auths(&[]);
    f.client().release(&claim, &signature);
    assert_eq!(f.balance(&f.buyer), 100_000);
    assert_eq!(f.balance(&f.contract), 0);
    assert!(f.client().payment_used(&claim.nullifier));
    assert_eq!(f.client().get_order(&id).state, State::Released);
    assert_eq!(f.client().try_release(&claim, &signature), Err(Ok(Error::WrongState)));
}

#[test]
fn same_payment_cannot_settle_a_different_funded_order() {
    let f = Fixture::new();
    let first = f.paying();
    let second = f.paying();
    f.env.ledger().set_timestamp(1_100);
    let first_claim = f.claim(first);
    let second_claim = f.claim(second);
    f.client().release(&first_claim, &f.sign(&first_claim));
    assert_eq!(f.client().try_release(&second_claim, &f.sign(&second_claim)), Err(Ok(Error::PaymentUsed)));
    assert_eq!(f.balance(&f.buyer), 100_000);
    assert_eq!(f.balance(&f.contract), 100_000);
    assert_eq!(f.client().get_order(&second).state, State::Paying);
}

#[test]
fn freshly_signed_claims_with_wrong_order_terms_are_rejected() {
    let f = Fixture::new();
    let id = f.paying();
    f.env.ledger().set_timestamp(1_100);
    for field in 0..11 {
        let mut claim = f.claim(id);
        match field {
            0 => claim.seller = Address::generate(&f.env),
            1 => claim.buyer = Address::generate(&f.env),
            2 => claim.token = Address::generate(&f.env),
            3 => claim.token_amount += 1,
            4 => claim.fiat_minor += 1,
            5 => claim.currency = symbol_short!("USD"),
            6 => claim.rail = symbol_short!("other"),
            7 => claim.recipient = BytesN::from_array(&f.env, &[8; 32]),
            8 => claim.reserved_at += 1,
            9 => claim.pay_by += 1,
            _ => claim.nullifier = BytesN::from_array(&f.env, &[0; 32]),
        }
        assert_eq!(f.client().try_release(&claim, &f.sign(&claim)), Err(Ok(Error::ClaimMismatch)));
    }
    assert_eq!(f.balance(&f.contract), 100_000);
}

#[test]
fn payment_time_must_follow_lock_and_precede_deadline_and_current_time() {
    let f = Fixture::new();
    let id = f.paying();
    f.env.ledger().set_timestamp(1_100);
    for paid_at in [999, 1_101, 1_600] {
        let mut claim = f.claim(id);
        claim.paid_at = paid_at;
        assert_eq!(f.client().try_release(&claim, &f.sign(&claim)), Err(Ok(Error::InvalidPaymentTime)));
    }
}

#[test]
fn claim_expiry_is_strict_but_a_timely_payment_can_be_proven_later() {
    let f = Fixture::new();
    let id = f.paying();
    let mut claim = f.claim(id);
    f.env.ledger().set_timestamp(claim.expires_at);
    assert_eq!(f.client().try_release(&claim, &f.sign(&claim)), Err(Ok(Error::Expired)));
    claim.expires_at = 2_500;
    f.client().release(&claim, &f.sign(&claim));
    assert_eq!(f.balance(&f.buyer), 100_000);
}

#[test]
fn payment_just_before_deadline_can_settle() {
    let f = Fixture::new();
    let id = f.paying();
    let mut claim = f.claim(id);
    claim.paid_at = claim.pay_by - 1;
    f.env.ledger().set_timestamp(claim.pay_by);
    f.client().release(&claim, &f.sign(&claim));
    assert_eq!(f.balance(&f.buyer), 100_000);
}

#[test]
fn reserved_order_cannot_release_before_payment_lock() {
    let f = Fixture::new();
    let id = f.client().fund(&f.terms());
    f.client().reserve(&id, &f.buyer);
    let claim = f.claim(id);
    f.env.ledger().set_timestamp(1_100);
    assert_eq!(f.client().try_release(&claim, &f.sign(&claim)), Err(Ok(Error::WrongState)));
}

#[test]
fn signature_from_untrusted_key_is_rejected() {
    let f = Fixture::new();
    let id = f.paying();
    let claim = f.claim(id);
    let digest = f.client().claim_digest(&claim).to_array();
    let other = SigningKey::from_bytes(&[43; 32]);
    let signature = BytesN::from_array(&f.env, &other.sign(&digest).to_bytes());
    f.env.ledger().set_timestamp(1_100);
    assert!(f.client().try_release(&claim, &signature).is_err());
    assert!(!f.client().payment_used(&claim.nullifier));
    assert_eq!(f.balance(&f.contract), 100_000);
}

#[test]
fn signature_binds_even_semantically_valid_claim_changes() {
    let f = Fixture::new();
    let id = f.paying();
    let original = f.claim(id);
    let signature = f.sign(&original);
    f.env.ledger().set_timestamp(1_100);
    for field in 0..3 {
        let mut changed = original.clone();
        match field {
            0 => changed.paid_at += 1,
            1 => changed.expires_at += 1,
            _ => changed.nullifier = BytesN::from_array(&f.env, &[8; 32]),
        }
        assert!(f.client().try_release(&changed, &signature).is_err());
    }
    assert!(!f.client().payment_used(&original.nullifier));
}

#[test]
fn signature_cannot_be_reused_for_another_order() {
    let f = Fixture::new();
    let first = f.paying();
    let second = f.paying();
    let original = f.claim(first);
    let signature = f.sign(&original);
    let changed = f.claim(second);
    f.env.ledger().set_timestamp(1_100);
    assert!(f.client().try_release(&changed, &signature).is_err());
    assert!(!f.client().payment_used(&original.nullifier));
}

#[test]
fn signature_is_bound_to_network() {
    let f = Fixture::new();
    let id = f.paying();
    let claim = f.claim(id);
    let signature = f.sign(&claim);
    f.env.ledger().set_network_id([9; 32]);
    f.env.ledger().set_timestamp(1_100);
    assert!(f.client().try_release(&claim, &signature).is_err());
}

#[test]
fn signature_is_bound_to_contract_deployment() {
    let f = Fixture::new();
    let id = f.paying();
    let claim = f.claim(id);
    let wrong_contract = Address::generate(&f.env);
    let payload = (
        Symbol::new(&f.env, "PACTLANE_PAYMENT_V1"),
        f.env.ledger().network_id(),
        wrong_contract,
        claim.clone(),
    )
        .to_xdr(&f.env);
    let digest = f.env.crypto().sha256(&payload).to_bytes().to_array();
    let signature = BytesN::from_array(&f.env, &f.key.sign(&digest).to_bytes());
    f.env.ledger().set_timestamp(1_100);
    assert!(f.client().try_release(&claim, &signature).is_err());
}

#[test]
fn token_transfer_failure_does_not_consume_payment_or_change_order() {
    let f = Fixture::new();
    let id = f.paying();
    let claim = f.claim(id);
    let signature = f.sign(&claim);
    f.env.ledger().set_timestamp(1_100);
    let asset = token::StellarAssetClient::new(&f.env, &f.token);
    asset.set_authorized(&f.contract, &false);
    assert!(f.client().try_release(&claim, &signature).is_err());
    assert!(!f.client().payment_used(&claim.nullifier));
    assert_eq!(f.client().get_order(&id).state, State::Paying);
    assert_eq!(f.balance(&f.buyer), 0);
    asset.set_authorized(&f.contract, &true);
    f.client().release(&claim, &signature);
    assert!(f.client().payment_used(&claim.nullifier));
    assert_eq!(f.balance(&f.buyer), 100_000);
}

#[test]
fn mutual_resolution_requires_both_wallets_for_exact_split() {
    let f = Fixture::new();
    let id = f.paying();
    let invocation = MockAuthInvoke {
        contract: &f.contract,
        fn_name: "resolve",
        args: (id, 40_000i128).into_val(&f.env),
        sub_invokes: &[],
    };
    f.env.mock_auths(&[MockAuth { address: &f.seller, invoke: &invocation }]);
    assert!(f.client().try_resolve(&id, &40_000).is_err());
    f.env.mock_auths(&[MockAuth { address: &f.buyer, invoke: &invocation }]);
    assert!(f.client().try_resolve(&id, &40_000).is_err());
    f.env.mock_auths(&[
        MockAuth { address: &f.seller, invoke: &invocation },
        MockAuth { address: &f.buyer, invoke: &invocation },
    ]);
    assert!(f.client().try_resolve(&id, &40_001).is_err());
    f.env.mock_auths(&[
        MockAuth { address: &f.seller, invoke: &invocation },
        MockAuth { address: &f.buyer, invoke: &invocation },
    ]);
    f.client().resolve(&id, &40_000);
    assert_eq!(f.balance(&f.buyer), 40_000);
    assert_eq!(f.balance(&f.seller), 960_000);
    assert_eq!(f.balance(&f.contract), 0);
    assert_eq!(f.client().get_order(&id).state, State::Resolved);
    assert_eq!(f.client().try_refund(&id), Err(Ok(Error::WrongState)));
}

#[test]
fn resolution_rejects_invalid_amounts_and_supports_full_refund_or_release() {
    for buyer_tokens in [0, 100_000] {
        let f = Fixture::new();
        let id = f.paying();
        assert_eq!(f.client().try_resolve(&id, &-1), Err(Ok(Error::InvalidSplit)));
        assert_eq!(f.client().try_resolve(&id, &100_001), Err(Ok(Error::InvalidSplit)));
        f.client().resolve(&id, &buyer_tokens);
        assert_eq!(f.balance(&f.buyer), buyer_tokens);
        assert_eq!(f.balance(&f.seller), 1_000_000 - buyer_tokens);
        assert_eq!(f.balance(&f.contract), 0);
    }
}

#[test]
fn failed_second_resolution_transfer_rolls_back_first_transfer() {
    let f = Fixture::new();
    let id = f.paying();
    let asset = token::StellarAssetClient::new(&f.env, &f.token);
    asset.set_authorized(&f.seller, &false);
    assert!(f.client().try_resolve(&id, &40_000).is_err());
    assert_eq!(f.balance(&f.buyer), 0);
    assert_eq!(f.balance(&f.contract), 100_000);
    assert_eq!(f.client().get_order(&id).state, State::Paying);
}

fn protocol_vectors() -> serde_json::Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("protocol/vectors.json");
    let input = std::fs::read_to_string(path).expect("frozen public protocol vectors");
    serde_json::from_str(&input).expect("valid vector JSON")
}

fn vector_str<'a>(value: &'a serde_json::Value, key: &str) -> &'a str {
    value[key].as_str().expect("vector string")
}

fn vector_hex<const N: usize>(env: &Env, value: &str) -> BytesN<N> {
    let bytes: [u8; N] = hex::decode(value).unwrap().try_into().unwrap();
    BytesN::from_array(env, &bytes)
}

fn vector_address(env: &Env, value: &str) -> Address {
    Address::from_string(&soroban_sdk::String::from_str(env, value))
}

fn vector_claim(env: &Env, value: &serde_json::Value) -> PaymentClaim {
    PaymentClaim {
        order_id: vector_str(value, "order_id").parse().unwrap(),
        seller: vector_address(env, vector_str(value, "seller")),
        buyer: vector_address(env, vector_str(value, "buyer")),
        token: vector_address(env, vector_str(value, "token")),
        token_amount: vector_str(value, "token_amount").parse().unwrap(),
        fiat_minor: vector_str(value, "fiat_minor").parse().unwrap(),
        currency: Symbol::new(env, vector_str(value, "currency")),
        rail: Symbol::new(env, vector_str(value, "rail")),
        recipient: vector_hex(env, vector_str(value, "recipient")),
        reserved_at: vector_str(value, "reserved_at").parse().unwrap(),
        pay_by: vector_str(value, "pay_by").parse().unwrap(),
        paid_at: vector_str(value, "paid_at").parse().unwrap(),
        expires_at: vector_str(value, "expires_at").parse().unwrap(),
        nullifier: vector_hex(env, vector_str(value, "nullifier")),
    }
}

#[test]
fn shared_identity_xdr_and_commitments_match_soroban_encoding() {
    let f = Fixture::new();
    let fixture = protocol_vectors();
    assert_eq!(fixture["version"], "pactlane.protocol.v1");
    for vector in fixture["vectors"].as_array().unwrap() {
        let identities = &vector["identities"];
        let origin = Bytes::from_slice(&f.env, b"https://app.revolut.com");
        let salt: BytesN<32> = vector_hex(&f.env, vector_str(identities, "recipient_salt"));
        let recipient_xdr = (
            Symbol::new(&f.env, "PACTLANE_RECIPIENT_V1"),
            symbol_short!("revolut"),
            origin.clone(),
            Bytes::from_slice(&f.env, vector_str(identities, "recipient_id").as_bytes()),
            salt,
        )
            .to_xdr(&f.env);
        assert_eq!(recipient_xdr, Bytes::from_slice(
            &f.env, &hex::decode(vector_str(vector, "recipient_xdr_hex")).unwrap()
        ));
        let recipient: BytesN<32> = vector_hex(&f.env, vector_str(&vector["claim"], "recipient"));
        assert_eq!(f.env.crypto().sha256(&recipient_xdr).to_bytes(), recipient);
        let nullifier_xdr = (
            Symbol::new(&f.env, "PACTLANE_NULLIFIER_V1"),
            symbol_short!("revolut"),
            origin,
            Bytes::from_slice(&f.env, vector_str(identities, "payer_scope").as_bytes()),
            Bytes::from_slice(&f.env, vector_str(identities, "payment_id").as_bytes()),
        )
            .to_xdr(&f.env);
        assert_eq!(nullifier_xdr, Bytes::from_slice(
            &f.env, &hex::decode(vector_str(vector, "payment_identity_xdr_hex")).unwrap()
        ));
        let nullifier: BytesN<32> = vector_hex(&f.env, vector_str(&vector["claim"], "nullifier"));
        assert_eq!(f.env.crypto().sha256(&nullifier_xdr).to_bytes(), nullifier);
    }
}

#[test]
fn shared_claim_vectors_match_actual_contract_digest_and_js_signature() {
    let f = Fixture::new();
    let fixture = protocol_vectors();
    assert_eq!(
        f.key.verifying_key().to_bytes(),
        vector_hex::<32>(&f.env, vector_str(&fixture, "signer_public_key_hex")).to_array()
    );
    for vector in fixture["vectors"].as_array().unwrap() {
        let network = f.env.crypto().sha256(&Bytes::from_slice(
            &f.env, vector_str(vector, "network_passphrase").as_bytes()
        )).to_bytes();
        assert_eq!(network, vector_hex::<32>(&f.env, vector_str(vector, "network_id_hex")));
        f.env.ledger().set_network_id(network.to_array());
        assert_eq!(f.contract, vector_address(&f.env, vector_str(vector, "contract")));
        let claim = vector_claim(&f.env, &vector["claim"]);
        let payload = (
            Symbol::new(&f.env, "PACTLANE_PAYMENT_V1"),
            network,
            f.contract.clone(),
            claim.clone(),
        )
            .to_xdr(&f.env);
        assert_eq!(payload, Bytes::from_slice(
            &f.env, &hex::decode(vector_str(vector, "claim_xdr_hex")).unwrap()
        ));
        let digest = f.client().claim_digest(&claim);
        assert_eq!(digest, vector_hex::<32>(&f.env, vector_str(vector, "digest_hex")));
        assert_eq!(
            f.key.sign(&digest.to_array()).to_bytes(),
            vector_hex::<64>(&f.env, vector_str(vector, "signature_hex")).to_array()
        );
    }
}

#[test]
fn frozen_js_signature_releases_the_whole_offer_once() {
    let f = Fixture::new();
    let fixture = protocol_vectors();
    let vector = &fixture["vectors"][0];
    assert_eq!(vector["kind"], "settlement");
    let claim = vector_claim(&f.env, &vector["claim"]);
    assert_eq!(claim.seller, f.seller);
    assert_eq!(claim.buyer, f.buyer);
    assert_eq!(claim.token, f.token);
    f.env.ledger().set_network_id(
        vector_hex::<32>(&f.env, vector_str(vector, "network_id_hex")).to_array()
    );
    token::StellarAssetClient::new(&f.env, &f.token).mint(&f.seller, &claim.token_amount);
    let seller_before = f.balance(&f.seller);
    f.env.ledger().set_timestamp(claim.reserved_at - 1);
    let context = &vector["context"];
    let terms = Terms {
        seller: f.seller.clone(),
        token_amount: claim.token_amount,
        fiat_minor: claim.fiat_minor,
        currency: claim.currency.clone(),
        rail: claim.rail.clone(),
        recipient: claim.recipient.clone(),
        offer_expires_at: vector_str(context, "offer_expires_at").parse().unwrap(),
        reservation_seconds: vector_str(context, "reservation_seconds").parse().unwrap(),
    };
    let id = f.client().fund(&terms);
    assert_eq!(id, claim.order_id);
    f.env.ledger().set_timestamp(claim.reserved_at);
    let reserved = f.client().reserve(&id, &f.buyer);
    assert_eq!(reserved.pay_by, claim.pay_by);
    f.env.ledger().set_timestamp(vector_str(context, "locked_at").parse().unwrap());
    f.client().begin_payment(&id);
    f.env.ledger().set_timestamp(vector_str(context, "ledger_time").parse().unwrap());
    let signature = vector_hex::<64>(&f.env, vector_str(vector, "signature_hex"));
    // No mocked relayer/wallet authorization is available to the release.
    f.env.set_auths(&[]);
    f.client().release(&claim, &signature);
    assert_eq!(f.balance(&f.buyer), 220_000_000);
    assert_eq!(f.balance(&f.seller), seller_before - claim.token_amount);
    assert_eq!(f.balance(&f.contract), 0);
    assert_eq!(f.client().get_order(&id).state, State::Released);
    assert!(f.client().payment_used(&claim.nullifier));
    assert_eq!(f.client().try_release(&claim, &signature), Err(Ok(Error::WrongState)));
}
