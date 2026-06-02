/// On-chain index for skill payloads stored on Walrus.
module openclu_skill::skill_record;

use std::string::String;
use sui::event;

const EAttributeLengthMismatch: u64 = 0;

/// Owned by the creator. Points at a Walrus blob (SKILL bundle, recording, etc.).
public struct SkillRecord has key, store {
    id: UID,
    creator: address,
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
    updated_at_ms: u64,
}

public struct SkillRecordCreated has copy, drop {
    record_id: ID,
    creator: address,
    skill_slug: String,
    entity_type: String,
    walrus_blob_id: String,
    created_at_ms: u64,
}

public struct SkillRecordUpdated has copy, drop {
    record_id: ID,
    creator: address,
    skill_slug: String,
    entity_type: String,
    walrus_blob_id: String,
    updated_at_ms: u64,
}

public struct SkillRecordDeleted has copy, drop {
    record_id: ID,
    creator: address,
    skill_slug: String,
    entity_type: String,
}

/// Mint a record without transferring (for package composition).
public(package) fun mint_skill_record(
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
    ctx: &mut TxContext,
): SkillRecord {
    new_skill_record(
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
    )
}

public entry fun create_skill_record(
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
    ctx: &mut TxContext,
) {
    let record = new_skill_record(
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
    transfer::public_transfer(record, ctx.sender());
}

fun new_skill_record(
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
    ctx: &mut TxContext,
): SkillRecord {
    assert!(
        vector::length(&attr_keys) == vector::length(&attr_values),
        EAttributeLengthMismatch,
    );

    let creator = ctx.sender();
    assert!(vector::length(&seal_identity) == 32, 1);

    let record = SkillRecord {
        id: object::new(ctx),
        creator,
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
        updated_at_ms: created_at_ms,
    };

    event::emit(SkillRecordCreated {
        record_id: object::id(&record),
        creator,
        skill_slug: record.skill_slug,
        entity_type: record.entity_type,
        walrus_blob_id: record.walrus_blob_id,
        created_at_ms,
    });

    record
}

public entry fun update_skill_record(
    record: &mut SkillRecord,
    walrus_blob_id: String,
    walrus_object_id: String,
    payload_hash: vector<u8>,
    title: String,
    description: String,
    attr_keys: vector<String>,
    attr_values: vector<String>,
    updated_at_ms: u64,
) {
    assert!(
        vector::length(&attr_keys) == vector::length(&attr_values),
        EAttributeLengthMismatch,
    );

    record.walrus_blob_id = walrus_blob_id;
    record.walrus_object_id = walrus_object_id;
    record.payload_hash = payload_hash;
    record.title = title;
    record.description = description;
    record.attr_keys = attr_keys;
    record.attr_values = attr_values;
    record.updated_at_ms = updated_at_ms;

    event::emit(SkillRecordUpdated {
        record_id: object::id(record),
        creator: record.creator,
        skill_slug: record.skill_slug,
        entity_type: record.entity_type,
        walrus_blob_id: record.walrus_blob_id,
        updated_at_ms,
    });
}

public entry fun delete_skill_record(record: SkillRecord) {
    let SkillRecord {
        id,
        creator,
        skill_slug,
        entity_type,
        title: _,
        description: _,
        walrus_blob_id: _,
        walrus_object_id: _,
        payload_hash: _,
        seal_identity: _,
        attr_keys: _,
        attr_values: _,
        created_at_ms: _,
        updated_at_ms: _,
    } = record;

    let record_id = id.to_inner();
    id.delete();

    event::emit(SkillRecordDeleted {
        record_id,
        creator,
        skill_slug,
        entity_type,
    });
}

public fun creator(record: &SkillRecord): address {
    record.creator
}

public fun skill_slug(record: &SkillRecord): String {
    record.skill_slug
}

public fun entity_type(record: &SkillRecord): String {
    record.entity_type
}

public fun walrus_blob_id(record: &SkillRecord): String {
    record.walrus_blob_id
}

public fun walrus_object_id(record: &SkillRecord): String {
    record.walrus_object_id
}

public fun seal_identity(record: &SkillRecord): vector<u8> {
    record.seal_identity
}

public fun payload_hash(record: &SkillRecord): vector<u8> {
    record.payload_hash
}

public fun title(record: &SkillRecord): String {
    record.title
}

public fun description(record: &SkillRecord): String {
    record.description
}

#[test_only]
public fun new_skill_record_for_testing(
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
    ctx: &mut TxContext,
): SkillRecord {
    new_skill_record(
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
    )
}

#[test_only]
public fun destroy_skill_record_for_testing(record: SkillRecord) {
    delete_skill_record(record);
}
