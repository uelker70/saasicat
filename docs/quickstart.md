# SaaSiCat — Quickstart

Take one feature through the complete loop in **six actions**:

```text
Capability → Discovery → Packaging → Contract → Enforcement
```

The result is a NestJS application whose code-declared features and quotas are
discovered automatically, packaged for customers and enforced at runtime. About
30 minutes, and fewer than 100 lines of app-owned platform code.

> Assumes a **NestJS app with Prisma + PostgreSQL + JWT auth** that already has
> a `tenantId` concept (a `Tenant` table with RLS, or `tenantId` as a foreign
> key). If you are starting from nothing, build tenant separation first — this
> extends a multi-tenant app, it does not make one.
>
> Its `tsconfig.json` needs `"moduleResolution": "nodenext"` (or `node16` /
> `bundler`), which is what `nest new` writes. The platform is reached through
> subpath exports, and the old `"node"` resolution does not see them.
> `saasicat init` checks and says so.

This page is the fast path. If you want to be walked through it instead, the
[tutorial](tutorial/01-first-plan.md) does the same thing with the reasoning
attached; if you want to know what every option means,
[wire the backend](guides/wire-the-backend.md) is the long form.

**The example throughout** is `notesapp`: a NestJS app with notes per tenant,
users carrying a `tenantId`, and JWT login. It exists —
[`examples/notesapp`](https://github.com/uelker70/saasicat/tree/main/examples/notesapp)
is the finished state of this page.

---

## 1 — Install and generate the wiring

```bash
cd notesapp/backend
pnpm add @saasicat/core @saasicat/spec @saasicat/nest @saasicat/adapter-prisma @saasicat/cli
pnpm exec saasicat init --app-key=notesapp --quota=notes:Note
```

`init` writes six files and edits one: the app identity (`config/saas.yaml`),
the persistence bundle, the feature-UI registry, the manifest contribution, an
admin module and one quota provider per `--quota` — then adds
`SaaSiCatModule.forRoot(...)` to `src/app.module.ts`.

`--dry-run` lists what it would write, `--skip-hasher` leaves password hashing
to code you already have, and it refuses to overwrite an existing file.

All SaaSiCat packages are versioned in lockstep — keep them on one version.

## 2 — Fill in the two things nothing can guess

**What the quota counts.** One query in the generated provider:

```ts
async count(tenantId: string): Promise<number> {
    return this.prisma.note.count({ where: { tenantId } });
}
```

**Your auth guard.** The generated admin module names `YourAuthGuard`, and the
generated `forRoot` block names your Prisma and auth modules in `imports`.
Replace both with the real ones.

**The generated code does not compile until you do**, and that is deliberate. An
empty `guards: []` is how this platform is told an endpoint runs without
authentication — a placeholder would publish `GET /admin/discovery`, your whole
capability inventory, along with the manifest routes.

## 3 — Create the tables

```bash
pnpm exec saasicat schema migrate --all
```

That merges the platform's Prisma fragments into your `schema.prisma`, runs
`prisma migrate dev --create-only`, and appends `constraints.postgres.sql` to
the migration it just wrote — so the invariants Prisma's DSL cannot express
arrive with the tables rather than as a step to remember.

Add `pnpm exec saasicat schema check` to CI. It exits 1 when your schema falls
behind the fragments after a package upgrade, and names what is missing.

## 4 — Declare the capability on an endpoint

Three decorators, no platform code in the handler:

```ts
@Post()
@ImplementsCapability('notes.create', {
    label: 'Create note',
    feature: 'NOTES',
    kind: 'endpoint',
    owner: 'notes',
})
@RequireFeature('NOTES') // 403 when the plan does not include the feature
@EnforceQuota('notesMax') // 402 when count(tenantId) has reached the limit
create(@Req() req: DemoRequest, @Body() dto: CreateNoteDto) {
    return this.notes.create(req.user.tenantId, dto);
}
```

| Decorator               | Where                 | Effect                                                                                 |
| ----------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `@DefinesQuota`         | `QuotaProvider` class | "This quota exists and I can count it" — discovery input and the interceptor's source. |
| `@ImplementsCapability` | Endpoint              | "This endpoint realises the capability" — reviewable, then sellable.                   |
| `@RequireFeature`       | Endpoint              | 403 unless one of the named features is in the active plan.                            |
| `@EnforceQuota`         | Endpoint              | 402 when `count + delta > limit`.                                                      |

The plans themselves are in `config/saas.yaml`, which `init` wrote — `STARTER`
with `notesMax: 25`, `PRO` with more. Applications that manage plans in the
SuperAdmin UI drop that block and pass `dbCatalog` instead.

For a race-critical operation — a large upload against a storage quota — the
transactional path `EntitlementService.enforceLimit({ … })` is the cleaner one;
see [wire the backend](guides/wire-the-backend.md).

## 5 — Start it, and create the first SuperAdmin

```bash
pnpm start:dev
jq '.capabilities[].capabilityKey' var/discovery-snapshot.json   # → "notes.create"
```

Set `SETUP_TOKEN` in the environment and restart. While no SUPER_ADMIN exists,
the login page offers the first-run wizard instead of a password field: token,
email, password, TOTP. It disables itself the moment the account exists.

## 6 — Scaffold the admin, and verify

```bash
cd notesapp
pnpm create saasicat-admin admin --app-key=notesapp --api-base=/api/v1/admin
cd admin && pnpm install && pnpm dev   # http://localhost:9100/admin/login
```

That is a runnable Vue 3 + Quasar + Vite project you own: the bootstrap, an HTTP
client with your token, routes for all thirteen standard pages, branding
variables, and both shipped languages with a switcher in the header. The one
thing left is `src/services/http.ts#adminLogin`, which has to talk to your auth.

Standard pages need no loaders — they read the resource registry that
`createSuperAdminApp({ http })` installs, so every request carries your auth:

```vue
<template>
    <PlatformUsersPage subtitle="All users across tenants." />
</template>
```

Changing one operation without giving up the rest, and gating your own tenant
UI, are in
[build the admin frontend](guides/build-the-admin-frontend.md#overriding-one-operation).

---

## Did it work?

```bash
# 1. Backend serves the admin + tenant manifest
curl -H "Authorization: Bearer <admin-token>" \
     localhost:3000/api/v1/admin/manifest | jq '.navigation.standardPages | keys'

curl -H "Authorization: Bearer <tenant-token>" \
     localhost:3000/api/v1/tenant/manifest | jq '.features, .quotas'

# 2. Quota enforcement (test user on the starter plan, limit = 25)
for i in {1..30}; do
  curl -X POST -H "Authorization: Bearer <tenant-token>" -H "Content-Type: application/json" \
       -d '{"title":"test '$i'"}' localhost:3000/notes
done
#   → 25 ok, from #26 → 402 limit reached for notesMax: 25/25

# 3. Check the feature gate (an endpoint with @RequireFeature for a feature not in the plan)
curl -X POST -H "Authorization: Bearer <tenant-token>" \
     localhost:3000/notes/export
#   → 403 feature EXPORT not included in the current plan
```

Admin UI: `http://localhost:9100/admin/login` → log in → MFA code →
dashboard. The **Discovery page** shows `notes.create` as "discovered", the
**Plans page** lists `starter` and `pro`.

**You are SaaS-ready.**

---

---

## What next?

Add these in this order:

1. **Switch the runtime catalog to the database:** replace `planCatalog` with
   `dbCatalog: { app, currency, vatRate, marketing }`. The
   persistence bundle already supplies the read sink and catalog repositories.

2. **Manifest contributions** for your own SuperAdmin KPI cards, tenant
   actions and project pages. **Tenant navigation** contributions via
   `TenantManifestService.registerNavItem(...)` in `OnModuleInit`.
   → [manifest contributions](guides/wire-the-backend.md#manifest-contributions)

3. **Extend the CLI**: `notesapp manifest hash` (CI pinning),
   `notesapp audit tail`. Plus `defaultDoctorChecks: true` for the 4
   platform health checks.
   → [extend your CLI](guides/extend-your-cli.md)

4. **Tests:** `createSaaSiCatTestModule({ planCatalog, defaultPlanId, quotaProviders })`
   from `@saasicat/nest/testing` for integration tests without your own
   adapter setup.

5. **Payments:** add a payment-provider adapter when the integration is
   available. Keep capability packaging, contracts and enforcement independent
   of provider-specific payment state.

---

---

## Common quickstart failures

| Symptom                                                 | Cause                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `saasicat: command not found`                           | Use `pnpm exec saasicat ...` or install globally: `pnpm i -g @saasicat/cli`.                        |
| `prisma-fragments/` directory not found                 | `@saasicat/spec` is missing from the backend deps. Repeat action 1.                                 |
| `Nest can't resolve dependencies of X (?, ...)`         | Put the module exporting the injected adapter/client in the top-level `imports` option.             |
| Boot hangs with `P2028 "Unable to start a transaction"` | The RLS bypass did not take effect — `PrismaService` does not check `isBypassActive()`.             |
| `discovery-snapshot.json` is empty                      | The module holding the decorators (e.g. `NotesModule`) is missing from `AppModule.imports[]`.       |
| `@RequireFeature` lets everything through               | Enable `tenantBilling`, or provide `defaultPlanId`/`adapters.planResolver` for a lightweight setup. |
| `@EnforceQuota` never blocks                            | The `QuotaProvider` class is not listed in `quotaProviders: [...]`.                                 |
| `@RequireFeature('NOTES')` throws 403                   | The tenant has no active/trial subscription, or its plan does not include `NOTES`.                  |
| Discovery tabs stay empty                               | Vite cache holding a stale build. `rm -rf node_modules/.vite && pnpm dev`.                          |
| Setup wizard does not appear / `403 SETUP_DISABLED`     | The `SETUP_TOKEN` env variable is not set, or a SUPER_ADMIN already exists (self-disable).          |
| `tenantManifest` throws at boot                         | Enable `tenantBilling`, or provide `defaultPlanId`/`adapters.planResolver`.                         |

For deeper troubleshooting, see [troubleshooting](guides/troubleshooting.md).
