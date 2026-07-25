---
'@saasicat/types': minor
'@saasicat/adapter-prisma': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

Add a high-level SaaSiCat standard stack that wires catalog, entitlements,
tenant billing and subscription bundles from one persistence bundle. The
Prisma bundle now includes the canonical catalog and tenant-billing adapters,
including a reusable subscription usage mapper and standard Admin resource
adapter. Tenant, user, audit and subscription controllers plus promo-code CRUD
can now be enabled with two flags. The Vue client supplies the matching
resource loaders and actions. Existing fine-grained modules and adapter
overrides remain available.
