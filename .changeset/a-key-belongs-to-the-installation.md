---
'@saasicat/spec': major
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
'@saasicat/ui-vue': major
'@saasicat/cli': major
'create-saasicat-admin': major
---

**`projectKey` leaves the data model.** One installation serves one application,
so a plan key, a bundle key, a feature key and a quota key are unique for the
whole installation — and nothing carries a project above them any more.

The column never had a second value to hold. `config/saas.yaml` named one
project, the module resolved it once at boot, and there was no per-request
switch; `subscriptions.tenantId` is unique installation-wide, so a customer of
two applications in one database could not exist. What it did do was contradict
the schema beside it: `plan_versions.planId` holds the plan **key** and no
project, so two plans sharing a key shared one version lineage, and
`plan_versions_draft_per_plan` then stopped the second one from opening a draft
at all.

**Ten tables lose the column** — `plans`, `bundles`,
`capability_/feature_/quota_catalog_entries`, `marketing_projections`,
`marketing_settings`, `promotions`, `checkout_offers`,
`subscription_contracts` — and every `(projectKey, <key>)` unique index becomes
`(<key>)`. `marketing_settings` becomes a singleton, capped by a constant
primary key rather than by its project.

**Run one SQL file against an existing database:**

```bash
psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-remove-project-key.postgres.sql
```

It starts with a guard. Where the catalogue holds rows under more than one
project key — in one table or spread across several — it stops and names which
table held which, rather than merging rows that would then collide on the new
unique index. It is a one-way door, and safe to run again: a table whose column
has already gone is skipped.

Each table's changes are made only where that table exists, so an app that
adopted a subset of the Prisma fragments migrates what it has. The file also
adds a `CHECK` keeping `marketing_settings` to one row — that was a convention
resting on a column default, and a default does not apply to a caller that
supplies the value.

If your dev setup uses `prisma db push`, run the file **before** it. `db push`
refuses to drop a column that still holds data, and adding `--accept-data-loss`
would arm every future change to discard data unasked.

The codemod reads your `schema.prisma` as well and reports what it finds there:
a schema you copied the platform's models into still declares the columns, and
a client generated from it would query them.

**For your code**, `saasicat codemod v1` gained a third pass —
`v1-project-key`. It removes the `?projectKey=` query part from a `/catalog/`
URL and the key from `config/saas.yaml`, and it _reports_ every object member
by file and line rather than removing it: in TypeScript an object literal and a
type literal are the same tokens, so a scan that rewrote members would sometimes
delete one of your own declarations. The upgrade guide's table says what each
reported shape becomes.

**What changes at the surface:**

- `app.name` is **required** in `config/saas.yaml`; it is the one place the
  application names itself, and what the manifest and login page display.
  `dbCatalog` takes `{ app, currency, vatRate }`.
- `SuperAdminEndpoints`, every catalogue composable and every admin resource
  drop the field; the catalogue endpoints no longer read `?projectKey=`.
- `PlanRow`, `BundleRow`, `PromotionRow`, the catalog-entry rows,
  `MarketingProjectionRow`, `MarketingSettingsRow`, `CheckoutOfferRow`,
  `SubscriptionContractRecord` and their create/filter DTOs lose it;
  `findByKey`, `retireMissing`, `findFeature`/`findQuota`, the review, i18n and
  base setters, `countActiveByPlanKey` and `loadSnapshot` lose their first
  argument. `PromotionFilter` and `unambiguousPlanKeys` are gone.
- Four error messages drop the phrase — `Plan 'STANDARD' already exists` — and
  the `params` entry with it. Nothing read that parameter.
- `saasicat init --project-key` and `pnpm create saasicat-admin --project-key`
  are `--app-key`: the slug of the application, which is what they always were.

**Three new guards, because a removal leaves no trace.** The persistence
contract now proves a key is taken once for the installation, and that retiring
a plan does not free it — a rule `adapter-drizzle` did not follow, and now does.
`tests/a-key-belongs-to-the-installation.test.js` fails on the identifier coming
back anywhere in the repository. And the migration refuses ambiguous data rather
than merging it.

Migration guide: [`docs/guides/upgrade-to-1.0.md`](https://github.com/uelker70/saasicat/blob/main/docs/guides/upgrade-to-1.0.md).
