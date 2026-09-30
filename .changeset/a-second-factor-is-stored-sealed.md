---
'@saasicat/core': minor
'@saasicat/nest': major
'@saasicat/cli': minor
'@saasicat/adapter-prisma': patch
'@saasicat/spec': patch
---

Seal a SuperAdmin's second factor before it is stored

The TOTP secret behind a SuperAdmin's second factor was stored as it is, so
whoever held a dump, a backup or a replica of the database held the second
factor of the accounts that can change every tenant's plan, codes and
contracts (`SC-SEC-016`).

- `MfaService` seals the secret before `MfaPort.setSecret` sees it and opens it
  after `getSecret`, through a `SecretSealer` — a new interface in
  `@saasicat/core`, bound as `adapters.secretSealer`.
- `@saasicat/nest` ships two: `aesGcmSecretSealer(key)`, AES-256-GCM under a
  key of 32 bytes given as base64, and `storeSecretsInPlainText()` for an
  installation that means it. A key that is unset or of another length stops
  the boot with a message saying which; pass `process.env.…` as it is.
- `SaaSiCatModule.forRoot` refuses to start without a sealer
  (`core.secret-sealer-bound`). The persistence bundle does not supply one: the
  key belongs to the installation, not to the database.
- A stored secret the sealer cannot open — sealed under another key, or stored
  before this release — turns the code away rather than accepting it, and the
  log names the user, who enrols again with `<app> admin mfa-setup --force`.
- `createSaaSiCatTestModule` binds `storeSecretsInPlainText()` unless
  `overrides.secretSealer` names another.
- `saasicat init` wires `aesGcmSecretSealer(process.env.SECRET_SEALER_KEY)` and
  says how to generate the key.

**After upgrading, each SuperAdmin enrols once more** with
`<app> admin mfa-setup --force`, since secrets stored before are plain text. An
`MfaPort` of your own that already encrypts the secret moves that encryption
into a `SecretSealer` instead: what it wrote stays readable and nobody enrols
again. `MfaService` takes the sealer as its second constructor argument.
