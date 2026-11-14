const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const root = join(__dirname, '..');
const read = file => readFileSync(join(root, file), 'utf8');
const harness = import('../tools/prepare-source-harnesses.mjs');

test('Java method extraction preserves lambdas, comments, braces and quoted characters', async () => {
  const {extractJavaMethod} = await harness;
  const method = `void example() {
    // Ignore a closing brace: }
    String text = "{escaped \\\" quote}";
    char brace = '}'; /* { nested-looking comment } */
    Runnable later = () -> { if (true) { System.out.println(text); } };
  }`;
  assert.equal(extractJavaMethod(`class Example { ${method} void next() {} }`, 'void example()'), method);
  assert.throws(() => extractJavaMethod(method, 'void missing()'), /exactly one/);
  assert.throws(() => extractJavaMethod(method + method, 'void example()'), /exactly one/);
  assert.throws(() => extractJavaMethod('void example() {', 'void example()'), /Unclosed/);
  assert.throws(() => extractJavaMethod('void example();', 'void example()'), /Missing method body/);
});

test('JVM fixture generation uses current production methods and needs no Java installation', async () => {
  const {sourceHarnesses, extractJavaMethod} = await harness;
  const fixtures = sourceHarnesses();
  assert.deepEqual(fixtures.map(f => f.name), ['QueueSummaryTest', 'QrEncoderCacheTest', 'DirectHandoverTest', 'AppUpdatesFocusTest', 'DeskWindowInsetsTest', 'NativeLookupTest', 'StaffMessageInboxTest']);
  for (const fixture of fixtures) assert(!fixture.source.includes('/* PRODUCTION_METHODS */'));
  const desk = read('android-app/src/main/java/in/sharepass/foundation/HostedDeskActivity.java');
  assert(fixtures.find(f=>f.name==='StaffMessageInboxTest').source.includes(extractJavaMethod(desk, 'private void showStaffMessage(boolean manual)')));
  const updates = read('android-app/src/main/java/in/sharepass/foundation/AppUpdates.java');
  const window = read('android-app/src/main/java/in/sharepass/foundation/DeskWindow.java');
  assert(fixtures.find(f=>f.name==='AppUpdatesFocusTest').source.includes(extractJavaMethod(updates, 'private void install(UpdatePolicy.Release release, File file)')));
  assert(fixtures.find(f=>f.name==='DeskWindowInsetsTest').source.includes(extractJavaMethod(window, 'private DeskGeometry.Area insets(int height)')));
});

test('opening layout remains scrollable and Activity lifecycle forwards update events', async () => {
  // Source wiring contract only. JVM fixtures exercise the forwarded methods;
  // neither fixture measures layout nor establishes real Activity acceptance.
  const {extractJavaMethod} = await harness;
  const source = read('android-app/src/main/java/in/sharepass/foundation/MainActivity.java');
  const opening = extractJavaMethod(source, 'private void showOpening()');
  assert.match(opening, /new ScrollView\(this\)/);
  assert.match(opening, /scroll\.setFillViewport\(true\)/);
  assert.match(opening, /scroll\.addView\(stage\)/);
  assert.match(opening, /opening\.addView\(scroll/);
  assert.match(opening, /showSurface\(opening,\s*560\)/);
  assert.match(opening, /DeskGeometry\.openingArtHeight\(/);
  assert.match(extractJavaMethod(source, 'protected void onPause()'), /updates\.stop\(\)/);
  assert.match(extractJavaMethod(source, 'protected void onResume()'), /updates\.start\(\)/);
  assert.match(extractJavaMethod(source, 'public void onWindowFocusChanged(boolean focused)'), /updates\.focusChanged\(focused\)/);
  assert.match(extractJavaMethod(source, 'public boolean dispatchTouchEvent(android.view.MotionEvent event)'), /ACTION_DOWN\) updates\.cancelDownload\(\)/);
});
