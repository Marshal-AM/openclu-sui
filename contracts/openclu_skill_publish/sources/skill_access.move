/// Seal access policies for encrypted Walrus skill payloads.
module openclu_skill::skill_access;

use openclu_skill::skill_marketplace::{SkillListing, SkillPurchase};

const ENoAccess: u64 = 0;
const EInvalidSealIdentity: u64 = 1;

/// Expected length of seal_identity prefix (32 bytes).
const SEAL_IDENTITY_LEN: u64 = 32;

/// Returns true if `prefix` is a prefix of `id`.
fun is_prefix(prefix: &vector<u8>, id: &vector<u8>): bool {
    let prefix_len = prefix.length();
    if (prefix_len > id.length()) {
        return false
    };
    let mut i = 0;
    while (i < prefix_len) {
        if (prefix[i] != id[i]) {
            return false
        };
        i = i + 1;
    };
    true
}

fun assert_valid_seal_identity(seal_identity: &vector<u8>) {
    assert!(seal_identity.length() == SEAL_IDENTITY_LEN, EInvalidSealIdentity);
}

/// Buyer with a SkillPurchase receipt may decrypt IDs under this skill's seal_identity prefix.
entry fun seal_approve_buyer(
    id: vector<u8>,
    purchase: &SkillPurchase,
    ctx: &TxContext,
) {
    assert!(openclu_skill::skill_marketplace::purchase_buyer(purchase) == ctx.sender(), ENoAccess);
    let seal_identity = openclu_skill::skill_marketplace::purchase_seal_identity(purchase);
    assert_valid_seal_identity(&seal_identity);
    assert!(is_prefix(&seal_identity, &id), ENoAccess);
}

/// Seller may decrypt their own listed skill content.
entry fun seal_approve_creator(
    id: vector<u8>,
    listing: &SkillListing,
    ctx: &TxContext,
) {
    assert!(openclu_skill::skill_marketplace::listing_seller(listing) == ctx.sender(), ENoAccess);
    let seal_identity = openclu_skill::skill_marketplace::listing_seal_identity(listing);
    assert_valid_seal_identity(&seal_identity);
    assert!(is_prefix(&seal_identity, &id), ENoAccess);
}

#[test_only]
public fun is_prefix_for_testing(prefix: &vector<u8>, id: &vector<u8>): bool {
    is_prefix(prefix, id)
}
