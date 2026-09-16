---
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/spec': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
'@saasicat/cli': major
---

An operator corrects its own details, and the running contracts follow

`config/saas.yaml#issuer` names the legal entity on the operator's side of every
contract, and a contract copies it the day it is concluded. Its address and
contact details move freely and take effect at the next start, for contracts
already running too. Its `legalName`, `vatId` and `taxNumber` are the party a
contract names, so a start that finds one of them different from the one the
installation recorded refuses — unless the file declares the change a correction
of that same legal entity.

- `issuer.correctionOf` is new: it names, for each identity field that moves, the
  value the installation recorded before it — `null` where it recorded none,
  which is how a tax number assigned later is declared — plus a `reason`. It
  carries no date of its own: the settings record dates the start that applied
  it. It is needed only for the start that carries the change, and a later deploy
  may drop it; left in, it changes nothing and does not cover the next change.
- Taking the `issuer` block away once an identity is recorded is refused the same
  way, and it is the one shape a declaration cannot rescue: `correctionOf` lives
  inside the block. That refusal prints the issuer as the installation recorded
  it, address included, to write back.
- The refusal names the contracts still running and what each was concluded
  under, and prints the declaration to paste. It applies whichever way the
  identity moves, so during a rolling deploy an old replica restarting on the
  previous file is refused too: two replicas concluding contracts under two
  different legal entities is what this prevents. Moving a contract to another
  legal entity is a transfer, not an edit of a setting.
- `<app> doctor` gains `platform.issuer-identity`, which asks the same question
  without acting on it, and says what changing the identity would cost while
  nothing has moved.
- **`SubscriptionContractRepository` gains `listRunningIssuers(limit, asOf?)`**:
  how many contracts are concluded and not yet over, and the first `limit` of
  them, oldest first, each with the legal name on its issuer copy or `null` where
  it names none. Running means `active` or `scheduled` and not ended at `asOf`;
  status alone would not do, because an ordinary cancellation writes only
  `effectiveUntil`. Both shipped adapters implement it and the persistence
  contract covers it; an implementation of your own adds it.
- `issuer.legalName`, `issuer.vatId` and `issuer.taxNumber` are compared with the
  surrounding whitespace taken off, and the schema now refuses a value that is
  only whitespace. Both sides are settled the same way, so a stray space cannot
  make a value differ from itself.
- **`SUBSCRIBER_IDENTITY_FIELDS` is now `LEGAL_IDENTITY_FIELDS`, and
  `SubscriberIdentityField` is `LegalIdentityField`** — the same three fields,
  named for what they are: both parties to a contract have a legal identity, and
  the issuer is not a subscriber.
- `IssuerIdentityInspector` and `IssuerIdentityCheck` are exported from
  `@saasicat/nest` and `@saasicat/nest/platform` and registered for every
  configuration. The inspector answers the question and acts on nothing —
  `inspect()` is what `<app> doctor` and a health endpoint of your own call; the
  check is the module hook that turns a refusing answer into a boot that does not
  happen. A CLI that mounts the platform is refused by that hook like any other
  start, so `doctor` reports the state a start would accept rather than printing
  a refusal.

One consequence to know before it bites: every start records what it applied, and
a CLI process is a start. Booting your application against the production
database with a _newer_ `config/saas.yaml` applies that file to the record, a
declared correction included — and the replicas still on the previous file are
then the undeclared change, refused at the next restart. Run one-off commands
with the file the installation is running.

Three limits, stated rather than left to be found. The comparison needs the
`core.appliedSettings` port, which both shipped persistence bundles provide;
without it the boot log says once that the issuer is compared with nothing. A
contract whose party copy the subscriber migration made names no issuer at all —
those neither block a change nor are blocked by one, and are confirmed against
the contract before they are invoiced. And "a later deploy may drop the
declaration" holds once the start that carried it has recorded it: that write is
best-effort, so check `GET /admin/settings` before dropping the block.
