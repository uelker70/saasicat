# The vocabulary

Six words carry most of SaaSiCat, and three of them are used loosely elsewhere
in the industry. This page fixes what each one means here, because every
document, table name and API path below uses them in exactly this sense.

The walkthrough that puts them in motion is
[From capability to contract](capability-to-contract.md); the shape of the code
around them is in [Architecture](architecture.md).

The platform cleanly separates **code reality**, **product definition** and **sold contract**:

| Concept                        | Meaning                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capability**                 | A concrete capability in code, declared with `@ImplementsCapability('dms.upload', {...})`. Atomic technical unit, e.g. an endpoint.                                                                                                   |
| **Feature**                    | Marketable bundle of several capabilities (e.g. `DMS` = upload + download + preview). Translated in the marketing catalog, mapped to prices, referenced in plans.                                                                     |
| **Quota**                      | Numeric limit (e.g. `users=10`, `storageGb=5`). Declared with `@DefinesQuota(...)` on a `QuotaProvider` that provides `count(tenantId)`. Enforced at endpoints via `@EnforceQuota('users')`.                                          |
| **Discovery snapshot**         | Static snapshot of all decorator calls (capabilities, features, quotas) that the platform writes to `var/discovery-snapshot.json` at boot. Feeds the SuperAdmin discovery page.                                                       |
| **Catalog-Entry**              | DB-projected view of a capability/feature/quota with lifecycle status (`discovered → accepted → active → deprecated → retired` / `ignored`).                                                                                          |
| **Bundle**                     | Versioned grouping of features + quota effects — bookable on its own or included in plan versions (addon sales removed, #49).                                                                                                         |
| **Plan / Plan version**        | Sales offer with price, included features, quota limits. Plan = immutable identifier, plan version = published snapshot.                                                                                                              |
| **Checkout-Offer**             | Frozen offer (plan + bundles + cycle + price + validity date) before a contract is created.                                                                                                                                           |
| **Subscription-Contract** (V3) | Immutable contract created at purchase time from the checkout offer. **Single source** for billing and entitlement at runtime. On plan change: new contract, old contract becomes `superseded`.                                       |
| **Entitlement-Snapshot**       | Aggregated view of all features and quota limits from a tenant's active contract line items. Computed at runtime by `EntitlementService`.                                                                                             |
| **Manifest**                   | UI discovery projection of your app (`/api/v1/admin/manifest`): which standard pages are active, which project pages your app adds, which KPI cards, which tenant actions. Spec: `@saasicat/spec/schemas/admin-manifest.schema.json`. |

**Rule of thumb:** Capability is _implemented_, Feature is _marketable_,
Quota is _countable_, Plan or Bundle is _sellable_, and Contract is _sold_.

**Sales model (since v1.5.0, #49):** Only **plan versions** and
**bundles** are sold; a tenant's effective features/quotas are
the union of plan ∪ booked bundles. The SSOT for plans, bundles and prices
is the AdminUI — seeds may only create drafts (`publishedAt = null`);
publishing happens exclusively in the AdminUI (bundle publish requires
`validFrom`).

## What your application still owns

Everything the platform cannot know:

- persistence — adapters from your database to the platform ports
  ([wiring the backend](../guides/wire-the-backend.md)),
- your own capabilities, declared with `@ImplementsCapability(...)` on your
  controllers,
- manifest contributions: the KPI cards, tenant actions and project pages your
  application adds,
- a `count(tenantId)` provider for each quota you define.

The rest arrives with the packages: tenant administration and the SuperAdmin
pages, plan and bundle editors with draft and publish workflows, the public
catalog endpoint a pricing page reads, promo codes and billing lifecycle, TOTP
MFA, audit logging, RLS-bypass integration, first-run setup, CLI checks, and
manifest-driven Vue pages.
