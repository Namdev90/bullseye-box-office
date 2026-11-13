# SharePass recording update

The depositor scans the booth QR, enters the details and submits. This creates a private waiting draft and notifies staff without allocating a pickup code or recording custody. After staff count and approve physical receipt, SharePass generates the four-digit code. The depositor's open receipt updates automatically with the code and recipient-specific WhatsApp draft buttons. WhatsApp messages require the sender's action.

Pickup combines the depositor name, available quantities, selection and physical-handover confirmation on one screen. The client journals the confirmed intent before using the existing release and handover operations. Interrupted operations retain their original request IDs. Pending handovers remain distinct from completed stock, including when every pass has been reserved.

Normal screens show four-digit codes. Current receipt identity stays in validated links and QR payloads; reused codes still require the current receipt. Existing receipt formats remain supported. History actions always read the current code and stock, and preserve the original operator/admin restrictions on pending handovers.

Administrator messages default to All and track one response per authenticated person across their devices. Existing booth-level messages retain their previous behavior. Administrators reply through their owner session even when that browser also has a staff-device connection. Done, Working and Need help are final selectable responses; Later defers the message.

Deleting a booth archives it. New intake and setup stop, while history, reports and existing custody remain available. The migration only adds the archive flag, per-person message flag and recipient acknowledgment table. It does not remove existing records or change pickup-code allocation policy.

Static assets use an application version and content fingerprint. Authenticated APIs remain no-store. Foreground queue fallback is 60 seconds and waiting receipts refresh every 15 seconds, with visibility and connection handling. Manual refresh remains available to staff; report export uses the displayed snapshot and escapes spreadsheet formulas.

The update retains approved artwork and the existing Android signing identity. Android uses its native UI, QR scanner, platform speech and existing signed updater. The opening animation is about 1.2 seconds, with reduced-motion support. No new application dependency, signing key or AI service is required.

Routine receipt alert toggles are removed at the owner's request. Receipt alerts remain permission-controlled and bounded; customers can revoke SharePass notifications through their browser settings. The existing scoped Stop API and safe subscription cleanup remain available to older clients. Staff notification and sound recovery is available contextually through Help, without restoring the standalone settings screen.

## Validation boundaries

Run the hosted and Android suites and the exact-source JVM fixtures before publication. Set `SHAREPASS_MINIFLARE_MODULE` to an existing Miniflare installation to execute the real Workerd release regression. It uses deterministic outbound responses and disables automatic network-metadata fetching.

Browser and JVM tests do not establish physical-phone installation, camera, audible speech, background notification receipt or an in-place upgrade. Those acceptance checks remain separate. Release notification service acceptance must also be distinguished from handset receipt.
