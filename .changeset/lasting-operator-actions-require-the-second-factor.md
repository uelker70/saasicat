---
'@saasicat/nest': patch
'@saasicat/ui-vue': patch
---

Lasting operator actions on the platform's own routes require the second factor

Publishing a plan or bundle version, ending a plan version, purging a plan,
importing a catalogue, and suspending or reactivating a tenant now require a
one-time code in the `X-Mfa-Code` header. The check sits on those handlers, so
it holds whatever `controller.guards`, `adminResources.guards` or the chain of
a module wired by hand contains.

- The shipped plans and bundles pages ask for the code before each of these
  actions. The tenant pages already asked for it; a tenant-action handler
  registered for `tenants.suspend` or `tenants.reactivate` now has to pass the
  `mfaCode` it receives on to the request. `suspendTenant`, `reactivateTenant`
  and the `tenants` resource take it as their last argument.
- An application that calls `usePlans().hardDelete`,
  `usePlanVersions().publish`, `usePlanVersions().terminateVersion`,
  `useBundleVersions().publish` or the matching resource operations itself
  asks for the code and passes it as the new last argument.
- Every platform administrator who takes these actions needs a second factor
  set up; without one the request is refused with `MFA_NOT_SET_UP`.
- `MfaGuard` reads the caller from `request.user.id` or `request.user.userId`,
  the pair the admin controllers already read the actor from.
- A module carrying one of these routes that is wired without `AdminModule`
  no longer starts, because the check needs `MfaService`.
- `mfaHeader` and `MFA_CODE_HEADER` are exported from `@saasicat/ui-vue`.
- On the pilots, users, platform email and email history pages, a refused code
  now stays visible in the dialog that asks again.
