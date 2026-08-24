# Verify your integration

After integration:

- [ ] Backend starts without `P2028 "Unable to start a transaction"` — if it does:
      `PrismaPlanCatalogReadSink` doesn't bypass RLS correctly.
- [ ] `var/discovery-snapshot.json` is written at boot and contains your
      `@ImplementsCapability` entries.
- [ ] `GET /api/v1/admin/manifest` responds with status 200 + `ETag` and contains
      all standard pages, your manifest contribution + KPI cards.
- [ ] `GET /public/catalog` returns the plans declared in the plan catalog.
- [ ] SuperAdmin login works, `MfaGuard` blocks without MFA.
- [ ] The SuperAdmin UI loads:
    - [ ] `/admin/dashboard` shows your KPI cards.
    - [ ] `/admin/tenants` lists tenants.
    - [ ] `/admin/discovery` shows capabilities/features/quotas (are the tabs empty? — see
          [troubleshooting](troubleshooting.md)).
    - [ ] `/admin/plans` shows your YAML plans.
    - [ ] `/admin/marketing-catalog` shows features for locale translation.
- [ ] An endpoint with `@EnforceQuota('xxx')` throws `LimitExceededError` when exceeded.
- [ ] An endpoint with `@RequireFeature('XXX')` responds 403 with
      `code: FEATURE_NOT_LICENSED` when the plan doesn't include the feature.
- [ ] `myapp manifest hash` is deterministic (same code → same hash).
- [ ] `myapp doctor` runs through without errors.

When one of these fails, [troubleshooting](troubleshooting.md) has the causes
that produce it most often.
