# HanzCamm — Cloudflare Workers website + private portal

This is a working first release for the personal HanzCamm brand. Cinemora UK appears only as a collaboration section. The project includes a responsive portfolio, two fixed-price service listings, an enquiry API, D1-backed bookings, admin and client accounts, collaborator assignment, task tracking, project stages, approval records and authenticated R2 file downloads.

## Important before launch

- **Replace the portfolio placeholder artwork** with HanzCamm-owned photos and video embeds. Images/video are NOT bundled.
- **Current public pricing**: £300 event photography coverage; £400 videography (an event recap plus three colour-graded clips, or a promotional video). Travel inclusion depends on location and availability. Confirm the duration, revisions and any travel charges with each client before booking.
- Replace the example email address in `public/index.html` with your real monitored email.
- The enquiry form **stores** messages in D1; it does not send an email notification yet. View enquiries from the admin dashboard.
- Only administrators should create users. Distribute passwords via a secure channel. A production invitation/password-reset flow is recommended before allowing many clients to onboard.
- Add Turnstile verification and rate limiting to the public enquiry/login endpoints before promoting this site widely.
- R2 direct uploads are limited to **75MB** by this starter. For large video deliveries, implement a multipart upload flow or an external professional delivery workflow.
- Prices do not yet include payment processing, deposits, contracts or invoicing.
- Do not place real client information on the site until you've verified permissions, privacy notices and retention policies.

## Cloudflare setup

1. Upload these project files into your GitHub repository ROOT (not inside a nested folder).
2. Cloudflare dashboard > Workers & Pages > D1 > Create database named `hanzcamm-db`.
3. Copy its database ID and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.jsonc`.
4. Cloudflare dashboard > R2 > Create a bucket named `hanzcamm-deliverables`. R2 may require enabling billing.
5. Install Node.js (18+) and run `npm install` locally.
6. Create tables locally: `npx wrangler d1 execute hanzcamm-db --local --file=./schema.sql`.
7. Create tables remotely: `npx wrangler d1 execute hanzcamm-db --remote --file=./schema.sql`.
8. Generate a random 32-byte secret, then configure `ADMIN_SETUP_TOKEN` under Cloudflare Worker Settings > Variables and Secrets as a SECRET. Do not put it in GitHub.
9. Deploy from the Cloudflare GitHub integration with **Build command:** `npm run build`, **Deploy command:** `npx wrangler deploy`. Keep the repo linked for updates.
10. Create the first admin account once via the API, using the secret created in step 8. Example (replace host/email/password/secret, and never share your password or token in chat):

```bash
curl -X POST 'https://YOUR-WORKER.workers.dev/api/setup' \
  -H 'Content-Type: application/json' \
  --data '{"token":"YOUR_SECRET","name":"HanzCamm","email":"YOUR_EMAIL","password":"LONG_UNIQUE_PASSWORD"}'
```

11. **Remove `ADMIN_SETUP_TOKEN` from Cloudflare after the admin account is created**. Subsequent setup calls are refused anyway.
12. Visit `/#portal` and sign in. Create clients, bookings, assign Cinemora collaborators, manage stages and deliverables.
13. Connect your owned domain through Cloudflare Worker > Settings > Domains & Routes.

## Local development

Copy `.dev.vars.example` to `.dev.vars` and set a strong local secret. Run:

```bash
npm install
npx wrangler d1 execute hanzcamm-db --local --file=./schema.sql
npm run build
npm run dev
```

The Worker will serve the static files and API together.

## Architecture

- `public/index.html` — portfolio, Cinemora section, services, contact and portal
- `public/style.css` — responsive design
- `public/app.js` — frontend and portal interface
- `src/worker.js` — Cloudflare Worker API + authenticated R2 access
- `schema.sql` — D1 database schema
- `wrangler.jsonc` — Worker, D1 and R2 bindings

## Security and operational notes

Authentication uses PBKDF2 password hashes and random SHA-256-hashed session tokens in D1. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Portal data and R2 downloads are checked against authenticated roles and per-project authorisation. Admin bootstrap is a one-time secret-protected endpoint. This is a starter implementation, **not an independently audited production security system**. Before storing sensitive client information, commission a security review, add login rate limiting, password resets, user-managed credentials, a privacy notice and database/backups monitoring. No public R2 bucket access is necessary.

## GitHub deployment

Once the files are pushed to `hanzfabila4-ux/hanzcamm-website`, Cloudflare can build automatically on each GitHub push. The project relies on the correct database ID, existing R2 bucket and remote schema migration, so the first deploy may fail before these are configured.
