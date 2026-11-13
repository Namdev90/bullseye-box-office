import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {messageReadFixture} from './helpers/read-fixture.mjs';

test('message recipient reads stay bounded to the visible owner-scoped page',async t=>{
  const fixture=await messageReadFixture(worker);t.after(fixture.close);
  fixture.reset();const response=await fixture.call();assert.equal(response.status,200);
  const body=JSON.parse(response.text),metrics=fixture.metrics();
  assert.equal(body.messages.length,50);assert.equal(body.inbox.length,20);
  assert(body.messages.every(message=>message.responses.length===12));
  assert(!response.text.includes('PRIVATE_OTHER_'));
  assert.equal(metrics.recipientQueries,1,'Fetch the selected page recipients in one scoped query');
  const recent=fixture.plans().find(query=>query.sql.includes('ORDER BY created_at DESC,id DESC LIMIT 50'));
  assert(recent.plan.some(detail=>detail.includes('sharepass_staff_prompt_recent')));
  assert(recent.plan.every(detail=>!detail.includes('TEMP B-TREE')),'The recent-message page must read index order');
  assert.equal((await fixture.call('/api/admin/staff-messages','outsider')).status,403);
});

test('legacy-only message pages do not add a recipient query or change legacy response fields',async t=>{
  const fixture=await messageReadFixture(worker,0);t.after(fixture.close);
  fixture.reset();const response=await fixture.call();assert.equal(response.status,200);
  const body=JSON.parse(response.text);
  assert.equal(body.messages.length,50);assert(body.messages.every(message=>!Object.hasOwn(message,'responses')));
  assert.equal(fixture.metrics().recipientQueries,0);
});
