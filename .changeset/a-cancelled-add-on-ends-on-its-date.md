---
'@saasicat/nest': minor
---

A cancelled add-on's features and quotas end on its effective date

A contract written while an add-on's cancellation was declared recorded the
add-on in its entitlements, and nothing wrote the contract again when the date
arrived. Now the contract keeps the add-on's line, since it is billed until
then, leaves it out of the entitlements it records and names it there
(`leftOutBundleVersionIds`); the booking grants its features and quotas until
its effective date, counted once, and from that date nothing of it is granted
(`SC-BUN-034`). A cached answer is not served past that date either.

- `EntitlementService.computeContractLimits` answers what a contract frozen at
  a moment records, and which add-ons it left out. The freeze calls it instead
  of `computeLimits`; a stand-in for `EntitlementService` of your own provides
  it.
- A snapshot that names nothing as left out — written before this release, or
  by an application — covers every add-on its contract lists, as before, so a
  cancelled add-on is counted once there and kept until the contract is written
  again. The upgrade guide says how to write each one once.
