# @saasicat/ui-vue

## 0.2.0

### Minor Changes

- c94b1fe: Remove `quotaKeys` from `saas.yaml` — quota keys now have a single source of truth: the `@DefinesQuota` decorator in code, validated against the discovery snapshot.

    **Breaking:** `saas.yaml` files containing a `quotaKeys:` block fail schema validation (`additionalProperties: false`). Delete the block — the platform derives all quota dimensions from the registered `QuotaProvider` classes.

    - `plan-catalog.schema.json` / `admin-manifest.schema.json` / OpenAPI: `quotaKeys` removed from schema and `planCatalogSnapshot`.
    - `PlanCatalog.quotaKeys`, `PlanCatalogModule.forRoot({ quotaKeys })` and `buildPlanCatalogFromSnapshot` settings field removed.
    - `PlanChangePreviewService.limitsCheck` and `GET /billing/usage` iterate the union of quota keys from entitlement, target plan and usage snapshot instead of the catalog list.
    - `TenantBillingController` no longer injects the plan catalog.
    - `TenantPlanSection` derives the displayed quota keys as an ordered union across all plans and the tenant's effective limits (previously only the first plan's keys), so higher-tier-only quotas stay visible.

### Patch Changes

- 32cca3b: Replace two backtracking-prone regexes with linear string scans (CodeQL `js/polynomial-redos`): the Prisma `//`-comment strip in `schema apply` and the trailing-slash trim of the billing `apiPrefix`. `@saasicat/ui-vue` now exports `trimTrailingSlashes`.
- Updated dependencies [c94b1fe]
    - @saasicat/types@0.2.0
