#[test_only]
module openclu_skill::skill_access_tests;

use openclu_skill::skill_access;

#[test]
fun is_prefix_matches_extended_id() {
    let prefix = x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let mut id = prefix;
    id.push_back(98u8); // 'b' suffix for bundle
    id.push_back(117u8);
    id.push_back(110u8);
    id.push_back(100u8);
    id.push_back(108u8);
    id.push_back(101u8);
    assert!(skill_access::is_prefix_for_testing(&prefix, &id));
}

#[test]
fun is_prefix_rejects_wrong_prefix() {
    let prefix = x"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let other = x"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    assert!(!skill_access::is_prefix_for_testing(&prefix, &other));
}
