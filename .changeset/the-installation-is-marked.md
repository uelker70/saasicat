---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/cli': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/spec': minor
'@saasicat/persistence-testing': minor
---

A tenant is deleted only from a database marked as its installation's

A tenant's deletion erases what nobody can bring back, and the process that
runs it finds its database through a connection string. So the database now
carries the identifier of its installation, every process names the identifier
of the environment it runs in, and a deletion runs only where both are the same
(`SC-PRIV-021`). This release deletes nothing yet; the brake is in place before
the release that does.

**Breaking:** `tenantBilling.subscriptionEnds.deletion` is required. Pass the
identifier from the environment, with no fallback:

```ts
subscriptionEnds: {
    export: myTenantDataExport,
    deletion: { installation: process.env.SAASICAT_INSTALLATION },
},
```

A start without an identifier, or with a value that is none — a blank, a space
around it, a character outside letters, digits, `.`, `_` and `-` — is refused
(`subscription-ends.requires-installation`), and so is a start with nowhere to
read the mark from (`subscription-ends.requires-installation-marks`).
`TenantBillingModule` wired by hand takes `deletion: { installation, marks }`.

- `@saasicat/spec` ships the `InstallationMark` model
  (`32-installation-mark.prisma`, table `installation_marks`, one row) and
  `1.0-the-installation-is-marked.postgres.sql`, safe to apply twice.
- `@saasicat/core` adds `InstallationMarkPort`,
  `installationIdentifierProblem`, `installationMarkVerdict` and the codes
  `INSTALLATION_IDENTIFIER_NOT_THIS_ENVIRONMENTS`,
  `INSTALLATION_MARKED_OTHERWISE` and `INSTALLATION_MARK_MOVED`.
- Both adapters provide `persistence.core.installationMark`, held to the
  persistence contract; a harness of your own wires it or names it among its
  `gaps`.
- `@saasicat/nest` adds `InstallationMarkService`; `@saasicat/nest/testing`
  adds `FakeInstallationMarkRepository`.
- `@saasicat/cli` adds `<app> installation status` and
  `<app> installation mark <identifier>`, with `--replace` after restoring a
  backup into another environment. Marking takes the second factor and, against
  production, the confirmation, and is audited as `INSTALLATION_MARKED` or
  `INSTALLATION_MARK_REPLACED`. No start writes the mark. `<app> doctor` reports
  it as `platform.installation-mark`.

The brake stops a process meant for another environment. An environment copied
from production with its identifier included passes it: give each environment
its own. See `docs/guides/upgrade-to-1.0.md`.
