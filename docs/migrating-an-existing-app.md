# Migrating an existing app to the standard stack

This is the recipe distilled from migrating **vereinsfux** — a production-shaped
NestJS app with 13 hand-wired platform modules, ~40 adapter files and its own
SuperAdmin controllers — onto `SaaSiCatModule`. It records what actually went
wrong, in the order it went wrong, so the next app does not rediscover it.

Result there: `app.module.ts` 531 → 344 lines, **−357 lines net** across 66
files, zero migrations, zero endpoints lost.

> The quickstart (`docs/quickstart.md`) covers a **new** app. This document is
> for an app that already wired the fine-grained modules by hand.

---

## What the standard stack does and does not cover

`SaaSiCatModule.forRoot(defineSaaSiCat({...}))` composes plan catalog,
entitlements, discovery, admin manifest, catalog, tenant billing, subscription
bundles, promo codes and the standard admin resources.

It does **not** compose `SetupModule`, `AdminStatsModule`, `CheckoutOfferModule`
or `SubscriptionContractModule`. Those stay explicit imports — import them from
`@saasicat/nest/platform` so they land in the same bundle (see step 2).

Expect the savings to come from **wiring**, not from your domain code. In
vereinsfux, ~1400 lines of admin controllers and ~700 lines of adapters stayed,
because the platform has no implementation for them: DSGVO export across 31
tables, pilot management, platform e-mail, a `UserManagementPort` against a
schema with no `super_admin_users` table.

---

## Step 0 — upgrade first, simplify second

Bump `@saasicat/*` to the target version and get green **before** touching any
wiring. Mixing an upgrade with a refactor makes every failure ambiguous.

Verify: `pnpm -r typecheck && pnpm -r build && <your unit tests>`.

---

## Step 1 — build the persistence bundle

One file, one responsibility. `prismaPersistence()` covers the canonical ports;
everything below it is a deliberate deviation that must carry its reason.

```ts
const base = prismaPersistence({
    client: PrismaService,
    schema: YOUR_PRISMA_SCHEMA_OPTIONS,      // plan binding, validity windows, delegates
    bundle: { validityWindows: true },        // reaches BOTH bundle repositories
    adminResources: false,                    // see step 5
});

export const PERSISTENCE: SaasicatPersistenceAdapter = {
    ...base,
    promo: {
        ...base.promo!,
        // The default expiry sweep has no `deletedAt: null` filter and would
        // stamp EXPIRED on soft-deleted codes.
        promoCodeRepository: fromPrisma((p) => new AppPromoCodeRepository(p)),
    },
};
```

**Watch for:** if your app currently registers the platform adapters as Nest
class providers with `@Inject(PRISMA_*_OPTIONS)` tokens, those options no longer
apply — the bundle constructs the repositories directly. Pass them through
`prismaPersistence()` options instead. Anything you cannot reach that way needs
the spread-override shown above.

---

## Step 2 — the import rule (and why it is now only a convention)

Nest matches modules and providers **by class reference**. Historically the CJS
build copied shared modules into every entry, so `MfaService` from
`@saasicat/nest` and from `@saasicat/nest/platform` were different classes, and
composing `SetupModule` with `SaaSiCatModule` failed at boot with
*"MfaService is not available in the SetupModule module"*.

Since the shared-bundle build (`CONTRIBUTING.md` → *One bundle, many entries*)
every entry hands out the same objects, so this no longer bites. **Still import
platform things from `@saasicat/nest/platform`** when you use `SaaSiCatModule` —
it keeps the composition readable and is guaranteed correct.

If you ever see `UnknownDependenciesException` naming a platform class, this is
the first thing to check.

---

## Step 3 — map every option before deleting anything

Go through your `app.module.ts` option by option. Most map directly. The ones
that surprised us:

| Your wiring | Standard stack | Note |
|---|---|---|
| `PlanCatalogModule.forRoot({projectKey, app, currency, vatRate, marketing})` | `dbCatalog: {...}` | identity only; plans come from the read sink |
| `EntitlementModule.forRoot({...repos, resolutionConfig})` | `entitlement: { resolutionConfig }` | repos come from the bundle |
| `PublicCatalogModule.forRoot(...)` | `catalog: { publicCatalog: true }` | on by default |
| `PromoCodesModule.forRoot({includePublicController: true})` | `promoCodes: { includePublicController: true }` | **default flips to `false`** — set it explicitly or you silently lose `POST /billing/promo/preview` |
| `CatalogModule.forRoot({strictModeCheckMode})` | `catalog: { strictModeCheckMode }` | **platform default is `blocking`** — pass yours verbatim |

Two defaults are inverted relative to the fine-grained modules. Both fail
quietly. Diff your route list before and after.

---

## Step 4 — route collisions abort the boot

Fastify raises `FST_ERR_DUPLICATED_ROUTE` — there is no "first one wins". If you
keep an app-owned controller on a path the platform also mounts, turn the
platform one off:

- `includeManifestController: false` — you serve `/admin/manifest` yourself
- `promoCodes: { adminController: false }` — you serve `/admin/promo-codes` yourself
- `adminResources: false` — you serve tenants/users/audit yourself

Delete the app controller **and** flip the flag in the same commit, never in two.

---

## Step 5 — think twice about `adminResources: true`

`PrismaAdminResourcesAdapter` reads `tenant.isActive`, `tenant.deletedAt`,
`user.firstName/lastName`, `user.isActive` and a direct `tenant.users` relation,
and it resolves the `tenant`/`user`/`subscription` delegates by **hardcoded
name**. vereinsfux has `status` enums, `tenantUsers` as m:n and no names on
`User` — so it stays `false` and keeps its own controllers.

Turning it on also costs pagination (`AdminTenantListFilter` has no page size,
hard cap 200), MFA on the write routes, and `setTenantActive` will additionally
write `subscription.status`.

---

## Step 6 — global guards run before controller-local ones

If your app authenticates in a **controller-local** guard (`@UseGuards(JwtAuthGuard, …)`),
set `globalFeatureGuard: false`. Otherwise the platform binds `StaticFeatureGuard`
as a global `APP_GUARD`, it runs before your auth guard, sees no `request.user`
and 403s every `@RequireFeature` route.

> **Then bind a feature guard yourself — this step is not optional.**
> `globalFeatureGuard: false` removes the only feature-enforcing `APP_GUARD`.
> Without a replacement, `@RequireFeature` degrades to inert markup and every
> annotated route serves unlicensed traffic, silently and with no failing test.
>
> ```ts
> // the guard the option unbinds — from @saasicat/nest/platform
> @UseGuards(JwtAuthGuard, StaticFeatureGuard)
> ```
>
> Apps on the V3 entitlement stack bind `FeatureGuard` from
> `@saasicat/nest/billing` instead — a *different* class, backed by
> `ENTITLEMENT_SERVICE_TOKEN` rather than the static plan catalog. Pick the one
> matching your entitlement path; binding neither is the failure mode above.
>
> Verify it: call one `@RequireFeature` route with a tenant whose plan lacks
> that feature and confirm you get a 403.

The quota interceptor stays global either way — interceptors run *after* all
guards, so it does see the authenticated request.

---

## Step 7 — do not forget the second bootstrap

If you have a CLI, it usually cannot use `SaaSiCatModule` (`controller.guards`
is mandatory; Discovery always gets a controller). Wire it from the **same**
persistence bundle and the **same** identity constant as the HTTP app.

vereinsfux had drifted here: the CLI loaded the plan catalog with hardcoded
`currency: 'EUR', vatRate: 19.0` and no `app`/`marketing`. Since the manifest
hash covers those fields, `GET /admin/manifest` and `vf manifest hash` could
never have matched — with no error anywhere.

---

## Step 8 — the only verification that counts is a boot

Unit tests will not catch this class of bug. In vereinsfux, three failures
survived a green typecheck **and** 394 green unit tests, and only appeared when
the process actually started:

1. A read-sink provider that no longer existed — the unit test happened to
   override exactly that token, so it was blind to it.
2. The duplicate-route abort from step 4.
3. A broken CLI bootstrap.

Boot the app against a real database, then check:

```bash
curl -s -o /dev/null -w '%{http_code}' localhost:PORT/api/v1/health          # 200
curl -s -o /dev/null -w '%{http_code}' localhost:PORT/api/v1/billing/plans   # 200
curl -s -X POST .../api/v1/billing/promo/preview                             # 400, not 404
<your-cli> manifest hash                                                     # boots, matches the app
```

A `404` where you expect a validation error means the route was never mounted.
That distinction is the whole point of the exercise.
