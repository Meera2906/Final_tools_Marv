# Link Shortener Verification Guide (Stage 4)

This guide documents manual verification procedures and concrete `curl -i` commands to validate the HTTP 302 redirect route, status codes, response headers, and security controls implemented in Stage 4 (`/go/:code`).

---

## 1. Environment & Setup

Run the local development server:

```bash
npm run dev
```

By default, the server starts at `http://localhost:3000` (or `http://localhost:5173`).

---

## 2. Test Scenarios & `curl` Commands

### Scenario 1: Clean Active Link (HTTP 302 Found)

Verify that visiting an active, unexpired, unprotected short link returns an immediate server-side HTTP 302 redirect with no client-side navigation.

```bash
curl -i http://localhost:3000/go/<ACTIVE_CODE>
```

**Expected Response:**

```http
HTTP/1.1 302 Found
Location: https://example.com/target-destination
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Robots-Tag: noindex
```

_Note: The response body is empty or minimal redirect payload; no JavaScript or HTML page is rendered._

---

### Scenario 2: Click Count Increment (Atomic `register_click`)

Verify that every 302 redirect durably increments the click counter by exactly 1.

```bash
# Before request: check click count via creator info API or Supabase SQL
# SELECT code, clicks FROM short_links WHERE code = '<ACTIVE_CODE>';

curl -i http://localhost:3000/go/<ACTIVE_CODE>

# After request:
# SELECT code, clicks FROM short_links WHERE code = '<ACTIVE_CODE>';
# Result: clicks count increased by exactly 1.
```

---

### Scenario 3: Non-Existent Link (HTTP 404 Not Found)

Verify that querying an unknown slug returns HTTP 404 with noindex header.

```bash
curl -i http://localhost:3000/go/non-existent-code
```

**Expected Response:**

```http
HTTP/1.1 404 Not Found
X-Robots-Tag: noindex
Content-Type: text/html; charset=utf-8
```

_Renders the "Link not found" shell with a link back to the shortener tool._

---

### Scenario 4: Expired, Disabled, or Blocked Links (HTTP 410 Gone)

Verify that inactive or policy-violating links return HTTP 410 Gone with noindex header.

```bash
# Expired link
curl -i http://localhost:3000/go/<EXPIRED_CODE>

# Disabled link
curl -i http://localhost:3000/go/<DISABLED_CODE>

# Blocked link / blocked domain
curl -i http://localhost:3000/go/<BLOCKED_CODE>
```

**Expected Response:**

```http
HTTP/1.1 410 Gone
X-Robots-Tag: noindex
Content-Type: text/html; charset=utf-8
```

_Renders the corresponding 410 shell ("This short link has expired" / "This link has been disabled" / "This link has been removed")._

---

### Scenario 5: Password-Protected Link (HTTP 200 Form -> Native POST 302)

Verify that password-protected links do not disclose the destination URL until unlocked.

```bash
# Step 1: Initial GET renders password prompt (200 OK)
curl -i http://localhost:3000/go/<PASSWORD_CODE>
```

**Expected Initial Response:**

- Status: `200 OK`
- Header: `X-Robots-Tag: noindex`
- Body: Form containing `<input type="hidden" name="action" value="unlock" />` and password input. Target URL is completely absent from HTML and JSON script tags.

```bash
# Step 2: Native form POST with incorrect password
curl -i -X POST http://localhost:3000/go/<PASSWORD_CODE> \
  -H "Host: localhost:3000" \
  -H "Origin: http://localhost:3000" \
  -F "action=unlock" \
  -F "password=wrong-password"
```

**Expected Response:** `401 Unauthorized` with `X-Robots-Tag: noindex`.

```bash
# Step 3: Native form POST with correct password
curl -i -X POST http://localhost:3000/go/<PASSWORD_CODE> \
  -H "Host: localhost:3000" \
  -H "Origin: http://localhost:3000" \
  -F "action=unlock" \
  -F "password=<CORRECT_PASSWORD>"
```

**Expected Response:**

```http
HTTP/1.1 302 Found
Location: https://example.com/secret-target
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Robots-Tag: noindex
```

---

### Scenario 6: Flagged Link Interstitial (`pending_review`)

Verify that a link flagged for community review renders the interstitial warning with destination preview and requires explicit continuation.

```bash
# Step 1: Initial GET renders interstitial notice
curl -i http://localhost:3000/go/<FLAGGED_CODE>
```

**Expected Initial Response:**

- Status: `200 OK`
- Warning notice: "Community Review Warning"
- Shows destination URL preview.
- Includes `<form method="post"><input type="hidden" name="action" value="continue" /></form>`.

```bash
# Step 2: Native form POST to continue to destination
curl -i -X POST http://localhost:3000/go/<FLAGGED_CODE> \
  -H "Host: localhost:3000" \
  -H "Origin: http://localhost:3000" \
  -F "action=continue"
```

**Expected Response:**

```http
HTTP/1.1 302 Found
Location: https://example.com/target-destination
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Robots-Tag: noindex
```

---

### Scenario 7: Cross-Origin POST CSRF Protection (HTTP 403 Forbidden)

Verify that cross-site POST submissions are blocked by origin validation.

```bash
curl -i -X POST http://localhost:3000/go/<ANY_CODE> \
  -H "Host: localhost:3000" \
  -H "Origin: https://malicious-attacker.com" \
  -F "action=continue"
```

**Expected Response:**

```http
HTTP/1.1 403 Forbidden
X-Robots-Tag: noindex

Forbidden: Cross-site request rejected
```

---

### Scenario 8: Resolution Rate Limiting (HTTP 429 Too Many Requests)

Verify that exceeding rate limits returns HTTP 429 with `Retry-After`.

```bash
# Execute rapid resolution loop
for i in {1..130}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/go/<ACTIVE_CODE>; done
```

**Expected Response on Limit Exceeded:**

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-Robots-Tag: noindex
```

---

### Scenario 9: Anonymous Reporting Session Cookie

Verify that requests from unverified / untrusted IPs receive a signed reporting cookie with `HttpOnly; Secure; SameSite=Lax`.

```bash
curl -i http://localhost:3000/go/<ANY_CODE>
```

**Expected Header:**

```http
Set-Cookie: __Host-mrv_rep=...; Path=/; Max-Age=7200; HttpOnly; Secure; SameSite=Lax
```
