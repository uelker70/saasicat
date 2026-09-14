---
'@saasicat/spec': patch
---

The line-item money migration reads a rate of 1 or more as per cent

`1.0-line-items-record-their-money.postgres.sql` decided the unit of a
contract's VAT rate by its provenance wherever the snapshot's totals did not
settle it, and read every contract concluded from a checkout offer as a
fraction. An installation that wrote per cent into its offers got 1900 for a
free plan's 19, or for a total a cent beside both readings, and the migration
stopped over a snapshot that was in order.

- Where the totals explain both readings or neither, a rate of 1 or more is
  per cent: as a fraction it would be a tax of 100 per cent or more.
- Below 1, provenance decides only where both readings explain the totals.
  Where neither does, the migration stops and names the contract.
- The pre-flight query in the upgrade guide reports the same contracts.
