# Production Acceptance Checklist

Complete this checklist on a Netlify deploy preview and again after the production release.

## Account access

- [ ] Public signup is visible and registration is open.
- [ ] A new account receives a confirmation email and signs in as `pending` with no access to company data.
- [ ] A manager approves the pending account as `member`; access takes effect after sign-out/sign-in.
- [ ] Password recovery completes successfully.
- [ ] A manager changes a member to dispatcher; the role takes effect after sign-out/sign-in.
- [ ] A member cannot access dispatcher or manager mutations.

## Booking lifecycle

- [ ] Member creates and edits their own pending request.
- [ ] Duplicate offline submission is prevented by idempotency.
- [ ] Dispatcher approves, starts, and completes the request.
- [ ] Dispatcher assigns a person, vehicle, and duration; overlapping approved jobs show a conflict warning.
- [ ] Completion captures actual minutes, kilometres, receiving contact, notes, and actual cost.
- [ ] Search and filters return the expected bookings by site, status, type, date, requester, supplier and PO/cost code.
- [ ] Conflicting edits return 409 and refresh safely.
- [ ] Dispatcher deletes a test request and its photo.

## Sites and routes

- [ ] Dispatcher opens Add Site.
- [ ] Canadian address suggestions appear while typing.
- [ ] Selected address stores canonical address and coordinates.
- [ ] Route begins at Faithwood Farms, 4368 Lochside Drive, Saanich (`48.4952, -123.3698`).
- [ ] With `MAPBOX_ACCESS_TOKEN`, route source displays as live road route.
- [ ] Site rename, duplicate-name rejection, and delete work on two devices without lost updates.

## Photos, reporting, and recovery

- [ ] JPEG, PNG, and WebP uploads under 5 MB work; disallowed files fail.
- [ ] Members cannot view another requester's private photo.
- [ ] Manager summary totals match the selected date range.
- [ ] Manager role administration produces an audit event.
- [ ] Manager creates and downloads a backup.
- [ ] Recovery is tested on a non-production preview.

## Quality

- [ ] iPhone/mobile layout works without horizontal scrolling.
- [ ] The app installs to the home screen and reopens its cached shell without reception.
- [ ] Keyboard-only navigation can operate forms and dialogs.
- [ ] Health endpoint returns HTTP 200.
- [ ] No unexpected browser-console or function-log errors remain.
