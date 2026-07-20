# Acceptance Test Scenarios

HTTP-based black-box tests that run against **every** implementation of the
SaaS platform (reference implementation: `@saasicat/nest`).
This makes the OpenAPI contract from `admin-api.openapi.yaml` not just a
document, but an executable set of guarantees.

## Format

Each scenario is a YAML file with the structure:

```yaml
scenario: 'Kurzbeschreibung des Verhaltens (1 Satz)'
description: |
    Längere Beschreibung — was wird hier abgesichert, warum ist es wichtig.
    Verweise auf SPEC-Sektion oder offene Frage.

setup: # state setup via Admin API calls
    - createTenant: { slug: '...', email: '...' }
    - createPromoCode: { code: '...', ... }

when: # the action under test
    - redeemPromoCode: { code: '...', tenantSlug: '...' }

then: # expected HTTP response
    status: 200
    body:
        # JSON pattern; AnyOf, contains, etc. allowed
```

## Test Runner

An acceptance test runner (planned) reads each scenario, boots a test
server, and verifies `setup` → `when` → `then` sequentially.

## Scenario Backlog

| Area            | Scenario                                                                                            | Status  |
| --------------- | --------------------------------------------------------------------------------------------------- | ------- |
| `manifest/`     | Public boot is retrievable without auth and contains **only** branding                              | 🟡 stub |
| `manifest/`     | Full manifest requires SUPER_ADMIN, otherwise 403                                                   | 🟡 stub |
| `manifest/`     | manifestHash stable across two boots                                                                | 🔴      |
| `manifest/`     | ETag match returns 304                                                                              | 🔴      |
| `promo/`        | First-time-customers-only rejects a second redemption                                               | 🟡 stub |
| `promo/`        | Allow-zero-invoice false blocks a 100% discount                                                     | 🔴      |
| `promo/`        | Code with `valueType=PERCENT, value>100` is rejected                                                | 🔴      |
| `plan-version/` | Publish does not touch `Subscription.planVersionId` of existing tenants (P1 guarantee from SPEC §6) | 🟡 stub |
| `plan-version/` | Regressive version requires tenant opt-in                                                           | 🔴      |
| `plan-version/` | 6-week notification cron sends mail to affected subscriptions                                       | 🔴      |
| `tenant/`       | Suspend → 403 for tenant login + audit entry with reason                                            | 🟡 stub |
| `tenant/`       | Suspend without MFA header → 401 MFA_REQUIRED                                                       | 🔴      |
| `mfa/`          | TOTP verify with a good code → 200, with a bad one → 401                                            | 🟡 stub |
| `mfa/`          | System rejects MFA skip via env flag in production                                                  | 🔴      |

🟡 = Stub file present, but the test runner does not process it yet
🔴 = Yet to be written

## Convention

- **Scenario language:** English (wire format, language-neutral).
- **Comments:** German is allowed, as they serve a documentation purpose.
- **Data:** do not use real emails / slugs — `test-*` prefixes.
