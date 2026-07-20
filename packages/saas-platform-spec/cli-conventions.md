---
doc_title: SaaS-Plattform CLI-Konventionen
status: spec
date: 2026-05-08
related:
    - admin-api.openapi.yaml
    - schemas/audit-event.schema.json
---

# CLI-Konventionen

Verbindliche Konventionen für jedes konsumenten-spezifische CLI, das die
SaaS-Plattform-Services bedient (jede App wählt ihren eigenen Binary-Namen,
z. B. `myapp`). Eingebettete Plattform-Commands (`@saasicat/cli`) folgen
denselben Regeln; konsumenten-spezifische Plugin-Commands sind verpflichtet,
sie zu erben.

## 1. Identität

Jeder schreibende CLI-Aufruf braucht eine **eindeutige Akteur-Identität**
für den Audit-Log:

- **Env-Var** mit app-eigenem Prefix (z. B. `MYAPP_ADMIN_EMAIL`)
  oder generisch `SAAS_ADMIN_EMAIL` als Plattform-Default.
- **Flag** `--as <email>` überschreibt die Env-Var ad hoc (z. B. wenn
  mehrere SUPER_ADMINs sich denselben Shell teilen).
- Ohne Identität → schreibende Commands lehnen ab mit Exit-Code `2`
  (siehe §6).

Lese-Commands (z. B. `… mandant list`) sind ohne Identität erlaubt, schreiben
aber `actor=anonymous` ins Local-Log.

## 2. MFA-Pflicht für kritische Operationen

Folgende Operationen **MÜSSEN** vor der Ausführung einen TOTP-Code
(Google Authenticator) abfragen:

- `… paket apply` (PlanCatalog-Mutation)
- `… pilot create|grant|revoke` (Pilot-Override)
- `… mandant suspend|impersonate` (Tenant-Sicherheits-Operationen)
- `… plan-version publish` (PlanVersion-Veröffentlichung)
- `… user reassign-admin` (Letzter-Admin-Eskalation)
- `… admin mfa-reset` (MFA-Reset eines anderen SUPER_ADMIN)

Setup via `… admin mfa-setup` (generiert Secret, zeigt QR-Code, persistiert
`MfaPort.setSecret`). Ohne MFA-Setup → der erste kritische Aufruf zwingt
zum Setup. Falscher Code → Exit-Code `3`.

`isMfaSetupRequired` und `verifyMfaCode` werden über die Plattform-`MfaPort`-
Schnittstelle (siehe `@saasicat/types/ports.types.ts`)
durchgereicht — Konsumenten implementieren die Persistenz.

## 3. Production-Confirm

Wenn das CLI gegen eine **Production-Umgebung** läuft (Default: alles, was
nicht `NODE_ENV=development` und nicht localhost-DB ist), muss jeder
schreibende Command interaktiv bestätigt werden:

```text
? Tippe production zur Bestätigung: production
```

- Alternative: `--yes` / `-y` überspringt die Bestätigung (für CI/CD).
- Plus `--dry-run` ist Default für destruktive Commands wie
  `… paket apply` und `… rabatt delete`. Erst `--apply` oder
  `--yes` wendet an.

`production`-Detection sollte über die Konsumenten-Implementation der
`isProductionEnvironment()`-Helper-Funktion laufen (Konsument prüft
`DATABASE_URL`-Host, `process.env.APP_ENV`, etc.).

## 4. Output-Formate

Jeder Command unterstützt drei Output-Formate via `--output / -o`:

- `--output=table` (Default) — menschenlesbare ASCII-Tabelle.
- `--output=json` — strukturiertes JSON (für `jq`-Pipelines, CI-Skripte).
- `--output=plain` — eine Zeile pro Datensatz, tab-separiert (für
  `awk`/`cut`-Pipelines).

Fehler-Output geht auf `stderr`, Daten-Output auf `stdout` — Pipe-stable.

## 5. Audit-Pflicht

Jede schreibende Operation **MUSS** einen `AuditLog`-Eintrag mit folgenden
Pflichtfeldern erzeugen (siehe `schemas/audit-event.schema.json`):

- `action` — SCREAMING_SNAKE_CASE (`PROMO_CODE_CREATED`, `PILOT_GRANTED`,
  `PLAN_CATALOG_UPDATE`, …).
- `entity` + `entityId` — das geänderte Objekt.
- `userId` — auflösbar aus `--as` / Env-Var via `UserPort.findByEmail`.
- `changes` — Vorher-/Nachher-Diff bei Mutations (Ajv-validiert via
  Schema).

Konsumenten dürfen eigene `action`-Werte definieren, müssen aber das
SCREAMING_SNAKE_CASE-Pattern halten und im Audit-Catalog der jeweiligen
ManifestContribution deklarieren.

## 6. Exit-Codes

Verbindliche Exit-Codes — Konsumenten-CLIs dürfen diese **nicht**
umdefinieren, weil Cron-/CI-Skripte sie pattern-matchen:

| Code | Bedeutung                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 0    | Erfolg (auch dry-run ohne Änderungen)                                                                             |
| 1    | User-Fehler (falsches Argument, fehlendes Pflicht-Feld, Validierungs-Fehler)                                      |
| 2    | Identitäts-/Auth-Fehler (keine Email, ungültiger User, kein SUPER_ADMIN)                                          |
| 3    | MFA-Fehler (falscher TOTP-Code, MFA-Setup fehlt)                                                                  |
| 4    | Konnektivitätsfehler (DB nicht erreichbar, Sidecar-Service down)                                                  |
| 5    | Permission-Fehler (User darf diese Operation nicht — z. B. SUPER_ADMIN-Operation, aber User ist nur TENANT_ADMIN) |
| 6    | Konflikt (Optimistic-Lock-Mismatch, Idempotency-Verletzung)                                                       |
| 7    | Drift erkannt (z. B. `paket diff` findet Unterschiede; `manifest check` findet Inkonsistenzen)                    |
| 99   | Interner Fehler (uncaught exception, Bug-Report willkommen)                                                       |

Lese-Commands liefern `0` auch bei leerer Ergebnismenge (kein Drift =
kein Fehler). Drift-Detection-Commands (`paket diff`, `manifest check`)
liefern `7`, wenn Drift gefunden — CI-Gates können darauf reagieren.

## 7. Konsumenten-Plugin-API

Plattform-CLI lädt Konsumenten-Plugins über das `extensions:`-Feld der
ManifestContribution. Jedes Plugin registriert seine eigenen Commands
unter einem eigenen Namespace (`extras:`, `billing:` o. ä.).

Plugin-Commands erben automatisch:

- Identitäts-Auflösung (§1)
- MFA-Enforcement (§2 — Plugin-Author markiert Command als `requireMfa: true`)
- Production-Confirm (§3 — automatisch bei `mutates: true`)
- Output-Format-Flags (§4)
- Audit-Logging (§5 — Plugin liefert `action` + `entity`-Stub, Plattform schreibt den Rest)
- Exit-Codes (§6 — Plugin wirft `CliError`-Subklassen)

## 8. Beispiel-Workflow

```bash
# Lese-Operation, keine Identitäts-Pflicht
$ myapp mandant list --output=json | jq '.[] | select(.status=="ACTIVE")'

# Schreibend mit Identität, dry-run als Default
$ myapp paket apply config/plans.yaml
ℹ Diff: 2 Pläne aktualisiert, 1 Bundle neu.
ℹ Dry-run — nutze --apply zum Schreiben.

# Schreibend mit MFA-Pflicht
$ myapp paket apply config/plans.yaml --apply
ℹ Erfordert MFA-Bestätigung.
? TOTP-Code: 482 159
✓ PlanCatalog aktualisiert. AuditLog: PLAN_CATALOG_UPDATE.

# Production-Confirm
$ NODE_ENV=production myapp pilot grant pilot-schmidt --as=admin@example.com
? Tippe production zur Bestätigung: production
ℹ Erfordert MFA-Bestätigung.
? TOTP-Code: 217 998
✓ Pilot-Grant gespeichert.
```
