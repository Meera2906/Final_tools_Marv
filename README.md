# Marvedge Tool Tales

docs.google.com/document/d/103iUe-8UzZx… i want to build these micro saas tools give me like 18 pages separated in navbar and also add a little bit animaitons for every tool which will represent them make it cool with storytelling on point to capture as much customers along with a login buttons in every pages, then also the color codes are there in the attachments and the typogrpahy will be inter and plus jakarta sans. make the websites standout and also add a button like if you want to enjoy the full potential then add a button which will redirect to my site which is this https://marvedge.com/, the purpose of this project is to attract traffic from these websites and redirect it to the marvedge website then so that we can bosst our site... design the page like wise

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://marvedge-tool-tales.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ebf5fb1c-8ee1-4a19-b97b-fdce0fe3f57a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

---

## Link Shortener Hardening (T-00033)

The Link Shortener tool (`/link-shortener` and `/go/:code`) has been hardened for enterprise reliability, redirect safety, abuse moderation, and creator autonomy.

### Key Architecture & Capabilities

1. **Native HTTP 302 Server Redirects:**
   - Active, unexpired links return immediate server-side HTTP 302 redirects with `Location`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex`.
   - Native form POSTs on `/go/:code` (password unlocks and interstitial continuations) are validated on the server and emit direct HTTP 302 redirects.
   - **Zero client-side JavaScript navigation** (`window.location.replace`) is used.
   - Click counting (`register_click()`) is explicitly awaited in PostgreSQL before redirect emission, guaranteeing durability in serverless runtimes.

2. **Creator Autonomy Without User Accounts:**
   - On link creation, a 32-byte CSPRNG creator token (base64url) is generated and returned to the client once.
   - The database stores only `hex(SHA-256(rawBytes))`.
   - The browser UI stores tokens in `localStorage` under `mrv_creator_links` to populate the "Manage Your Short Links" dashboard.
   - Creators can track real-time click counts, update expiry, edit passwords, or disable/re-enable links without creating an account.

3. **Abuse Prevention & Moderation:**
   - **Destination Safety (`url-policy.ts`):** WHATWG validation rejecting loopback (`127.0.0.1`), RFC 1918 private IP subnets, cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`), octal/hex encoded addresses, and non-HTTP(S) schemes.
   - **Homograph & Punycode Flagging:** Internationalized domain names (`xn--*`) are automatically flagged as `pending_review`.
   - **Global Blocklist:** Suffix-matching domain blocklist managed via admin APIs.
   - **Community Abuse Reports:** Visitors can file abuse reports. Links with $\ge 3$ distinct open, verified reports automatically transition to `pending_review` (displaying an interstitial warning to visitors).
   - **Unverified Reporting Fallback:** Clients lacking trustworthy edge IPs are issued an HMAC-SHA256 signed session cookie (`_mrv_rep_sess`, 2-hour lifetime). Unverified reports are capped at 2/hour and excluded from automated escalation thresholds.

4. **Dedicated Server HTTP Admin API:**
   - Operations live at `/api/admin/links/*` as native server HTTP handlers gated by `x-admin-api-key` verified in constant time (`crypto.timingSafeEqual`).
   - Decoupled from TanStack Start CSRF middleware (`x-tanstack-csrf-token` is not required for curl or external automation).
   - `ADMIN_API_KEY` is strictly server-to-server and never included in browser bundles.

---

### Environment Variables

Configure these variables in your deployment environment (e.g. Netlify / `.env`):

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL (e.g. `https://xyz.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role secret (server-only; bypasses RLS for link resolution, click increments, and rate limits). |
| `ADMIN_API_KEY` | Yes | High-entropy secret (min 32 chars) required in `x-admin-api-key` header for administrative endpoints. |
| `IP_HASH_SALT` | Yes | Cryptographic salt (min 32 chars) used to hash client IP addresses (`SHA-256(salt + ip)`); zero raw IPs are stored. |
| `REPORTING_SESSION_SECRET` | Optional | Dedicated 32-byte secret for signing unverified reporting session cookies. If unset, automatically purpose-derived from `IP_HASH_SALT` via HKDF. |
| `PUBLIC_SITE_URL` | Optional | Canonical site origin (e.g. `https://marvedge.com`). Used for self-referential loop prevention and native POST CSRF validation. |
| `BLOCK_SHORTENER_CHAINS` | Optional | Set to `"true"` to reject target URLs pointing to known third-party shorteners (`bit.ly`, `tinyurl.com`, `t.co`, `ow.ly`). |

---

### Database Migrations

Database migrations are located in `drizzle/migrations/`:

- **Apply Migration:**
  Execute `drizzle/migrations/0001_harden_short_links.sql` in the Supabase SQL editor or via Drizzle CLI:
  ```bash
  # Adds status, creator_token_hash, updated_at to short_links
  # Creates tables: rate_limits, link_reports, blocked_domains
  # Creates functions: register_click, submit_link_report, admin_restore_link, cleanup_rate_limits
  # Hardens RLS and revokes permissions from public, anon, and authenticated
  ```
- **Smoke Test:**
  Verify table structures, constraints, and RLS isolation by executing `drizzle/tests/0001_smoke.sql`.
- **Rollback Migration:**
  If rollback is required, execute `drizzle/migrations/0001_harden_short_links.rollback.sql`.

---

### Running Tests

All link shortener unit tests are isolated from broken baseline files and run in the native Node environment:

```bash
# Run full link shortener test suite (12 test suites, 128 tests)
npm run test:links

# Run type check across link shortener code
npx tsc --noEmit
```

---

### Admin API `curl` Examples

All admin requests require the `x-admin-api-key` header.

#### 1. List Abuse Reports
```bash
curl -i http://localhost:8080/api/admin/links/reports?status=open&limit=20 \
  -H "x-admin-api-key: $ADMIN_API_KEY"
```

#### 2. Update Report Status
```bash
curl -i -X PATCH http://localhost:8080/api/admin/links/reports \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "reportId": 1,
    "status": "actioned"
  }'
```

#### 3. Moderate Link Status (Block Link & Domain)
```bash
curl -i -X POST http://localhost:8080/api/admin/links/status \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "malicious-link",
    "status": "blocked",
    "addDomain": true
  }'
```

#### 4. Restore Flagged Link to Active
Restores link status and marks all open reports for that code as `reviewed` in an atomic transaction:
```bash
curl -i -X POST http://localhost:8080/api/admin/links/status \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "flagged-link",
    "status": "active"
  }'
```

#### 5. Manage Blocked Domains
```bash
# Add domain to blocklist
curl -i -X POST http://localhost:8080/api/admin/links/blocked-domains \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"domain": "phishing-gang.net", "source": "admin_investigation"}'

# List all blocked domains
curl -i http://localhost:8080/api/admin/links/blocked-domains \
  -H "x-admin-api-key: $ADMIN_API_KEY"

# Remove domain from blocklist
curl -i -X DELETE "http://localhost:8080/api/admin/links/blocked-domains?domain=phishing-gang.net" \
  -H "x-admin-api-key: $ADMIN_API_KEY"
```

---

### Known Limitations & Operational Notes

1. **Lost Creator Tokens Cannot Be Recovered:**
   - Because Marvedge Tools operates as an unauthenticated utility suite without user accounts or verified emails, lost creator tokens cannot be reset via email or automated recovery. A creator who loses their key must contact an administrator to modify or disable the link.
2. **Shared-IP Rate Limits:**
   - Fixed-window rate limits are keyed to salted client IP hashes (`creator:ipHash`). Visitors behind shared corporate NAT gateways or VPN egress proxies share rate-limiting buckets.
3. **Rate Limits Pruning (`cleanup_rate_limits`):**
   - Expired rate limit records older than 2 hours are pruned via `SELECT public.cleanup_rate_limits();`. In production, this routine should be scheduled hourly via Supabase `pg_cron` (preferred) or a Netlify Scheduled Function.

