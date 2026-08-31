---
doc_title: SaaS Platform CLI Conventions
status: spec
date: 2026-05-08
related:
    - admin-api.openapi.yaml
    - schemas/audit-event.schema.json
---

# CLI Conventions

Binding conventions for every consumer-specific CLI that serves the
SaaS platform services (each app picks its own binary name,
e.g. `myapp`). Embedded platform commands (`@saasicat/cli`) follow
the same rules; consumer-specific plugin commands are required to inherit
them.

## 1. Identity

Every writing CLI invocation needs a **unique actor identity**
for the audit log:

- **Env var** with an app-specific prefix (e.g. `MYAPP_ADMIN_EMAIL`)
  or the generic `SAAS_ADMIN_EMAIL` as the platform default.
- **Flag** `--as <email>` overrides the env var ad hoc (e.g. when
  several SUPER_ADMINs share the same shell).
- Without an identity → writing commands are rejected with exit code `2`
  (see §6).

Read commands (e.g. `… tenant list`) are allowed without an identity, but
write `actor=anonymous` to the local log.

## 2. Mandatory MFA for Critical Operations

The following operations **MUST** prompt for a TOTP code
(Google Authenticator) before execution:

- `… plans apply` (PlanCatalog mutation)
- `… pilot create|grant|revoke` (pilot override)
- `… tenant suspend|impersonate` (tenant security operations)
- `… plan-version publish` (PlanVersion publication)
- `… user reassign-admin` (last-admin escalation)
- `… admin mfa-reset` (MFA reset of another SUPER_ADMIN)

Setup via `… admin mfa-setup` (generates a secret, shows a QR code, persists
`MfaPort.setSecret`). Without MFA setup → the first critical invocation forces
setup. Wrong code → exit code `3`.

`isMfaSetupRequired` and `verifyMfaCode` are passed through via the platform
`MfaPort` interface (see `@saasicat/core`, `src/ports/core-ports.types.ts`)
— consumers implement the persistence.

## 3. Production Confirm

When the CLI runs against a **production environment** (default: anything that
is not `NODE_ENV=development` and not a localhost DB), every
writing command must be confirmed interactively:

```text
? Type production to confirm: production
```

- Alternative: `--yes` / `-y` skips the confirmation (for CI/CD).
- Plus `--dry-run` is the default for destructive commands like
  `… plans apply` and `… discounts delete`. Only `--apply` or
  `--yes` applies.

`production` detection should run through the consumer's implementation of the
`isProductionEnvironment()` helper function (the consumer checks the
`DATABASE_URL` host, `process.env.APP_ENV`, etc.).

## 4. Output Formats

Every command supports three output formats via `--output / -o`:

- `--output=table` (default) — human-readable ASCII table.
- `--output=json` — structured JSON (for `jq` pipelines, CI scripts).
- `--output=plain` — one line per record, tab-separated (for
  `awk`/`cut` pipelines).

Error output goes to `stderr`, data output to `stdout` — pipe-stable.

## 5. Mandatory Audit

Every writing operation **MUST** create an `AuditLog` entry with the following
required fields (see `schemas/audit-event.schema.json`):

- `action` — SCREAMING_SNAKE_CASE (`PROMO_CODE_CREATED`, `PILOT_GRANTED`,
  `PLAN_CATALOG_UPDATE`, …).
- `entity` + `entityId` — the changed object.
- `userId` — resolvable from `--as` / env var via `UserPort.findByEmail`.
- `changes` — before/after diff for mutations (Ajv-validated via the
  schema).

Consumers may define their own `action` values, but must keep the
SCREAMING_SNAKE_CASE pattern and declare them in the audit catalog of the
respective ManifestContribution.

## 6. Exit Codes

Binding exit codes — consumer CLIs **must not**
redefine them, because cron/CI scripts pattern-match on them:

| Code | Meaning                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Success (including dry-run with no changes)                                                                                          |
| 1    | User error (wrong argument, missing required field, validation error)                                                                |
| 2    | Identity/auth error (no email, invalid user, not a SUPER_ADMIN)                                                                      |
| 3    | MFA error (wrong TOTP code, MFA setup missing)                                                                                       |
| 4    | Connectivity error (DB unreachable, sidecar service down)                                                                            |
| 5    | Permission error (user is not allowed to perform this operation — e.g. a SUPER_ADMIN operation, but the user is only a TENANT_ADMIN) |
| 6    | Conflict (optimistic-lock mismatch, idempotency violation)                                                                           |
| 7    | Drift detected (e.g. `plans diff` finds differences; `manifest check` finds inconsistencies)                                         |
| 99   | Internal error (uncaught exception, bug reports welcome)                                                                             |

Read commands return `0` even for an empty result set (no drift =
no error). Drift-detection commands (`plans diff`, `manifest check`)
return `7` when drift is found — CI gates can react to that.

## 7. Consumer Plugin API

The platform CLI loads consumer plugins via the `extensions:` field of the
ManifestContribution. Each plugin registers its own commands
under its own namespace (`extras:`, `billing:`, or similar).

Plugin commands automatically inherit:

- identity resolution (§1)
- MFA enforcement (§2 — the plugin author marks a command as `requireMfa: true`)
- production confirm (§3 — automatic when `mutates: true`)
- output format flags (§4)
- audit logging (§5 — the plugin supplies `action` + `entity` stub, the platform writes the rest)
- exit codes (§6 — the plugin throws `CliError` subclasses)

## 8. Example Workflow

```bash
# Read operation, no identity required
$ myapp tenant list --output=json | jq '.[] | select(.status=="ACTIVE")'

# Writing with identity, dry-run as default
$ myapp plans apply config/plans.yaml
ℹ Diff: 2 plans updated, 1 bundle added.
ℹ Dry run — pass --apply to write.

# Writing with mandatory MFA
$ myapp plans apply config/plans.yaml --apply
ℹ MFA confirmation required.
? TOTP code: 482 159
✓ PlanCatalog updated. AuditLog: PLAN_CATALOG_UPDATE.

# Production confirm
$ NODE_ENV=production myapp pilot grant pilot-schmidt --as=admin@example.com
? Type production to confirm: production
ℹ MFA confirmation required.
? TOTP code: 217 998
✓ Pilot grant stored.
```
