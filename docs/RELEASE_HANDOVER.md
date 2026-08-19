# GT Mann Dispatch Release Handover

## Product

- Product: GT Mann Dispatch
- Release: `v3.1.0`
- Production URL: `https://gtmann-dispatch.netlify.app/`
- Source repository: `https://github.com/goodtimes668/gtmann-dispatch`
- Accepted production branch: `main`
- Release commit: _complete after merge_
- Netlify deploy ID: _complete after production deploy_
- Deployment date: _complete after production deploy_

## Buyer-controlled services

- Netlify hosting, Identity, Functions, and Blobs
- Mapbox access token for live routes
- Optional Slack bot and destination IDs
- Buyer-controlled storage for downloaded handover backups

## Required environment variables

- `MAPBOX_ACCESS_TOKEN`
- `BOOTSTRAP_MANAGER_EMAIL` during first-manager setup only
- `DISPATCH_APP_URL`
- Optional `DISPATCH_SLACK_BOT_TOKEN`
- Optional `BRENT_SLACK_ID`
- Optional `SLACK_MANAGER_CHANNEL_ID`

## Acceptance evidence

- Automated tests: _record count and date_
- Production build: _record date_
- Role-based acceptance: _record tester/date_
- Mapbox/Faithwood route: _record tested site/date_
- Backup ID downloaded at handover: _record ID_
- Known unresolved defects: _must be empty or expressly accepted in writing_

The sale package should not be signed as accepted until all blank release fields and the production acceptance checklist are complete.
