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
- The refusal names the contracts still running and what each was concluded
  under, and prints the declaration to paste. It applies whichever way the
  identity moves, so during a rolling deploy an old replica restarting on the
  previous file is refused too: two replicas concluding contracts under two
  different legal entities is what this prevents. Moving a contract to another
  legal entity is a transfer, not an edit of a setting.
- `<app> doctor` gains `platform.issuer-identity`, which asks the same question
  without acting on it, and says what changing the identity would cost while
  nothing has moved.
- **`SubscriptionContractRepository` gains `listRunningIssuers(limit)`**: how many
  contracts are running — `active` or `scheduled`, whatever their window says —
  and the first `limit` of them, oldest first, each with the legal name on its
  issuer copy or `null` where it names none. Both shipped adapters implement it
  and the persistence contract covers it; an implementation of your own adds it.
- **`SUBSCRIBER_IDENTITY_FIELDS` is now `LEGAL_IDENTITY_FIELDS`, and
  `SubscriberIdentityField` is `LegalIdentityField`** — the same three fields,
  named for what they are: both parties to a contract have a legal identity, and
  the issuer is not a subscriber.
- `IssuerIdentityCheck` is exported from `@saasicat/nest` and
  `@saasicat/nest/platform` and registered for every configuration; `inspect()`
  answers the same question without acting on it.

Two limits, stated rather than left to be found. The comparison needs the
`core.appliedSettings` port, which both shipped persistence bundles provide;
without it the boot log says once that the issuer is compared with nothing. And a
contract whose party copy the subscriber migration made names no issuer at all —
those neither block a change nor are blocked by one, and are confirmed against
the contract before they are invoiced.
