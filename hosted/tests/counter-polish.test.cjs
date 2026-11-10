'use strict';

// Source contracts only. These do not substitute for rendered touch-target,
// font, keyboard, narrow-screen or reduced-motion browser acceptance.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const web=join(__dirname,'../web');
const read=file=>readFileSync(join(web,file),'utf8');
const css=read('counter.css').replace(/\/\*[\s\S]*?\*\//g,'');

function ruleFor(selectors){
  const expected=selectors.map(value=>value.replace(/\s+/g,' ').trim()).sort();
  const matches=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,selector])=>{
    const actual=selector.split(',').map(value=>value.replace(/\s+/g,' ').trim()).sort();
    return JSON.stringify(actual)===JSON.stringify(expected);
  });
  assert.equal(matches.length,1,'Expected one rule for '+selectors.join(', '));
  return matches[0][2];
}

test('optional staff and message disclosures retain native affordances and larger targets',()=>{
  const rule=ruleFor(['#queue-code-options>summary','.draft-card summary']);
  assert.match(rule,/min-height:\s*44px\s*(?:;|$)/);
  assert.match(rule,/padding:\s*\.65rem\s+0\s*(?:;|$)/);
  assert.match(rule,/line-height:\s*1\.5\s*(?:;|$)/);
  assert.match(rule,/cursor:\s*pointer\s*(?:;|$)/);
  assert.doesNotMatch(rule,/(?:^|;)\s*(?:display|list-style(?:-type)?|height|overflow):/);
  assert.match(read('counter.html'),/<details id="queue-code-options"><summary>Code and expiry options<\/summary>/);
  assert.match(read('share-drafts.js'),/preview\.append\(node\('summary','Preview message'\),message\)/);
  assert.match(css,/:focus-visible\{outline:3px solid #[0-9a-f]+;outline-offset:4px\}/);
});

test('counter counts and wizard positions use equal-width digits without fixed-width clipping',()=>{
  const rule=ruleFor(['.step input','.wizard-progress','#queue-counts','#intake-counts','#handover-summary','#balance','#allocation-balance']);
  assert.match(rule,/font-variant-numeric:\s*tabular-nums\s*(?:;|$)/);
  assert.doesNotMatch(rule,/(?:^|;)\s*(?:width|height|overflow|white-space):/);
  for(const id of ['queue-counts','intake-counts','handover-summary','balance'])assert.match(read('counter.html'),new RegExp('id="'+id+'"'));
  assert.match(read('intake.html'),/id="allocation-balance"/);
  assert.match(read('share-drafts.js'),/node\('span',undefined,'wizard-progress'\)/);
});

test('reduced motion disables press travel as well as transitions without changing the default feedback',()=>{
  assert.match(css,/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*button,\.menu-link,\.opening \.primary\{transition:none\}\s*button:not\(:disabled\):active,\.menu-link:active,\.opening \.primary:active\{transform:none\}\s*\}/);
  const defaultPress='button:not(:disabled):active,.menu-link:active,.opening .primary:active{transform:translateY(2px)}';
  const reducedPress='button:not(:disabled):active,.menu-link:active,.opening .primary:active{transform:none}';
  assert.ok(css.includes(defaultPress),'Default button press feedback remains available');
  assert.ok(css.indexOf(reducedPress)>css.indexOf(defaultPress),'The reduced-motion override follows default press feedback');
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;scroll-behavior:auto!important\}\}/);
});
