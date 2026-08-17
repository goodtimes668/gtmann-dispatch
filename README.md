# GT Mann Dispatch

Authenticated internal dispatch scheduling for material deliveries, tool pickups, tool deliveries, and miscellaneous field tasks.

## Production architecture

- **Frontend:** Vite on Netlify
- **Authentication:** `@netlify/identity` with invite-only users
- **Authorization:** `member`, `dispatcher`, and `manager` roles enforced in every server function
- **Data:** strongly consistent Netlify Blobs stores for bookings, sites, photos, idempotency records, and rate limits
- **API:** same-origin Netlify Functions under `/api/*`
- **Offline support:** IndexedDB outbox with idempotency keys, conflict detection, retry isolation, and visible blocked-item handling

The old browser PINs and the unauthenticated Railway dispatch API are not used by this version.

## Roles

| Role | Access |
|---|---|
| `member` | Create bookings; edit their own pending bookings; see team schedule |
| `dispatcher` | Approve, decline, start, complete, edit, and delete bookings; manage job sites |
| `manager` | All dispatcher permissions plus cost summaries and user-role administration |

## Local verification

Requires Node.js 22.12 or newer.

```bash
npm install
npm test
npm run build
```

Use `npx netlify dev` when testing Identity, Functions, and Blobs locally. Plain `npm run dev` starts only the browser frontend.

## First production deployment

1. Push this repository to GitHub and connect it to the existing Netlify site.
2. In Netlify, enable Identity and set registration to **Invite only**.
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

## Operational safeguards

- IDs, requester identity, status defaults, timestamps, and cost estimates are owned by the server.
- Mutations require same-origin requests, an authenticated user, the correct role, and an idempotency key.
- Booking writes use optimistic version checks and conditional Blob writes to prevent lost updates.
- Photos accept JPEG, PNG, or WebP only and are limited to 5 MB after client compression.
- API JSON bodies are limited and strictly validated.
- The Content Security Policy blocks inline JavaScript, framing, plugins, and cross-origin form submissions.
- User-generated text is escaped in both the web UI and Slack messages.

## Release checklist

```bash
npm test
npm run build
```

Then verify on a Netlify deploy preview with one account of each role:

- Invite acceptance, sign-in, sign-out, and password recovery
- Create/edit a booking, including conditional pickup/site validation
- Dispatcher status transitions and conflict refresh
- Photo upload/view/delete
- Offline create followed by reconnect
- Site create/rename/delete
- Manager summary and role changes
- Mobile layout and keyboard-only navigation
