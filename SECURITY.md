# Security Policy

SaaSiCat ships authentication, MFA, registration, and billing primitives. Some of its
security properties depend on how **you** deploy it. This document is the operating
contract: what we guarantee, what we require from operators, and what we know is
missing.

## Supported versions

SaaSiCat is pre-1.0. During the 0.x series, only the **latest minor release** receives
security fixes.

| Version          | Supported          |
| ---------------- | ------------------ |
| latest 0.x minor | :white_check_mark: |
| older releases   | :x:                |

All packages (`@saasicat/*`, `create-saasicat-admin`) are versioned in lockstep, so a
security release always bumps the whole set. Upgrade all SaaSiCat packages together.

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub Security Advisories:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** (private vulnerability reporting).

Do **not** open a public issue for security reports. You will get an initial response
within a few days; this is a maintainer-run project, so please allow reasonable time
for a fix before public disclosure.

## Operating requirements

The platform is only as secure as the deployment around it. The following are
**mandatory** for production deployments.

### 1. A trusted reverse proxy in front of the app (`trustProxy`)

The built-in rate-limit guards derive the client identity from the
`X-Forwarded-For` header (first address), falling back to `req.ip`. This header is
client-controlled unless a trusted proxy in front of the application **overwrites**
it.

- **Required:** terminate all traffic at a reverse proxy / load balancer you control,
  which sets `X-Forwarded-For` to the real client IP, and enable `trustProxy` in your
  HTTP adapter (e.g. Fastify's `trustProxy: true`).
- **Never** expose the application directly to the internet. Without a trusted proxy,
  an attacker can spoof `X-Forwarded-For` and rotate identities to defeat every
  IP-based rate limit (login, registration, OTP resend, promo-code validation).

### 2. Rate limiters are in-memory and per-instance

All shipped rate-limit guards (registration/auth guards based on
`BaseIpRateLimitGuard`, `PromoCodeRateLimitGuard`) use an **in-process sliding-window
map**. There is no shared store.

- Running **N instances** behind a load balancer multiplies every limit by N and lets
  attackers spread attempts across instances.
- **Required for multi-instance deployments:** replace the guards with a Redis-backed
  (or otherwise shared) implementation — they follow the standard `CanActivate`
  contract, so swapping is a drop-in provider change — or enforce equivalent limits at
  the load balancer / edge.
- Limits also reset on process restart. Do not treat them as an audit or lockout
  mechanism across restarts.

### 3. `SETUP_TOKEN` — first-run setup semantics

The first-run setup flow (creates the initial super admin) is protected by a shared
token from the environment (default env var: `SETUP_TOKEN`, configurable via
`setupTokenEnvVar`):

- **Env var not set** → setup endpoints are disabled (`SETUP_DISABLED`). This is the
  correct steady state for a bootstrapped system.
- **Self-disable:** once a super admin exists, setup refuses to run
  (`SETUP_ALREADY_DONE`), regardless of the token.
- Token comparison is timing-safe.

**Required:** use a long random token, set it only for the bootstrap window, and
**remove it from the environment after bootstrap**. If it must remain set (e.g. baked
into a deployment template), rotate it and treat it as a secret — anyone holding it
before the first super admin exists can take over the instance.

### 4. `SAAS_PLATFORM_SKIP_MFA` / `SAAS_PLATFORM_SKIP_RATE_LIMITS` are CI-only

Both flags exist solely for CI smoke tests. They are honored **only when
`NODE_ENV !== 'production'`**; with `NODE_ENV=production` they are ignored by design,
and consumers cannot add their own bypass switches.

**Required:** always run production with `NODE_ENV=production`. Never set these flags
in any internet-facing environment, staging included.

### 5. Payment webhook: signature verification is the integrator's job

The registration/checkout flow ships the webhook DTOs and processing logic, but it
does **not** verify payment-provider signatures — it cannot know your provider or
secret.

**Required:** put a signature-verification guard (e.g. validating Stripe's
`Stripe-Signature` header against the raw request body) in front of the webhook
route, **before** body parsing and DTO validation. An unauthenticated webhook
endpoint lets anyone forge payment confirmations.

### 6. Guard order on super-admin routes

The intended chain is:

```
JwtAuthGuard  →  SuperAdminGuard  →  MfaGuard
```

`MfaGuard` (reading the `X-Mfa-Code` header) expects an authenticated user on the
request; it fails closed (`NOT_AUTHENTICATED`) when the auth pipeline did not run
first. **Required:** keep this order when wiring guards (e.g. in
`AdminManifestModule` guard configuration) and never register `MfaGuard` without the
two guards in front of it.

### 7. OTP brute-force lockout (registration)

Email-OTP verification during registration is protected by a persistent
claim-then-check counter:

- After **5 failed attempts** (default; override via
  `SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS`), verification returns `OTP_LOCKED` — even
  for a subsequently correct code.
- The attempt slot is claimed **atomically before** the code comparison, so parallel
  requests cannot race past the limit.
- The only reset is requesting a **new OTP via resend**, which is itself
  rate-limited.

**Required:** keep the limit low (the default of 5 is deliberate) and surface
`OTP_LOCKED` in your frontend as "request a new code", not as "try again".

## TOTP implementation notes and known limitations

- TOTP (super-admin MFA) is implemented with **`otplib`**. Verification tolerates
  clock drift of **±1 time step (30 seconds)**.
- **Known limitation — no replay protection:** a TOTP code that was just accepted can
  be accepted again within its validity window. The platform does not yet remember
  consumed time steps. Until this lands, be aware that intercepting a valid code
  (e.g. via a compromised client) allows immediate reuse; TLS everywhere and the
  guard chain above are the current mitigations. Tracked as a planned hardening item.

## Scope

In scope: everything published under the `@saasicat/*` scope and
`create-saasicat-admin`. Out of scope: vulnerabilities in your consuming application,
your payment provider integration, or your deployment infrastructure — though we are
happy to clarify the platform's assumptions if you are unsure where an issue lives.
