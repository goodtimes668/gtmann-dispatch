# GT Mann Dispatch Operations Runbook

## Production ownership

- Production URL: `https://gtmann-dispatch.netlify.app/`
- Source repository: `https://github.com/goodtimes668/gtmann-dispatch`
- Production branch: `main` after release acceptance
- Hosting, Identity, Blobs, environment variables, and deploy logs are controlled in the buyer's Netlify account.

Never place Netlify, Mapbox, or Slack secrets in Git. Rotate transferred secrets after handover.

## User access

Netlify Identity registration must be set to **Open** under Project configuration → Identity → Registration. Email confirmation remains enabled. Every public signup receives the `member` role from `identity-signup.mts`; managers grant higher roles in the Manager screen.

Identity cannot be tested through `netlify dev`. Use a deploy preview for signup, confirmation, invitation, recovery, and role acceptance testing.

## Monitoring

Monitor `GET /api/health` at least every five minutes. A healthy response returns HTTP 200 and `status: ok`.

Netlify function logs emit structured JSON for unexpected errors and scheduled backup completion. A user-facing 500 response includes a `requestId`; use that value to locate the matching function log without exposing internal errors.

Recommended alerts:

- Health endpoint unavailable for two consecutive checks
- Any `function_failure` event
- No `scheduled_backup_complete` event within 26 hours
- Repeated HTTP 429 responses from a single workflow

## Backups

A scheduled function creates a daily snapshot containing bookings, sites, recent audit events, and copies of every stored photo. Managers can create and download an additional snapshot from the Manager screen before deployments or major data changes.

Before a release:

1. Sign in as a manager.
2. Open Manager → Backups & Recovery.
3. Select **Create Backup Now**.
4. Download the new snapshot and store it in the buyer-controlled handover location.

## Recovery

Only a manager may restore a server-side snapshot. Recovery is intentionally not exposed as a one-click browser control.

1. Confirm the backup ID and download a copy.
2. Pause operational use of the app.
3. Send `PUT /api/admin/backups/:id` from an authenticated same-origin administrative session with a unique `Idempotency-Key` header and JSON `{ "confirmation": "RESTORE" }`.
4. Verify booking counts, sites, photos, and roles.
5. Create a new post-recovery backup.
6. Review the `backup.restored` audit event.

Restore overwrites matching records from the snapshot and does not silently delete newer unmatched records. This avoids turning an incorrect recovery selection into broad data loss.

## Release procedure

1. Run `npm test` and `npm run build`.
2. Deploy a preview from the release branch.
3. Complete every item in `docs/ACCEPTANCE.md` with member, dispatcher, and manager accounts.
4. Create and download a backup.
5. Merge the reviewed release into `main`.
6. Tag the accepted commit as `v3.2.0`.
7. Verify production assets and `GET /api/health` after deployment.
8. Record the exact commit and deploy ID in `docs/RELEASE_HANDOVER.md`.

## Incident response

For a reported failure, record the time, account role, workflow, booking/site ID, and displayed request ID. Check deploy status, health, and structured function logs. Do not request a user's password or authentication token. Restore data only after verifying the correct backup and documenting the reason.
