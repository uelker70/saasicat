---
'@saasicat/nest': minor
---

A cancelled add-on's features and quotas end on its effective date

A contract written while an add-on's cancellation was declared recorded the
add-on in its entitlements, and nothing wrote the contract again when the date
arrived. Now the contract keeps the add-on's line, since it is billed until
then, and leaves it out of the entitlements it records; the booking grants its
features and quotas until its effective date, counted once, and from that date
nothing of it is granted (`SC-BUN-034`). A cached answer is not served past
that date either.

- `EntitlementService.computeContractLimits` answers what a contract frozen at
  a moment records. The freeze calls it instead of `computeLimits`; a stand-in
  for `EntitlementService` of your own provides it.
- A contract written before this release keeps the add-on in its entitlements
  until it is written again. The upgrade guide says how to write each one once.
