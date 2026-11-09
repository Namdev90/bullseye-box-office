'use strict';

// Synthetic metadata only: these checks must not contact a provider, capture a
// photo, authenticate a staff member, or turn an intent into a delivered message.
const assert = require('node:assert/strict');
const { test } = require('node:test');
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: require('node:crypto').webcrypto });
const { DemoStore } = require('../web/demo-store.js');

const event = 'training-event-001';
const otherEvent = 'training-event-002';
const qty = (normal = 0, vip = 0, vvip = 0, extra = {}) => ({ normal, vip, vvip, ...extra });
const base = (extra = {}) => ({ request_id: 'deposit', event_id: event, operator: 'Kenneth',
  location: 'A-02', quantities: qty(6, 2, 1), custody_confirmed: true, ...extra });
const create = (store, body = base()) => store.request('/api/deposits', body);
const verify = (store, created) => store.request('/api/verify', { event_id: created.deposit.event_id, collection_code: created.collection_code });
async function release(store, created, quantities, extra = {}) {
  const v = await verify(store, created);
  const body = { request_id: 'release', event_id: created.deposit.event_id, operator: 'Kenneth',
    claim_token: v.claim_token, version: v.deposit.version, packet_id: created.deposit.packet_id, quantities, ...extra };
  const url = `/api/deposits/${created.deposit.id}/release`;
  return { result: await store.request(url, body), url, body };
}
const confirm = (store, released, extra = {}) => store.request(`/api/collections/${released.collection.id}/handover`, {
  request_id: 'confirm', event_id: released.collection.event_id, operator: 'Kenneth', version: released.collection.version,
  handover_confirmed: true, ...extra
});

test('default registry and booths preserve the original exact three categories', () => {
  const store = new DemoStore();
  const state = store.state(event);
  assert.deepEqual(state.passTypes, [{ id: 'normal', label: 'Normal' }, { id: 'vip', label: 'VIP' }, { id: 'vvip', label: 'VVIP' }]);
  assert.deepEqual(state.booths, [{ id: 'B1', label: 'Booth 1' }, { id: 'B2', label: 'Booth 2' }]);
  assert.deepEqual(state.deposits[0].initial, qty(6, 2, 1));
  assert.equal(state.deposits[0].booth_id, 'B1');
  assert.equal(state.deposits[0].depositor_label, 'Aria');
  state.passTypes[0].label = 'Outside change'; state.booths.pop();
  assert.equal(store.state(event).passTypes[0].label, 'Normal');
  assert.equal(store.state(event).booths.length, 2);
  assert.equal(state.evidence.end_at, null);
  assert.ok(!JSON.stringify(state).includes('Infinity'));
});

test('custom types have safe distinct IDs and backfill existing deposits and collections', async () => {
  const store = new DemoStore({ seed: false });
  const created = await create(store);
  const first = (await release(store, created, qty(1))).result;
  await confirm(store, first);
  const type = store.addPassType('  Backstage + Access  ');
  assert.match(type.id, /^pass_[a-z0-9_]+$/);
  assert.equal(type.label, 'Backstage + Access');
  const collision = store.addPassType('Backstage / Access');
  assert.notEqual(type.id, collision.id);
  const state = store.state(event);
  assert.equal(state.deposits[0].initial[type.id], 0);
  assert.equal(state.deposits[0].remaining[type.id], 0);
  assert.equal(state.collections[0].quantities[type.id], 0);
  type.label = 'Outside change';
  assert.equal(store.state(event).passTypes[3].label, 'Backstage + Access');
});

test('custom type labels are validated and the registry stops at twelve', () => {
  const store = new DemoStore({ seed: false });
  for (const label of ['', ' ', null, {}, 'a'.repeat(41), 'bad\nlabel']) assert.throws(() => store.addPassType(label));
  assert.throws(() => store.addPassType('normal'), /already exists/);
  for (let i = 0; i < 9; i++) store.addPassType(`Custom ${i}`);
  assert.equal(store.passTypes.length, 12);
  assert.throws(() => store.addPassType('Thirteenth'), /At most 12/);
});

test('quantities must match every registered category exactly and fail atomically', async () => {
  const store = new DemoStore({ seed: false });
  const type = store.addPassType('Backstage');
  const before = store.state(event);
  await assert.rejects(create(store), /whole numbers/);
  await assert.rejects(create(store, base({ quantities: qty(1, 0, 0, { [type.id]: 0, unknown: 1 }) })), /whole numbers/);
  assert.deepEqual(store.state(event), before);
});

test('mixed custom-category partial pickups keep exact balances through repeats and later pickups', async () => {
  const store = new DemoStore({ seed: false });
  const { id } = store.addPassType('Backstage');
  const created = await create(store, base({ quantities: qty(6, 2, 1, { [id]: 3 }) }));
  const first = await release(store, created, qty(2, 1, 0, { [id]: 2 }));
  assert.deepEqual(first.result.deposit.remaining, qty(4, 1, 1, { [id]: 1 }));
  const replay = await store.request(first.url, first.body);
  assert.equal(replay.replayed, true);
  assert.equal(store.collections.length, 1);
  await confirm(store, first.result);
  const second = await release(store, created, qty(0, 0, 1, { [id]: 1 }), { request_id: 'release-two' });
  assert.deepEqual(second.result.deposit.remaining, qty(4, 1, 0, { [id]: 0 }));
  const auditLength = store.audit.length;
  const stale = await store.request(first.url, first.body);
  assert.deepEqual(stale.deposit.remaining, second.result.deposit.remaining);
  assert.equal(store.audit.length, auditLength);
  await assert.rejects(verify(store, created), /unconfirmed/);
});

test('booth validation happens before stock changes and audit records the handover booth', async () => {
  const store = new DemoStore({ seed: false });
  for (const booth_id of ['B3', '', null, 1]) await assert.rejects(create(store, base({ booth_id })), /booth B1 or B2/);
  assert.equal(store.deposits.length, 0);
  const created = await create(store, base({ booth_id: 'B2', notification_channels: ['sms'] }));
  assert.equal(created.deposit.booth_id, 'B2');
  const before = store.state(event);
  await assert.rejects(release(store, created, qty(1), { booth_id: 'B3' }), /booth B1 or B2/);
  assert.deepEqual(store.state(event), before);
  await assert.rejects(release(store, created, qty(1), {booth_id:'B1'}), /Wrong physical booth/);
  const blocked=store.verify({event_id:event,collection_code:created.collection_code,booth_id:'B1'});assert.equal(blocked.release_allowed,false);assert.equal(blocked.claim_token,null);
  const first = (await release(store, created, qty(1), { booth_id: 'B2' })).result;
  const pending = store.state(event);
  await assert.rejects(confirm(store, first, { booth_id: 'B3' }), /booth B1 or B2/);
  assert.deepEqual(store.state(event), pending);
  await assert.rejects(confirm(store, first, {booth_id:'B1'}), /original physical booth/);
  const done = await confirm(store, first, { booth_id: 'B2' });
  assert.equal(done.collection.booth_id, 'B2');
  assert.equal(store.audit.find(a => a.action === 'RELEASE_RECORDED').booth_id, 'B2');
  assert.equal(store.audit.find(a => a.action === 'HANDOVER_CONFIRMED').booth_id, 'B2');
  assert.equal(store.state(event).outbox.find(row => row.action === 'HANDOVER_CONFIRMED').booth_id, 'B2');
});

test('collector label is optional trimmed metadata and never grants handover authority', async () => {
  const store = new DemoStore({ seed: false });
  const created = await create(store);
  for (const collector_label of [null, 1, {}, 'a'.repeat(81), 'bad\nlabel']) {
    await assert.rejects(release(store, created, qty(1), { collector_label }), /optional collector label/);
    assert.equal(store.collections.length, 0);
  }
  const first = (await release(store, created, qty(1), { collector_label: '  Friend A  ' })).result;
  assert.equal(first.collection.collector_label, 'Friend A');
  await assert.rejects(confirm(store, first, { operator: 'Friend A' }), error => error.status === 403);
  const done = await confirm(store, first);
  assert.equal(done.collection.collector_label, 'Friend A');
});

test('only known synthetic evidence fixtures with explicit consent can be attached', async () => {
  const store = new DemoStore({ seed: false, endAt: 1000, now: () => 0 });
  for (const evidence_fixture_id of ['photo.jpg', 'https://example.invalid/photo', '', null, {}]) {
    await assert.rejects(create(store, base({ evidence_fixture_id, consent_confirmed: true })), /sample-a or sample-b/);
  }
  for (const consent_confirmed of [undefined, false, 'true', 1]) {
    await assert.rejects(create(store, base({ evidence_fixture_id: 'sample-a', consent_confirmed })), /Confirm consent/);
  }
  assert.equal(store.deposits.length, 0);
  const created = await create(store, base({ evidence_fixture_id: 'sample-a', consent_confirmed: true }));
  assert.equal(created.deposit.evidence_fixture_id, 'sample-a');
  assert.equal(created.deposit.evidence_status, 'attached_sample');
  assert.equal(created.deposit.evidence_expires_at, new Date(1000).toISOString());
  const first = (await release(store, created, qty(1), { evidence_fixture_id: 'sample-b', consent_confirmed: true })).result;
  assert.equal(first.collection.evidence_fixture_id, 'sample-b');
  assert.equal(first.collection.evidence_status, 'attached_sample');
});

test('event-end purge deletes sample references once without reversing custody or exposing them on retry', async () => {
  let now = 0;
  const store = new DemoStore({ seed: false, endAt: 1000, now: () => now });
  const depositBody = base({ evidence_fixture_id: 'sample-a', consent_confirmed: true, notification_channels: ['whatsapp'] });
  const created = await create(store, depositBody);
  const first = await release(store, created, qty(1), { evidence_fixture_id: 'sample-b', consent_confirmed: true });
  await confirm(store, first.result);
  assert.equal(store.state(event).evidence.status, 'active');
  assert.equal(store.purgeEvidence(999).deleted, 0);
  now = 1000;
  assert.deepEqual(store.purgeEvidence(), { deleted: 2, expired: true });
  const state = store.state(event);
  assert.equal(state.evidence.status, 'expired');
  assert.equal(state.deposits[0].evidence_status, 'deleted_event_end');
  assert.equal(state.collections[0].evidence_status, 'deleted_event_end');
  assert.ok(!JSON.stringify(state).includes('sample-a'));
  assert.ok(!JSON.stringify(state).includes('sample-b'));
  assert.deepEqual(state.deposits[0].remaining, qty(5, 2, 1));
  assert.equal(state.collections[0].status, 'HANDED_OVER');
  assert.equal(state.audit.filter(row => row.action === 'PHOTOS_DELETED').length, 1);
  assert.equal(state.audit[0].details.sample_references_deleted, 2);
  assert.deepEqual(store.purgeEvidence(), { deleted: 0, expired: true });
  assert.equal(store.state(event).audit.length, state.audit.length);
  const depositReplay = await create(store, depositBody);
  const releaseReplay = await store.request(first.url, first.body);
  assert.equal(depositReplay.deposit.evidence_fixture_id, undefined);
  assert.equal(releaseReplay.collection.evidence_fixture_id, undefined);
  await assert.rejects(create(store, base({ request_id: 'after-end', location: 'A-03', evidence_fixture_id: 'sample-a', consent_confirmed: true })), /retention ended/);
});

test('expired sample evidence cannot be reattached after the clock moves backwards', async () => {
  let now = 0;
  const store = new DemoStore({seed:false,endAt:1000,now:()=>now});
  const created = await create(store,base({evidence_fixture_id:'sample-a',consent_confirmed:true}));
  now=1000;store.purgeEvidence();now=100;
  assert.equal(store.state(event).evidence.status,'expired');
  assert.equal(store.state(event).deposits[0].evidence_fixture_id,undefined);
  await assert.rejects(create(store,base({request_id:'rollback-evidence',location:'A-03',evidence_fixture_id:'sample-b',consent_confirmed:true})),/retention ended/);
  assert.equal(store.deposits.length,1);
  assert.deepEqual(store.state(event).deposits[0].remaining,created.deposit.remaining);
  assert.deepEqual(store.purgeEvidence(),{deleted:0,expired:true});
});

test('retention configuration rejects invalid timestamps and never serializes Infinity', () => {
  for (const endAt of [NaN, '1000', null, -Infinity]) assert.throws(() => new DemoStore({ seed: false, endAt }));
  const store = new DemoStore({ seed: false });
  assert.equal(store.state(event).evidence.status, 'event_end_not_configured');
  assert.equal(store.state(event).evidence.end_at, null);
  assert.throws(() => store.purgeEvidence(Infinity), /finite/);
});

test('channel selection is independent, validated, and creates no notification for a release', async () => {
  const store = new DemoStore({ seed: false });
  for (const notification_channels of [null, 'sms', ['push'], ['sms', 1], ['sms', 'sms', 'sms', 'sms']]) {
    await assert.rejects(create(store, base({ notification_channels })), /channels only/);
  }
  assert.equal(store.outbox.length, 0);
  const created = await create(store, base({ notification_channels: ['email', 'sms'] }));
  const rows = store.state(event).outbox;
  assert.deepEqual(rows.map(row => row.channel), ['sms', 'email']);
  assert.ok(rows.every(row => row.status === 'not_sent_provider_unconfigured' && row.recipient_ref === 'sample-depositor'));
  assert.ok(rows.every(row => row.event_id === event && row.action === 'DEPOSIT_CREATED'));
  const first = (await release(store, created, qty(1), { notification_channels: ['whatsapp'] })).result;
  assert.equal(store.outbox.length, 2);
  await confirm(store, first);
  const handovers = store.state(event).outbox.filter(row => row.action === 'HANDOVER_CONFIRMED');
  assert.deepEqual(handovers.map(row => row.channel), ['whatsapp']);
  assert.deepEqual(handovers[0].remaining, qty(5, 2, 1));
});

test('deposit and handover retries deduplicate intents and event reads isolate the outbox', async () => {
  const store = new DemoStore({ seed: false });
  const body = base({ notification_channels: ['whatsapp', 'sms', 'email'] });
  const created = await create(store, body);
  await Promise.all([create(store, body), create(store, body)]);
  assert.equal(store.outbox.length, 3);
  const first = (await release(store, created, qty(2, 1))).result;
  await Promise.all([confirm(store, first), confirm(store, first)]);
  assert.equal(store.outbox.length, 6);
  assert.equal(new Set(store.outbox.map(row => row.id)).size, 6);
  assert.ok(store.outbox.every(row => row.status === 'not_sent_provider_unconfigured'));
  assert.equal(store.state(otherEvent).outbox.length, 0);
  const state = store.state(event);
  state.outbox[0].remaining.normal = 99;
  assert.equal(store.state(event).outbox[0].remaining.normal, 6);
  await create(store, base({ request_id: 'other-event-deposit', event_id: otherEvent, notification_channels: ['email'] }));
  assert.equal(store.state(otherEvent).outbox.length, 1);
  assert.equal(store.state(event).outbox.length, 6);
});

test('empty notification selection is honored even when the deposit selected channels', async () => {
  const store = new DemoStore({ seed: false });
  const created = await create(store, base({ notification_channels: ['sms'] }));
  const first = (await release(store, created, qty(1), { notification_channels: [] })).result;
  await confirm(store, first);
  assert.equal(store.state(event).outbox.length, 1);
  assert.deepEqual(store.state(event).collections[0].notification_channels, []);
});

test('every audit record preserves its own historical remaining balance', async () => {
  const store = new DemoStore({ seed: false });
  const created = await create(store);
  const first = (await release(store, created, qty(2, 1))).result;
  await confirm(store, first);
  const second = (await release(store, created, qty(1, 0, 1), { request_id: 'second-release' })).result;
  const state = store.state(event);
  const generated = state.audit.find(row => row.action === 'CODE_GENERATED');
  const firstRelease = state.audit.find(row => row.action === 'RELEASE_RECORDED' && row.collection_id === first.collection.id);
  const firstHandover = state.audit.find(row => row.action === 'HANDOVER_CONFIRMED');
  const secondRelease = state.audit.find(row => row.action === 'RELEASE_RECORDED' && row.collection_id === second.collection.id);
  assert.deepEqual(generated.details.remaining, qty(6, 2, 1));
  assert.deepEqual(firstRelease.details.remaining, qty(4, 1, 1));
  assert.deepEqual(firstHandover.details.remaining, qty(4, 1, 1));
  assert.deepEqual(secondRelease.details.remaining, qty(3, 1, 0));
  state.deposits[0].remaining.normal = 99;
  firstRelease.details.remaining.normal = 99;
  assert.deepEqual(store.state(event).audit.find(row => row.seq === firstRelease.seq).details.remaining, qty(4, 1, 1));
  assert.notEqual(store.audit[0].details.remaining, store.deposits[0].remaining);
});
