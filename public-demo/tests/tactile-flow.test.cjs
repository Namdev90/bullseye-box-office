'use strict';

// Model regressions for the tactile UI's multi-screen custody workflow.
// Closing a screen is deliberately represented by abandoning its response:
// no store mutation may be triggered by navigation or by reopening a record.
const assert = require('node:assert/strict');
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: require('node:crypto').webcrypto });
const { DemoStore } = require('../dist/demo-store.js');

const event = 'training-event-001';
const staff = 'Desk A';
const qty = (normal, vip, vvip) => ({ normal, vip, vvip });
let checks = 0;
const pass = name => { checks += 1; console.log('PASS', name); };

async function setup() {
  let now = 0;
  const store = new DemoStore({ seed: false, now: () => now });
  const created = await store.request('/api/deposits', {
    request_id: 'deposit-one', event_id: event, operator: staff,
    location: 'B-04', quantities: qty(6, 2, 1), custody_confirmed: true
  });
  const verify = () => store.request('/api/verify', {
    event_id: event, collection_code: created.collection_code
  });
  const releaseBody = (verified, requestId, quantities) => ({
    request_id: requestId, event_id: event, operator: staff,
    claim_token: verified.claim_token, version: verified.deposit.version,
    packet_id: created.deposit.packet_id, quantities
  });
  const release = body => store.request(`/api/deposits/${created.deposit.id}/release`, body);
  const confirmBody = requestId => ({
    request_id: requestId, event_id: event, operator: staff,
    version: 1, handover_confirmed: true
  });
  const confirm = (id, body) => store.request(`/api/collections/${id}/handover`, body);
  return { store, created, verify, releaseBody, release, confirmBody, confirm, advance: ms => { now += ms; } };
}

(async () => {
  const f = await setup();
  const original = await f.verify();
  const releaseBody = f.releaseBody(original, 'release-one', qty(2, 1, 0));
  const first = await f.release(releaseBody);
  const snapshot = f.store.state(event);
  assert.deepEqual(snapshot.deposits[0].remaining, qty(4, 1, 1));
  assert.equal(snapshot.deposits[0].pending_collection.id, first.collection.id);
  assert.equal(snapshot.collections.length, 1);
  assert.equal(snapshot.collections[0].status, 'RELEASE_RECORDED');
  pass('Leaving the handover screen preserves its reservation and exact remaining categories');

  for (let i = 0; i < 3; i += 1) f.store.state(event);
  assert.deepEqual(f.store.state(event).deposits[0].remaining, qty(4, 1, 1));
  assert.equal(f.store.state(event).audit.length, snapshot.audit.length);
  pass('Reopening and refreshing custody records never creates a release or restores reserved stock');

  await assert.rejects(f.verify(), error => error.status === 409 && /unconfirmed/i.test(error.message));
  assert.equal(f.store.collections.length, 1);
  pass('An interrupted handover blocks new code verification until the existing handover is reconciled');

  await assert.rejects(f.confirm(first.collection.id, {
    ...f.confirmBody('other-staff'), operator: 'Desk B'
  }), error => error.status === 403);
  await assert.rejects(f.confirm(first.collection.id, {
    ...f.confirmBody('unchecked'), handover_confirmed: false
  }));
  assert.equal(f.store.collections[0].status, 'RELEASE_RECORDED');
  assert.equal(f.store.state(event).audit.length, snapshot.audit.length);
  pass('Wrong operator and unchecked handover confirmation cannot advance the reservation');

  f.advance(120001);
  const recoveredRelease = await f.release(releaseBody);
  assert.equal(recoveredRelease.replayed, true);
  assert.equal(recoveredRelease.collection.id, first.collection.id);
  assert.deepEqual(recoveredRelease.deposit.remaining, qty(4, 1, 1));
  assert.equal(f.store.collections.length, 1);
  pass('The exact recorded release can be recovered after claim expiry without subtracting again');

  const handoverBody = f.confirmBody('handover-one');
  const completed = await f.confirm(first.collection.id, handoverBody);
  assert.equal(completed.collection.status, 'HANDED_OVER');
  assert.equal(completed.deposit.pending_collection, null);
  const completedAuditCount = f.store.audit.length;
  const handoverReplay = await f.confirm(first.collection.id, handoverBody);
  assert.equal(handoverReplay.replayed, true);
  assert.equal(handoverReplay.collection.status, 'HANDED_OVER');
  assert.equal(f.store.audit.length, completedAuditCount);
  pass('Repeated handover confirmation with the same action ID produces one confirmed custody event');

  const stale = await setup();
  const oldClaim = await stale.verify();
  const staleRelease = await stale.release(stale.releaseBody(oldClaim, 'first', qty(1, 0, 0)));
  await stale.confirm(staleRelease.collection.id, stale.confirmBody('confirmed'));
  await assert.rejects(stale.release(stale.releaseBody(oldClaim, 'new-action-old-claim', qty(1, 0, 0))), /balance changed/i);
  assert.deepEqual(stale.store.state(event).deposits[0].remaining, qty(5, 2, 1));
  assert.equal(stale.store.collections.length, 1);
  pass('A pre-release verification cannot authorize a fresh action after handover changes the deposit version');

  const secondVerification = await f.verify();
  assert.deepEqual(secondVerification.deposit.remaining, qty(4, 1, 1));
  const second = await f.release(f.releaseBody(secondVerification, 'release-two', qty(0, 1, 1)));
  await f.confirm(second.collection.id, f.confirmBody('handover-two'));
  assert.deepEqual(f.store.state(event).deposits[0].remaining, qty(4, 0, 0));
  pass('The same shared code supports a later VIP/VVIP-only pickup without reducing Normal passes');

  const oldReleaseReplay = await f.release(releaseBody);
  assert.equal(oldReleaseReplay.replayed, true);
  assert.deepEqual(oldReleaseReplay.deposit.remaining, qty(4, 0, 0));
  assert.equal(oldReleaseReplay.collection.status, 'HANDED_OVER');
  assert.equal(oldReleaseReplay.deposit.pending_collection, null);
  assert.equal(f.store.collections.length, 2);
  pass('Recovery of an older release returns current balances and completion state after later pickups');

  const beforeInvalid = f.store.state(event);
  const current = await f.verify();
  for (const invalid of [
    { normal: 1, vip: 0 },
    { ...qty(1, 0, 0), extra: 1 },
    { normal: '1', vip: 0, vvip: 0 },
    qty(0.5, 0, 0), qty(-1, 0, 0), qty(0, 0, 0), qty(101, 0, 0)
  ]) {
    await assert.rejects(f.release(f.releaseBody(current, crypto.randomUUID(), invalid)));
  }
  await assert.rejects(f.release(f.releaseBody(current, 'exhausted-vip', qty(0, 1, 0))), /exceed/i);
  assert.deepEqual(f.store.state(event), beforeInvalid);
  pass('Malformed counts and exhausted-category collection fail atomically without changing stock or history');

  const [winner, loser] = await Promise.allSettled([
    f.release(f.releaseBody(current, 'parallel-one', qty(3, 0, 0))),
    f.release(f.releaseBody(current, 'parallel-two', qty(3, 0, 0)))
  ]);
  assert.equal(winner.status, 'fulfilled');
  assert.equal(loser.status, 'rejected');
  assert.deepEqual(f.store.state(event).deposits[0].remaining, qty(1, 0, 0));
  assert.equal(f.store.collections.length, 3);
  pass('Distinct repeated actions with the same stale balance allow one release and cannot over-collect');

  const publicState = f.store.state(event);
  publicState.deposits[0].remaining.normal = 900;
  publicState.deposits[0].pending_collection.quantities.normal = 900;
  assert.deepEqual(f.store.state(event).deposits[0].remaining, qty(1, 0, 0));
  assert.equal(f.store.state(event).deposits[0].pending_collection.quantities.normal, 3);
  assert(!JSON.stringify(f.store.state(event)).includes(f.created.collection_code));
  pass('Read snapshots are isolated copies and do not expose the bearer code in inventory or custody history');

  console.log(`${checks} tactile workflow model checks passed. Browser transitions and accessibility require browser verification.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
