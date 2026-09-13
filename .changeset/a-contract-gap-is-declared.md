---
'@saasicat/persistence-testing': major
---

A port the harness leaves out fails the persistence contract unless it is
declared

A scenario group whose port or seed writer the harness does not provide used to
report as skipped, and a suite could pass with a whole group unchecked. It now
fails, naming the part. An adapter that deliberately does not provide a part
lists it in the new `gaps` option of `persistenceAdapterContract`, and its
scenarios report as skipped as before; a gap listed there that the harness does
provide fails the suite. Groups ruled out by the adapter's `capabilities`, such
as the lock scenarios, still skip.

- A harness that wires every port its adapter ships changes nothing.
- A harness that relied on skips either wires the missing ports or declares
  them: `gaps: ['appliedSettings']`. `ContractGap` lists the names.
