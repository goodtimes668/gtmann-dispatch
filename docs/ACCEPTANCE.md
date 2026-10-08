# Production Acceptance Checklist

Complete this checklist on a Netlify deploy preview and again after the production release.

## Account access

- [ ] Public signup is visible and registration is open.
- [ ] A new account receives a confirmation email and signs in as `member`.
- [ ] Password recovery completes successfully.
- [ ] A manager changes a member to dispatcher; the role takes effect after sign-out/sign-in.
- [ ] A member cannot access dispatcher or manager mutations.

## Booking lifecycle

- [ ] Member creates and edits their own pending request.
- [ ] Duplicate offline submission is prevented by idempotency.
- [ ] With the network disconnected, Approve/Decline/Start/Complete shows a failure and leaves the booking status unchanged; retry after reconnecting.
- [ ] A blocked offline booking remains visible for discard and resubmission and is not silently retried on each refresh.
- [ ] Dispatcher approves, starts, and completes the request.
- [ ] Member submits a flexible, morning, afternoon, and specific-time request; a specific time cannot be left blank.
- [ ] Request contact, helper requirement, and expected equipment return appear to the dispatcher and in the calendar details.
- [ ] Dispatcher assigns each supported truck type and a driver; a same-day overlap is flagged and requires an explicit override.
- [ ] Dispatcher records an equipment return; the open-return list clears and the return update is audited.
- [ ] Slack request and assignment alerts include the dispatch details and link back to the app.
- [ ] A request submitted from the Slack shortcut form appears in the app as pending within seconds, and the requester receives a Slack confirmation.
- [ ] A Slack request from someone with a Dispatch account is editable by them in the app; one from someone without an account is visible to dispatchers.
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
- [ ] Keyboard-only navigation can operate forms and dialogs.
- [ ] Health endpoint returns HTTP 200.
- [ ] No unexpected browser-console or function-log errors remain.
