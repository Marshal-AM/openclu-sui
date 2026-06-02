#[test_only]
module openclu_skill::skill_marketplace_tests;

use std::unit_test::assert_eq;
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario as test;
use openclu_skill::skill_marketplace::{Self, SkillListing, SkillPurchase};
use openclu_skill::skill_record;

#[test]
fun purchase_transfers_payment_and_mints_receipt() {
    let seller = @0xA11CE;
    let buyer = @0xB0B;
    let mut scenario = test::begin(seller);

    let seal_id = x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";

    let record = {
        let ctx = scenario.ctx();
        skill_record::new_skill_record_for_testing(
            b"skill-a".to_string(),
            b"skillBundle".to_string(),
            b"walrus-blob-1".to_string(),
            b"0x1".to_string(),
            vector[9u8],
            seal_id,
            b"Skill A".to_string(),
            b"Desc".to_string(),
            vector[],
            vector[],
            100,
            ctx,
        )
    };

    scenario.next_tx(seller);
    {
        let ctx = scenario.ctx();
        let c = clock::create_for_testing(ctx);
        skill_marketplace::list_skill(&record, 1_000_000_000, &c, ctx);
        clock::destroy_for_testing(c);
        skill_record::destroy_skill_record_for_testing(record);
    };

    scenario.next_tx(buyer);
    {
        let listing = scenario.take_shared<SkillListing>();
        let ctx = scenario.ctx();
        let payment = coin::mint_for_testing<SUI>(2_000_000_000, ctx);
        let c = clock::create_for_testing(ctx);
        skill_marketplace::purchase_skill(&listing, payment, &c, ctx);
        clock::destroy_for_testing(c);
        test::return_shared(listing);
    };

    scenario.next_tx(buyer);
    {
        let purchase = scenario.take_from_sender<SkillPurchase>();
        assert_eq!(skill_marketplace::purchase_buyer(&purchase), buyer);
        assert_eq!(
            skill_marketplace::purchase_walrus_blob_id(&purchase),
            b"walrus-blob-1".to_string(),
        );
        transfer::public_transfer(purchase, buyer);
    };

    scenario.end();
}
