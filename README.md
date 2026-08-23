# GT Mann Dispatch

Authenticated internal dispatch scheduling for material deliveries, tool pickups, tool deliveries, and miscellaneous field tasks.

## v3.2 workflow controls

- New self-service accounts remain `pending` and cannot see company data until a manager approves them.
- Booking search and filters cover requester, site, status, type, supplier, PO/cost code, and date.
- Dispatchers assign a person, vehicle, and scheduled duration while approving a request.
- Overlapping approved jobs for the same dispatcher are visibly flagged.
- Completed jobs capture actual minutes, kilometres, receiving contact, completion notes, photo proof, and actual cost.
- Approved work can be added to Outlook Calendar; ad-hoc B.C. job-site addresses autocomplete while typing.
- The installable PWA shell can reopen in weak-service conditions while the existing IndexedDB outbox safely queues writes.

## Address and route estimates

Job-site addresses autocomplete from OpenStreetMap data and save the selected canonical address and coordinates. All site distance and drive-time calculations start at Faithwood Farms, 4368 Lochside Drive, Saanich (`48.4952, -123.3698`) and are stored as round trips.

Set `MAPBOX_ACCESS_TOKEN` in Netlify to use live road routes. Without it, the app uses a clearly labelled coordinate-based approximation so it never represents a straight-line estimate as live routing.

## Production architecture

- **Frontend:** Vite on Netlify
- **Authentication:** `@netlify/identity` with email-confirmed self-service signup
- **Authorization:** `member`, `dispatcher`, and `manager` roles enforced in every server function
- **Data:** strongly consistent Netlify Blobs stores for bookings, sites, photos, audit events, backups, idempotency records, and rate limits
- **API:** same-origin Netlify Functions under `/api/*`
- **Offline support:** IndexedDB outbox with idempotency keys, conflict detection, retry isolation, and visible blocked-item handling

The old browser PINs and the unauthenticated Railway dispatch API are not used by this version.

## Roles

| Role | Access |
|---|---|
| `pending` | Account exists but no company schedules or dispatch details are accessible |
| `member` | Create bookings; edit their own pending bookings; see team schedule |
| `dispatcher` | Approve, decline, start, complete, edit, and delete bookings; manage job sites |
| `manager` | All dispatcher permissions plus cost summaries and user-role administration |

New signups always start as `member`. Only an existing manager can grant dispatcher or manager access.

## Local verification

Requires Node.js 22.12 or newer.

```bash
npm install
npm test
npm run build
```

Use `npm run dev` for browser-only development and `npx netlify dev` for local Functions and Blobs. Netlify Identity does **not** run locally; authentication acceptance tests must use a Netlify deploy preview.

## First production deployment

1. Push this repository to GitHub and connect it to the existing Netlify site.
2. In Netlify, enable Identity, set registration to **Open**, and leave email confirmation enabled.
3. Before inviting the first user, set `BOOTSTRAP_MANAGER_EMAIL` to that person's exact email address.
4. Deploy the site, then invite that email as the first user. The signup event assigns the `manager` role.
5. Sign in. The Manager tab can assign future users as Member, Dispatcher, or Manager.
6. After confirming the first manager works, the bootstrap email may remain set or be removed. It affects only a matching new-user signup event.

If users already existed before this release, assign the first manager role in Netlify's Identity user administration, then use the app's Manager tab thereafter.

## Environment variables

Copy `.env.example` for the complete list. Configure secrets in Netlify—not in Git.

Optional Slack notifications use:

- `DISPATCH_SLACK_BOT_TOKEN`
- `BRENT_SLACK_ID`
- `SLACK_MANAGER_CHANNEL_ID`
- `DISPATCH_APP_URL`

Slack messages deliberately contain only an **Open Dispatch** link. Approval and status changes happen inside the authenticated app.

The Slack app needs `chat:write`, `im:write`, `users:read`, and `users:read.email` bot-token scopes. While a material or tool delivery is in progress, a dispatcher can send the requester a direct **10 minutes away** message. The requester is resolved by the email on their booking, so their GT Mann Dispatch and Slack email addresses must match.

## Operational safeguards

- IDs, requester identity, status defaults, timestamps, and cost estimates are owned by the server.
- Mutations require same-origin requests, an authenticated user, the correct role, and an idempotency key.
- Booking writes use optimistic version checks and conditional Blob writes to prevent lost updates.
- Photos accept JPEG, PNG, or WebP only and are limited to 5 MB after client compression.
- API JSON bodies are limited and strictly validated.
- The Content Security Policy blocks inline JavaScript, framing, plugins, and cross-origin form submissions.
- User-generated text is escaped in both the web UI and Slack messages.
- Site renames use conditional writes and create-before-delete ordering, preventing a failed rename from destroying the original record.
- Photo authorization uses a direct booking link rather than scanning every booking; legacy links repair themselves on first access.
- Managers have a downloadable backup inventory and audit activity view.
- A complete booking, site, audit, and photo backup runs daily.
- Unexpected server failures emit structured logs and return a support-safe request ID.

## Operations

- Health check: `GET /api/health`
- Manager audit trail: `GET /api/admin/audit`
- Backup inventory: `GET /api/admin/backups`
- Create a backup: `POST /api/admin/backups`
- Download a backup: `GET /api/admin/backups/:id`
- Restore a backup: `PUT /api/admin/backups/:id` with `{ "confirmation": "RESTORE" }`

See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for recovery, monitoring, access, and release procedures.

## Release checklist

```bash
npm test
npm run build
```

Then verify on a Netlify deploy preview with one account of each role:

- Signup and email confirmation, invite acceptance, sign-in, sign-out, and password recovery
- Create/edit a booking, including conditional pickup/site validation
- Dispatcher status transitions and conflict refresh
- Photo upload/view/delete
- Offline create followed by reconnect
- Site create/rename/delete
- Manager summary and role changes
- Mobile layout and keyboard-only navigation
