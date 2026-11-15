---
'@saasicat/cli': minor
---

The schema check names a model of your own under a platform model's name

A model of the application's own that carries a platform model's name — its
own `SubscriptionInvoice`, mapped to `invoices` — was reported as a diverging
`@@map` and with every platform column missing. `saasicat schema check` now
names it once, under "Your own model under a platform model's name", with both
tables, and compares nothing else of it (`SC-SCOPE-013`). The table decides: a
model with another `@@map`, or none, is the application's. The check still
fails on it; rename the model, or map it to the platform's table where it was
meant to be the platform's. The closing advice names only what was found.

**Breaking** for code that reads the report of `checkSchema`: a diverging table
is an entry in the new `nameClashes` (`model`, `platformTable`,
`applicationTable`) rather than a `missingBlockAttributes` entry of kind `map`.
`BlockAttributeKind` is `'index' | 'unique'`, and `MissingBlockAttribute.actual`
is gone. Running the command needs no change.
