# Acceptance-Test-Szenarien

HTTP-basierte Black-Box-Tests, die gegen **jede** Implementierung der
SaaS-Plattform laufen (Referenz-Implementierung: `@saasicat/nest`).
Damit ist der OpenAPI-Vertrag aus `admin-api.openapi.yaml` nicht nur
ein Dokument, sondern ein ausführbares Set von Garantien.

## Format

Jedes Szenario ist eine YAML-Datei mit der Struktur:

```yaml
scenario: 'Kurzbeschreibung des Verhaltens (1 Satz)'
description: |
    Längere Beschreibung — was wird hier abgesichert, warum ist es wichtig.
    Verweise auf SPEC-Sektion oder offene Frage.

setup: # State-Setup über Admin-API-Aufrufe
    - createTenant: { slug: '...', email: '...' }
    - createPromoCode: { code: '...', ... }

when: # Die zu testende Aktion
    - redeemPromoCode: { code: '...', tenantSlug: '...' }

then: # Erwartete HTTP-Response
    status: 200
    body:
        # JSON-Pattern; AnyOf, contains, etc. erlaubt
```

## Test-Runner

Ein Acceptance-Test-Runner (geplant) liest jedes Szenario, fährt einen
Test-Server hoch und verifiziert sequentiell `setup` → `when` → `then`.

## Szenarien-Backlog

| Bereich         | Szenario                                                                                          | Status  |
| --------------- | ------------------------------------------------------------------------------------------------- | ------- |
| `manifest/`     | Public-Boot ist ohne Auth abrufbar und enthält **nur** Branding                                   | 🟡 stub |
| `manifest/`     | Voll-Manifest verlangt SUPER_ADMIN, sonst 403                                                     | 🟡 stub |
| `manifest/`     | manifestHash über zwei Boots stabil                                                               | 🔴      |
| `manifest/`     | ETag-Match liefert 304                                                                            | 🔴      |
| `promo/`        | First-time-customers-only lehnt zweite Redemption ab                                              | 🟡 stub |
| `promo/`        | Allow-zero-invoice false blockt 100%-Rabatt                                                       | 🔴      |
| `promo/`        | Code mit `valueType=PERCENT, value>100` wird abgelehnt                                            | 🔴      |
| `plan-version/` | Publish berührt `Subscription.planVersionId` der Bestands-Tenants nicht (P1-Garantie aus SPEC §6) | 🟡 stub |
| `plan-version/` | Regressive Version verlangt Tenant-Opt-in                                                         | 🔴      |
| `plan-version/` | 6-Wochen-Notification-Cron schickt Mail an betroffene Subscriptions                               | 🔴      |
| `tenant/`       | Suspend → 403 für Tenant-Login + Audit-Eintrag mit reason                                         | 🟡 stub |
| `tenant/`       | Suspend ohne MFA-Header → 401 MFA_REQUIRED                                                        | 🔴      |
| `mfa/`          | TOTP-Verify mit gutem Code → 200, mit schlechtem → 401                                            | 🟡 stub |
| `mfa/`          | MFA-Skip via Env-Flag in production lehnt System ab                                               | 🔴      |

🟡 = Stub-Datei vorhanden, aber Test-Runner verarbeitet sie noch nicht
🔴 = Noch zu schreiben

## Konvention

- **Sprache der Szenarien:** Englisch (Wire-Format, sprach-neutral).
- **Kommentare:** Deutsch erlaubt, weil Doku-Charakter.
- **Daten:** keine echten E-Mails / Slugs verwenden — `test-*`-Prefixes.
