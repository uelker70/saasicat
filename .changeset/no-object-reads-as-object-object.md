---
'@saasicat/core': patch
'@saasicat/persistence-testing': patch
'@saasicat/cli': patch
'@saasicat/ui-vue': patch
'@saasicat/nest': patch
---

No value without a text of its own reads "[object Object]" any more

`formatErrorMessage` turned an object passed as a parameter into
"[object Object]" in the message the user reads. It now leaves the placeholder
visible, as it already did for a missing value; text, numbers, booleans,
dates and lists of them read as before. A header the HTTP client reads that is neither text, a
number, a boolean nor a list now reads as absent, and a tax reason that is not
text reads as empty.

The persistence contract suite took seed functions out of `harness.seed` and
called them without their object. A harness whose seed is a class instance
using `this` failed there; the suite now keeps the receiver.

`saasicat manifest check` names an unexpected `schemaVersion` as JSON, so a
version sent as text shows its quotes.
