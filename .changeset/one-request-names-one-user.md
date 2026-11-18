---
'@saasicat/nest': minor
---

One request names one user, on every route

The second factor, the audit log, the publisher of a version, a promo code's
author, the promotion preview's rate limit and a tenant's own writes read the
user behind a request in one place (`SC-AUD-022`): `userIdResolver`, or without
one `request.user.sub`, then `request.user.id`. The e-mail and the context of
an audit entry are read the same way for every route, and an empty string names
nothing. See "One request names one user, on every route" in
`docs/guides/upgrade-to-1.0.md`.

- **Breaking:** `userIdResolver`, `userEmailResolver` and
  `auditContextResolver` move from `tenantBilling` to the root of the
  `SaaSiCatModule.forRoot` options, where the second factor and every operator
  route read them too. Left under `tenantBilling`, the application does not
  start. `PaymentsTenantRoutesOptions.userEmailResolver` is gone.
- **Breaking:** `MfaGuard` reads `request.user.sub`, then `request.user.id`,
  where it read `id`, then `userId`. An authentication that leaves the user as
  `userId` binds `userIdResolver`; without it, the second factor and a tenant's
  writes refuse the request.
- An operator's audit entry says `unknown` for a missing e-mail, not
  `<userId>@unknown`, and takes its context from the `x-session-id` header or
  `auditContextResolver`, else `admin`; `request.user.sessionId` is not read.
