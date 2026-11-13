import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Copy complete production methods, including nested lambdas, without rewriting
// Java as JavaScript or maintaining a second implementation in the fixtures.
// Fail closed when a signature changes or becomes ambiguous.
export function extractJavaMethod(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0 || source.indexOf(signature, start + signature.length) >= 0) {
    throw new Error(`Expected exactly one production method: ${signature}`);
  }
  const opening = start + signature.length;
  const tail = /^\s*\{/.exec(source.slice(opening));
  if (!tail) throw new Error(`Missing method body: ${signature}`);
  let depth = 0, state = 'code';
  for (let i = opening + tail[0].length - 1; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (state === 'line') { if (c === '\n') state = 'code'; continue; }
    if (state === 'block') { if (c === '*' && next === '/') { state = 'code'; i++; } continue; }
    if (state === 'string' || state === 'char') {
      if (c === '\\') { i++; continue; }
      if (c === (state === 'string' ? '"' : "'")) state = 'code';
      continue;
    }
    if (source.slice(i, i + 3) === '"""') throw new Error('Java text blocks need explicit extractor support');
    if (c === '/' && next === '/') { state = 'line'; i++; }
    else if (c === '/' && next === '*') { state = 'block'; i++; }
    else if (c === '"') state = 'string';
    else if (c === "'") state = 'char';
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unclosed method body: ${signature}`);
}

export function sourceHarnesses() {
  return [
    ['AppUpdatesFocusTest', 'AppUpdates', [
      'void start()', 'void stop()', 'void cancelDownload()', 'void focusChanged(boolean focused)',
      'private boolean ready()', 'private void install(UpdatePolicy.Release release, File file)',
    ]],
    ['DeskWindowInsetsTest', 'DeskWindow', [
      'boolean contains(float x, float y)', 'private DeskGeometry.Area insets(int height)',
    ]],
    ['NativeLookupTest', 'HostedDeskActivity', ['private void autoAdvance(EditText field, Predicate<String> ready, Runnable advance)', 'private static String firstNonEmpty(String... values)']],
    ['StaffMessageInboxTest', 'HostedDeskActivity', [
      'private boolean staffMessagesAllowed()', 'private JSONObject pendingStaffMessage(String id)',
      'private void presentStaffDialog(AlertDialog next)', 'private void showStaffMessage(boolean manual)',
      'private void openStaffMessage(String id, String session)', 'private static boolean validQueueToken(String token)',
    ]],
  ].map(([name, production, signatures]) => {
    const source = readFileSync(join(root, 'android-app/src/main/java/in/sharepass/foundation', `${production}.java`), 'utf8');
    const template = readFileSync(join(root, 'tests/source-harnesses', `${name}.java.in`), 'utf8');
    if (template.split('/* PRODUCTION_METHODS */').length !== 2) throw new Error(`Invalid fixture marker: ${name}`);
    return {name, source: template.replace('/* PRODUCTION_METHODS */', signatures.map(signature => extractJavaMethod(source, signature)).join('\n\n    '))};
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node tools/prepare-source-harnesses.mjs OUTPUT_DIRECTORY');
  const output = resolve(process.argv[2]);
  mkdirSync(output, {recursive: true});
  for (const {name, source} of sourceHarnesses()) writeFileSync(join(output, `${name}.java`), source);
  console.log('Prepared exact-source JVM fixtures. These are not Android lifecycle or rendering acceptance.');
}
