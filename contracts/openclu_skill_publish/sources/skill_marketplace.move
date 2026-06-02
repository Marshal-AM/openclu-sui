/// List skills for sale and mint purchase receipts to buyers.
module openclu_skill::skill_marketplace;

use std::string::String;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;
use openclu_skill::skill_record::{Self, SkillRecord};

const ENotCreator: u64 = 1;
const EZeroPrice: u64 = 2;
const EListingInactive: u64 = 3;
const EInsufficientPayment: u64 = 4;
const ENotSeller: u64 = 5;
const ECannotBuyOwn: u64 = 6;

/// Shared listing — discoverable by anyone; multiple buyers can purchase the same skill.
public struct SkillListing has key, store {
    id: UID,
    seller: address,
    record_id: ID,
    skill_slug: String,
    title: String,
    description: String,
    entity_type: String,
    walrus_blob_id: String,
    seal_identity: vector<u8>,
    price: u64,
    active: bool,
    listed_at_ms: u64,
}

/// Owned by the buyer — proves they purchased access to the skill content on Walrus.
public struct SkillPurchase has key, store {
    id: UID,
    buyer: address,
    seller: address,
    listing_id: ID,
    record_id: ID,
    skill_slug: String,
    entity_type: String,
    walrus_blob_id: String,
    seal_identity: vector<u8>,
    price_paid: u64,
    purchased_at_ms: u64,
}

public struct SkillListed has copy, drop {
    listing_id: ID,
    seller: address,
    record_id: ID,
    skill_slug: String,
    price: u64,
    listed_at_ms: u64,
}

public struct SkillDelisted has copy, drop {
    listing_id: ID,
    seller: address,
    skill_slug: String,
}

public struct SkillPurchased has copy, drop {
    purchase_id: ID,
    listing_id: ID,
    buyer: address,
    seller: address,
    record_id: ID,
    skill_slug: String,
    price_paid: u64,
    purchased_at_ms: u64,
}

/// Create record on Walrus index, list for sale, and keep record owned by seller.
public entry fun create_record_and_list(
    skill_slug: String,
    entity_type: String,
    walrus_blob_id: String,
    walrus_object_id: String,
    payload_hash: vector<u8>,
    seal_identity: vector<u8>,
    title: String,
    description: String,
    attr_keys: vector<String>,
    attr_values: vector<String>,
    created_at_ms: u64,
    price: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let record = skill_record::mint_skill_record(
        skill_slug,
        entity_type,
        walrus_blob_id,
        walrus_object_id,
        payload_hash,
        seal_identity,
        title,
        description,
        attr_keys,
        attr_values,
        created_at_ms,
        ctx,
    );
    share_listing_from_record(&record, price, clock, ctx);
    transfer::public_transfer(record, ctx.sender());
}

/// Create a shared listing for an owned skill record. Caller must own the record.
public entry fun list_skill(
    record: &SkillRecord,
    price: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(skill_record::creator(record) == ctx.sender(), ENotCreator);
    assert!(price > 0, EZeroPrice);
    share_listing_from_record(record, price, clock, ctx);
}

fun share_listing_from_record(
    record: &SkillRecord,
    price: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let listing = SkillListing {
        id: object::new(ctx),
        seller: ctx.sender(),
        record_id: object::id(record),
        skill_slug: skill_record::skill_slug(record),
        title: skill_record::title(record),
        description: skill_record::description(record),
        entity_type: skill_record::entity_type(record),
        walrus_blob_id: skill_record::walrus_blob_id(record),
        seal_identity: skill_record::seal_identity(record),
        price,
        active: true,
        listed_at_ms: clock.timestamp_ms(),
    };

    let listing_id = object::id(&listing);
    event::emit(SkillListed {
        listing_id,
        seller: listing.seller,
        record_id: listing.record_id,
        skill_slug: listing.skill_slug,
        price: listing.price,
        listed_at_ms: listing.listed_at_ms,
    });

    transfer::share_object(listing);
}

public entry fun delist_skill(listing: &mut SkillListing, ctx: &TxContext) {
    assert!(listing.seller == ctx.sender(), ENotSeller);
    listing.active = false;
    event::emit(SkillDelisted {
        listing_id: object::id(listing),
        seller: listing.seller,
        skill_slug: listing.skill_slug,
    });
}

public entry fun update_listing_price(
    listing: &mut SkillListing,
    new_price: u64,
    ctx: &TxContext,
) {
    assert!(listing.seller == ctx.sender(), ENotSeller);
    assert!(new_price > 0, EZeroPrice);
    listing.price = new_price;
}

/// Pay in SUI (MIST). Listing stays active so multiple users can buy the same skill.
public entry fun purchase_skill(
    listing: &SkillListing,
    payment: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(listing.active, EListingInactive);
    let buyer = ctx.sender();
    assert!(buyer != listing.seller, ECannotBuyOwn);

    let price = listing.price;
    let paid = coin::value(&payment);
    assert!(paid >= price, EInsufficientPayment);

    let mut payment = payment;
    if (paid > price) {
        let change = coin::split(&mut payment, paid - price, ctx);
        transfer::public_transfer(change, buyer);
    };
    transfer::public_transfer(payment, listing.seller);

    let purchase = SkillPurchase {
        id: object::new(ctx),
        buyer,
        seller: listing.seller,
        listing_id: object::id(listing),
        record_id: listing.record_id,
        skill_slug: listing.skill_slug,
        entity_type: listing.entity_type,
        walrus_blob_id: listing.walrus_blob_id,
        seal_identity: listing.seal_identity,
        price_paid: price,
        purchased_at_ms: clock.timestamp_ms(),
    };

    let purchase_id = object::id(&purchase);
    event::emit(SkillPurchased {
        purchase_id,
        listing_id: object::id(listing),
        buyer,
        seller: listing.seller,
        record_id: listing.record_id,
        skill_slug: listing.skill_slug,
        price_paid: price,
        purchased_at_ms: purchase.purchased_at_ms,
    });

    transfer::public_transfer(purchase, buyer);
}

public fun listing_price(listing: &SkillListing): u64 {
    listing.price
}

public fun listing_active(listing: &SkillListing): bool {
    listing.active
}

public fun listing_seller(listing: &SkillListing): address {
    listing.seller
}

public fun listing_skill_slug(listing: &SkillListing): String {
    listing.skill_slug
}

public fun listing_walrus_blob_id(listing: &SkillListing): String {
    listing.walrus_blob_id
}

public fun listing_seal_identity(listing: &SkillListing): vector<u8> {
    listing.seal_identity
}

public fun purchase_buyer(purchase: &SkillPurchase): address {
    purchase.buyer
}

public fun purchase_walrus_blob_id(purchase: &SkillPurchase): String {
    purchase.walrus_blob_id
}

public fun purchase_seal_identity(purchase: &SkillPurchase): vector<u8> {
    purchase.seal_identity
}
