// Small state-machine regression tests, not a DOM/browser or visual substitute.
// Uses only Node built-ins: node tests/ui_state_test.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');

async function setup() {
  const nodes = new Map();
  class Element {
    constructor() { this.value = ''; this.disabled = false; this.open = false; this.textContent = ''; this.classes = new Set(); this.classList = {add: x => this.classes.add(x), remove: x => this.classes.delete(x), toggle: (x, force) => { const add = force ?? !this.classes.has(x); add ? this.classes.add(x) : this.classes.delete(x); }}; }
    set innerHTML(value) { this.html = value; for (const match of value.matchAll(/id="([^"]+)"/g)) if (!nodes.has('#' + match[1])) nodes.set('#' + match[1], new Element()); }
    get innerHTML() { return this.html || ''; }
    addEventListener() {} querySelectorAll() { return []; } setAttribute() {} showModal() { this.open = true; } close() { this.open = false; }
    prepend(node) { nodes.set('#' + node.id, node); }
    remove() { for (const [key, node] of nodes) if (node === this) nodes.delete(key); }
  }
  const html = fs.readFileSync(new URL('../static/index.html', 'file://' + __filename), 'utf8');
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set('#' + match[1], new Element());
  for (const selector of ['.avatar', 'main', '#operator-form input']) nodes.set(selector, new Element());
  const storage = new Map([['staff_name', 'Demo Operator']]);
  const mutations = [nodes.get('#save-deposit')];
  const currentState = {event_name:'Training', packets:[], audit:[], counts:{}, csrf:'csrf-test'};
  const document = {hidden:false, querySelector: key => nodes.get(key) || null, querySelectorAll: key => key === '[data-mutation]' ? mutations : [], createElement: () => new Element()};
  const context = vm.createContext({document, sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}, window:{addEventListener(){},print(){}}, console, crypto:webcrypto, AbortController, setTimeout, clearTimeout, setInterval:()=>0, fetch:async()=>({ok:true,status:200,json:async()=>currentState})});
  vm.runInContext(fs.readFileSync(new URL('../static/app.js', 'file://' + __filename), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return {context,nodes,storage,currentState,Element,run:code=>vm.runInContext(code,context)};
}

(async () => {
  let passed = 0;
  async function test(name, action) { const state = await setup(); await action(state); passed++; console.log('PASS:',name); }

  await test('HTML escaping keeps input inert', ({run}) => {
    assert.equal(run(`esc('<img src=x onerror="bad()">')`), '&lt;img src=x onerror=&quot;bad()&quot;&gt;');
  });
  await test('Lost response preserves original request and blocks mutations', async ({context,run,storage,nodes}) => {
    context.fetch = async () => { throw new Error('response lost'); };
    await assert.rejects(run(`mutate('/api/deposits', {request_id:'same-id',operator:'Demo Operator'})`), /Outcome uncertain/);
    assert.equal(JSON.parse(storage.get('pending_action')).body.request_id, 'same-id');
    assert.equal(nodes.get('#new-deposit').disabled, true);
    assert.equal(nodes.get('#save-deposit').disabled, true);
  });
  await test('Recovery authentication failure never discards original request', async ({context,run,storage}) => {
    storage.set('pending_action', JSON.stringify({url:'/api/deposits',body:{request_id:'original'}}));
    context.fetch = async () => ({ok:false,status:403,json:async()=>({error:'Session changed'})});
    await assert.rejects(run(`mutate('/api/deposits', {request_id:'original'}, true)`));
    assert.equal(JSON.parse(storage.get('pending_action')).body.request_id, 'original');
  });
  await test('Known fresh validation failure clears request but not an uncertain retry', async ({context,run,storage}) => {
    context.fetch = async () => ({ok:false,status:400,json:async()=>({error:'Wrong label'})});
    await assert.rejects(run(`mutate('/api/packets/p/release', {request_id:'bad-label'})`), /Wrong label/);
    assert.equal(storage.has('pending_action'), false);
  });
  await test('Recovered deposit restores receipt presentation', async ({context,run,storage,currentState}) => {
    storage.set('pending_action', JSON.stringify({url:'/api/deposits',body:{request_id:'original'}}));
    context.fetch = async url => ({ok:true,status:200,json:async()=>url === '/api/state' ? currentState : {packet:{id:'p',status:'READY',version:1},replayed:true}});
    run(`var shown = null; showPacket = (packet, receipt) => { shown = {packet,receipt}; };`);
    await run('recover()');
    assert.equal(run('shown.receipt'), true);
    assert.equal(storage.has('pending_action'), false);
  });
  await test('Refreshed dialog adopts newer completed state', async ({run,currentState,nodes}) => {
    nodes.get('#packet-dialog').open = true;
    run(`selectedPacket = {id:'p',version:2,status:'RELEASE_RECORDED'}; var updated = null; showPacket = packet => { updated = packet; }; render = () => {};`);
    currentState.packets = [{id:'p',version:3,status:'HANDED_OVER'}];
    await run('refresh()');
    assert.equal(run('updated.status'), 'HANDED_OVER');
  });
  await test('Disconnected handover instructions are replaced by blocking warning', ({run,nodes,Element}) => {
    nodes.set('#packet-live-warning', new Element()); nodes.set('#packet-procedure', new Element());
    run(`selectedPacket = {id:'p',status:'RELEASE_RECORDED'}; connection(false);`);
    assert.equal(nodes.get('#packet-live-warning').classes.has('hidden'), false);
    assert.equal(nodes.get('#packet-procedure').classes.has('hidden'), true);
    assert.equal(nodes.get('#save-deposit').disabled, true);
  });
  await test('Older refresh cannot downgrade a newer open dialog', async ({run,currentState,nodes}) => {
    nodes.get('#packet-dialog').open = true;
    run(`selectedPacket = {id:'p',version:3,status:'HANDED_OVER'}; var downgraded = false; showPacket = packet => { downgraded = packet.version < 3; }; render = () => {};`);
    currentState.packets = [{id:'p',version:2,status:'RELEASE_RECORDED'}];
    await run('refresh()');
    assert.equal(run('downgraded'), false);
    assert.equal(run('state.packets[0].version'), 3);
  });
  await test('Recovery prefers newer refresh over an earlier replay response', async ({context,run,storage,currentState}) => {
    storage.set('pending_action', JSON.stringify({url:'/api/packets/p/release',body:{request_id:'original'}}));
    let reads = 0;
    context.fetch = async url => ({ok:true,status:200,json:async()=>url === '/api/state' ? {...currentState,packets:++reads === 1 ? [] : [{id:'p',version:3,status:'HANDED_OVER'}]} : {packet:{id:'p',status:'RELEASE_RECORDED',version:2},replayed:true}});
    run(`var recoveredPacket = null; showPacket = packet => { recoveredPacket = packet; }; render = () => {};`);
    await run('recover()');
    assert.equal(run('recoveredPacket.status'), 'HANDED_OVER');
  });
  console.log(`${passed} state-machine checks passed. These do not validate a real browser or visual layout.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
