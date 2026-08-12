# Device and accessibility release matrix

Run this matrix against every production candidate. Record device, OS/browser version, tester, date and result in the release issue.

## Required devices

- iPhone Safari: current and previous iOS; email code autofill, public ticket, camera permission, Apple Wallet.
- Android Chrome: current Android; email code autofill, public ticket, camera permission, offline scan and recovery. Google Wallet is deferred.
- iPad Safari and Android tablet Chrome: portrait/landscape operations, tables, dialogs and scanner.
- Desktop: current Chrome, Safari, Edge and Firefox at 1280×720 and 1920×1080.
- Assistive technology: VoiceOver/Safari and NVDA/Firefox or Chrome.

## Critical journeys

1. Request and enter an eight-digit code; verify generic responses, expiry, resend and lockout.
2. Create an event, zones, gates, single ticket and bulk tickets; verify keyboard-only operation and error focus.
3. Scan full and partial admission online; deny duplicate/expired QR.
4. Lose connectivity, admit from a valid offline pack, reconnect and reconcile exactly once.
5. Revoke scanner access and operator sessions; confirm access stops on the next server request.
6. Open the public ticket at 200% zoom and increased text size; verify QR, status and instructions remain usable.
7. Generate an Apple Wallet pass on a configured environment and verify barcode admission.

## Accessibility gates

- No keyboard traps; visible focus; Escape closes dialogs and focus returns to the trigger.
- Labels, errors and live status are announced; colour is never the only status signal.
- Target size is at least 44×44 CSS pixels for operational controls.
- Reduced-motion mode removes rotation and spatial movement while preserving state feedback.
- Contrast meets WCAG 2.2 AA, including event-configured ticket colours.

Any failure in authentication, scanning, offline reconciliation, session revocation or ticket validity blocks release.
