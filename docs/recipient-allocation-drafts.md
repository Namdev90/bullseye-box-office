# Recipient allocation draft correctness

## Scope and meaning

This patch starts from `39ef8c6078cec5d3eb5954b330de627c22dacfb4` and changes message preparation in the hosted staff sharing view and native Android hosted desk. It does not change stock, custody, authentication, code validation, subscriptions or delivery permissions.

The version-2 customer intake assigns the original deposit quantities among recipients. The Worker verifies that those original allocations add up to the deposit. It records pickups against the group's remaining stock, not against individual recipients. An allocation is therefore a **planned share**, not an enforced entitlement or a personal remaining balance.

- Preserve each explicit recipient `quantities` object through rendering, contact edits, local saves and reopening. Removing a contact does not redistribute their plan.
- In allocated drafts, show the original planned share and the group's remaining counts from that receipt separately. Never clamp an original plan to the group balance or guess who already collected.
- Identify the counts as receipt data, not a fresh inventory query. Both message kinds say that the code is shared, staff must confirm availability and pickups are not tracked per person.
- Legacy contacts and contacts added at the desk without an allocation receive group-level draft text. Adding or editing a contact does not assign them passes.
- Invalid explicit allocation data cannot silently become an unallocated group draft. Preserve it for review rather than dropping it when another contact is saved. An allocated contact with an invalid or missing phone remains available for contact repair. An entirely exhausted group receipt still cannot produce a new draft, as before.
- Android's in-memory sharing cache is bound to both code and packet ID so a reused code cannot reuse another packet's recipient plans.

The public customer receipt passes each person's original quantities, but no group remaining balance, to the draft formatter. Its intake flow, receipt polling and alert implementation are unchanged. The shared formatter now labels those quantities as a planned share and omits group availability entirely.

### Exported helper compatibility

`SharePassDrafts.depositDraft` defaults to `scope: 'planned'`: `quantities` is the original recipient plan, not current group stock. An explicit `scope: 'group'` means `quantities` contains the group's balance from a receipt; an optional `allocation` then supplies that recipient's original plan separately. Unknown scopes and `allocation` supplied outside group mode are rejected instead of guessed.

The production caller inventory in `hosted/web` is two call sites: the internal staff `renderDeposit` generator and `intake.js`'s `showReceipt`. The renderer explicitly selects group mode; the unchanged public intake call intentionally uses planned-only mode. This changes the exported helper's former implicit group default. Direct callers/test fixtures that supply group counts must now pass `scope: 'group'`. Android's existing explicit group/planned formatter semantics are unchanged.

PR #15's separately owned QR expectation needs the additive `scope: 'group'` argument in its direct `depositDraft({...example,...recipients[index],scope:'group'})` call when integrated. That argument is harmless to the older helper, which ignores it. This patch does not edit that PR's test file. A temporary copy of the adjusted four-test fixture passes against both the original helper and this patch. This patch does not introduce an allocation editor, a per-recipient stock ledger or an automatic freshness check. Earlier saved contacts whose allocation has already been discarded cannot be reconstructed; they remain group-level contacts until an authoritative receipt supplies an allocation.

All WhatsApp messages remain drafts. Preparing a draft or displaying a QR makes no network request. Opening WhatsApp remains an explicit user action, with existing URL encoding and length validation. Backend physical packet and custody checks remain authoritative.

## Verification

On the isolated patch tree:

- Public hosted build and generated Worker syntax passed. All **84 hosted test entries passed**.
- Android web syntax, release-tool syntax and all **65 Android web/boundary test entries passed**.
- The original `WhatsAppDraftTest` and new `RecipientAllocationDraftTest` compiled and ran on the available Java 21 JVM. The new test checks exact web/native fixture text, two distinct allocations, partial group stock, legacy contacts, unmodified inputs, malformed counts and URL round-tripping.
- New hosted tests execute the production renderer's prepare/edit/save/remove/reopen handlers in a synthetic DOM, including auto-advance, invalid contacts, invalid allocations, QR display, cleared handlers and a replacement code. Another test executes the actual public intake `showReceipt` function with unequal recipient plans and verifies that it emits no fabricated group balance. Unknown-scope and ambiguous-allocation checks cover the exported helper contract. Fetch, XHR, external navigation and camera calls are trapped and remain unused.
- Android load/save, uncoerced quantity adaptation, packet-bound cache and explicit sharing-button wiring have source-contract coverage. These are not executed Activity or journal tests.
- Ten deliberate hosted regressions and three native formatter regressions were rejected by their tests. All 41 generated assets match source bytes and the public build remains unbound. All hosted browser-script syntax and diff checks passed.

Reproduce from the repository root:

```sh
(cd hosted && node scripts/build.mjs && node --check dist/server/index.js && node --test tests/*.test.mjs tests/*.test.cjs)
(cd android && npm run check && node --check tools/sharepass-release.mjs && npm test)
out=$(mktemp -d)
java --module jdk.compiler/com.sun.tools.javac.Main -d "$out" \
  android/android-app/src/main/java/in/sharepass/foundation/WhatsAppDraft.java \
  android/tests/java/WhatsAppDraftTest.java \
  android/tests/java/in/sharepass/foundation/RecipientAllocationDraftTest.java
java -cp "$out" in.sharepass.foundation.WhatsAppDraftTest
java -cp "$out" in.sharepass.foundation.RecipientAllocationDraftTest
```

This cloud environment has the Java compiler module but no `javac` launcher. The command above uses that existing module and installs nothing. The existing GitHub workflow automatically includes the new Java test in its native test glob after its Android build.

## Remaining gates

Full Android compilation/lint and CI for the final source are not established by the local formatter tests. Supported-browser rendering, keyboard/screen-reader behavior, Android Activity/journal execution, emulator/device acceptance and actual QR scanning were not run. No APK was built or signed here, and no release version, release feed, production database or deployment was changed.

Keep this work isolated from the alert-lifetime, accessibility/QR and refresh-recovery drafts until review. The patch uses new test files rather than modifying their owned tests or runtime files. Existing shipped artifacts are not evidence for this source tree.
