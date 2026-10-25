#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, xdr::ToXdr,
    Address, Bytes, BytesN, Env, Symbol,
};

const MAX_OFFER_SECONDS: u64 = 7 * 24 * 60 * 60;
const MAX_RESERVATION_SECONDS: u64 = 60 * 60;
const TTL_THRESHOLD: u32 = 17_280;
const TTL_EXTEND: u32 = 120_960;

#[contract]
pub struct Escrow;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub token: Address,
    /// Ed25519 key of the off-chain payment-policy signer, not the browser.
    pub signer: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Terms {
    pub seller: Address,
    pub token_amount: i128,
    pub fiat_minor: i128,
    pub currency: Symbol,
    pub rail: Symbol,
    /// Commitment only. Never put bank identifiers in contract storage.
    pub recipient: BytesN<32>,
    pub offer_expires_at: u64,
    pub reservation_seconds: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum State {
    Funded,
    Reserved,
    Paying,
    Released,
    Refunded,
    Resolved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Order {
    pub terms: Terms,
    pub state: State,
    pub buyer: Option<Address>,
    pub reserved_at: u64,
    pub pay_by: u64,
    pub locked_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentClaim {
    pub order_id: u64,
    pub seller: Address,
    pub buyer: Address,
    pub token: Address,
    pub token_amount: i128,
    pub fiat_minor: i128,
    pub currency: Symbol,
    pub rail: Symbol,
    pub recipient: BytesN<32>,
    pub reserved_at: u64,
    pub pay_by: u64,
    pub paid_at: u64,
    pub expires_at: u64,
    pub nullifier: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    NextId,
    Order(u64),
    Used(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    InvalidTerms = 1,
    NotFound = 2,
    WrongState = 3,
    Expired = 4,
    TooEarly = 5,
    InvalidBuyer = 6,
    ClaimMismatch = 7,
    InvalidPaymentTime = 8,
    PaymentUsed = 9,
    InvalidSplit = 10,
    IdExhausted = 11,
}

#[contractevent]
pub struct OrderChanged {
    #[topic]
    pub order_id: u64,
    pub state: State,
}

fn config(env: &Env) -> Config {
    env.storage().instance().get(&Key::Config).unwrap()
}

fn touch_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}

fn load(env: &Env, id: u64) -> Result<Order, Error> {
    let key = Key::Order(id);
    let order = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
    touch_instance(env);
    Ok(order)
}

fn save(env: &Env, id: u64, order: &Order) {
    let key = Key::Order(id);
    env.storage().persistent().set(&key, order);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
    touch_instance(env);
    OrderChanged {
        order_id: id,
        state: order.state.clone(),
    }
    .publish(env);
}

fn transfer(env: &Env, to: &Address, amount: i128) {
    if amount > 0 {
        soroban_sdk::token::Client::new(env, &config(env).token).transfer(
            &env.current_contract_address(),
            to,
            &amount,
        );
    }
}

#[contractimpl]
impl Escrow {
    /// Immutable configuration. There is no admin withdrawal or upgrade method.
    pub fn __constructor(env: Env, token: Address, signer: BytesN<32>) {
        env.storage()
            .instance()
            .set(&Key::Config, &Config { token, signer });
        env.storage().instance().set(&Key::NextId, &0u64);
        touch_instance(&env);
    }

    pub fn get_config(env: Env) -> Config {
        touch_instance(&env);
        config(&env)
    }

    /// One funded offer becomes at most one trade. IDs are never recycled.
    pub fn fund(env: Env, terms: Terms) -> Result<u64, Error> {
        terms.seller.require_auth();
        let now = env.ledger().timestamp();
        if terms.token_amount <= 0
            || terms.fiat_minor <= 0
            || terms.currency != symbol_short!("EUR")
            || terms.rail != symbol_short!("revolut")
            || terms.recipient == BytesN::from_array(&env, &[0; 32])
            || terms.reservation_seconds == 0
            || terms.reservation_seconds > MAX_RESERVATION_SECONDS
            || terms.offer_expires_at <= now
            || terms.offer_expires_at - now > MAX_OFFER_SECONDS
        {
            return Err(Error::InvalidTerms);
        }
        let id: u64 = env.storage().instance().get(&Key::NextId).unwrap();
        let next = id.checked_add(1).ok_or(Error::IdExhausted)?;
        env.storage().instance().set(&Key::NextId, &next);
        let order = Order {
            terms: terms.clone(),
            state: State::Funded,
            buyer: None,
            reserved_at: 0,
            pay_by: 0,
            locked_at: 0,
        };
        save(&env, id, &order);
        soroban_sdk::token::Client::new(&env, &config(&env).token).transfer(
            &terms.seller,
            &env.current_contract_address(),
            &terms.token_amount,
        );
        Ok(id)
    }

    pub fn get_order(env: Env, order_id: u64) -> Result<Order, Error> {
        load(&env, order_id)
    }

    pub fn reserve(env: Env, order_id: u64, buyer: Address) -> Result<Order, Error> {
        buyer.require_auth();
        let mut order = load(&env, order_id)?;
        if order.state != State::Funded {
            return Err(Error::WrongState);
        }
        let now = env.ledger().timestamp();
        if now >= order.terms.offer_expires_at {
            return Err(Error::Expired);
        }
        if buyer == order.terms.seller || buyer == env.current_contract_address() {
            return Err(Error::InvalidBuyer);
        }
        order.state = State::Reserved;
        order.buyer = Some(buyer);
        order.reserved_at = now;
        order.pay_by = now
            .saturating_add(order.terms.reservation_seconds)
            .min(order.terms.offer_expires_at);
        save(&env, order_id, &order);
        Ok(order)
    }

    /// Must confirm on chain BEFORE sending fiat. The seller can no longer
    /// refund unilaterally, even after pay_by or a proof/signature expiry.
    pub fn begin_payment(env: Env, order_id: u64) -> Result<Order, Error> {
        let mut order = load(&env, order_id)?;
        if order.state != State::Reserved {
            return Err(Error::WrongState);
        }
        order.buyer.as_ref().unwrap().require_auth();
        let now = env.ledger().timestamp();
        if now >= order.pay_by {
            return Err(Error::Expired);
        }
        order.locked_at = now;
        order.state = State::Paying;
        save(&env, order_id, &order);
        Ok(order)
    }

    /// Seller can cancel an unreserved offer. Anyone can return an expired,
    /// unused reservation to the seller. Paying orders are never timed out.
    pub fn refund(env: Env, order_id: u64) -> Result<(), Error> {
        let mut order = load(&env, order_id)?;
        match order.state {
            State::Funded => order.terms.seller.require_auth(),
            State::Reserved if env.ledger().timestamp() >= order.pay_by => (),
            State::Reserved => return Err(Error::TooEarly),
            _ => return Err(Error::WrongState),
        }
        order.state = State::Refunded;
        save(&env, order_id, &order);
        transfer(&env, &order.terms.seller, order.terms.token_amount);
        Ok(())
    }

    /// Canonical signed message: Ed25519 over the raw 32-byte SHA-256 digest
    /// of ScVal XDR(domain, network ID, contract address, PaymentClaim).
    pub fn claim_digest(env: Env, claim: PaymentClaim) -> BytesN<32> {
        let payload = (
            Symbol::new(&env, "PACTLANE_PAYMENT_V1"),
            env.ledger().network_id(),
            env.current_contract_address(),
            claim,
        )
            .to_xdr(&env);
        env.crypto().sha256(&payload).to_bytes()
    }

    /// Permissionless relay; the signed buyer is always the destination.
    pub fn release(env: Env, claim: PaymentClaim, signature: BytesN<64>) -> Result<(), Error> {
        let mut order = load(&env, claim.order_id)?;
        if order.state != State::Paying {
            return Err(Error::WrongState);
        }
        let cfg = config(&env);
        if claim.seller != order.terms.seller
            || Some(claim.buyer.clone()) != order.buyer
            || claim.token != cfg.token
            || claim.token_amount != order.terms.token_amount
            || claim.fiat_minor != order.terms.fiat_minor
            || claim.currency != order.terms.currency
            || claim.rail != order.terms.rail
            || claim.recipient != order.terms.recipient
            || claim.reserved_at != order.reserved_at
            || claim.pay_by != order.pay_by
            || claim.nullifier == BytesN::from_array(&env, &[0; 32])
        {
            return Err(Error::ClaimMismatch);
        }
        let now = env.ledger().timestamp();
        if claim.expires_at <= now {
            return Err(Error::Expired);
        }
        if claim.paid_at < order.locked_at || claim.paid_at >= order.pay_by || claim.paid_at > now {
            return Err(Error::InvalidPaymentTime);
        }
        let used_key = Key::Used(claim.nullifier.clone());
        if env.storage().persistent().has(&used_key) {
            return Err(Error::PaymentUsed);
        }
        let digest: Bytes = Self::claim_digest(env.clone(), claim.clone()).into();
        env.crypto()
            .ed25519_verify(&cfg.signer, &digest, &signature);
        // Persistent entries cannot disappear and be recreated after archival.
        // All writes and the transfer roll back together if any step fails.
        env.storage().persistent().set(&used_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&used_key, TTL_THRESHOLD, TTL_EXTEND);
        order.state = State::Released;
        save(&env, claim.order_id, &order);
        transfer(&env, &claim.buyer, claim.token_amount);
        Ok(())
    }

    pub fn payment_used(env: Env, nullifier: BytesN<32>) -> bool {
        touch_instance(&env);
        let key = Key::Used(nullifier);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
            true
        } else {
            false
        }
    }

    /// Mutual recovery. Both wallets authorize this exact split. Recovery has
    /// no operator override; a lost/uncooperative party can keep a trade locked.
    pub fn resolve(env: Env, order_id: u64, buyer_tokens: i128) -> Result<(), Error> {
        let mut order = load(&env, order_id)?;
        if order.state != State::Reserved && order.state != State::Paying {
            return Err(Error::WrongState);
        }
        if buyer_tokens < 0 || buyer_tokens > order.terms.token_amount {
            return Err(Error::InvalidSplit);
        }
        let buyer = order.buyer.as_ref().unwrap();
        order.terms.seller.require_auth();
        buyer.require_auth();
        order.state = State::Resolved;
        save(&env, order_id, &order);
        transfer(&env, buyer, buyer_tokens);
        transfer(
            &env,
            &order.terms.seller,
            order.terms.token_amount - buyer_tokens,
        );
        Ok(())
    }
}

#[cfg(test)]
mod test;
