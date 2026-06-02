#[test_only]
module openclu_skill::skill_record_tests;

use std::unit_test::assert_eq;
use sui::test_scenario as test;
use openclu_skill::skill_record;

#[test]
fun create_skill_record_preserves_fields() {
    let creator = @0xCAFE;
    let mut scenario = test::begin(creator);
    let ctx = scenario.ctx();

    let seal_id = x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";

    let record = skill_record::new_skill_record_for_testing(
        b"deploy-k8s".to_string(),
        b"skillBundle".to_string(),
        b"blob-abc".to_string(),
        b"0xblob".to_string(),
        vector[1u8, 2u8],
        seal_id,
        b"Deploy to K8s".to_string(),
        b"How to deploy".to_string(),
        vector[b"version".to_string()],
        vector[b"1".to_string()],
        1_700_000_000,
        ctx,
    );

    assert_eq!(skill_record::creator(&record), creator);
    assert_eq!(skill_record::skill_slug(&record), b"deploy-k8s".to_string());
    assert_eq!(skill_record::walrus_blob_id(&record), b"blob-abc".to_string());

    skill_record::destroy_skill_record_for_testing(record);
    scenario.end();
}
