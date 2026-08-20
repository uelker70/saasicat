# Migrating an existing app to the standard stack

This is the migration recipe for a production-shaped NestJS application with
hand-wired platform modules, application-specific adapters and its own
SuperAdmin controllers. It records the recurring integration risks in the
order they should be addressed.

> The quickstart (`docs/quickstart.md`) covers a **new** app. This document is
> for an app that already wired the fine-grained modules by hand.

---

## What the standard stack does and does not cover

`SaaSiCatModule.forRoot(defineSaaSiCat({...}))` composes plan catalog,
entitlements, discovery, admin manifest, catalog, tenant billing, subscription
bundles, promo codes and the standard admin resources. It also composes
`SetupModule`, `AdminStatsModule`, `CheckoutOfferModule` and
`SubscriptionContractModule` when their options are enabled.

Expect the savings to come from **wiring**, not from your domain code.
Application-specific workflows, controllers and adapters stay in the consumer
because the platform cannot know their domain semantics or database shape.

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
    schema: YOUR_PRISMA_SCHEMA_OPTIONS, // plan binding, validity windows, delegates
    bundle: { validityWindows: true }, // reaches BOTH bundle repositories
    adminResources: false, // see step 5
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
_"MfaService is not available in the SetupModule module"_.

Since the shared-bundle build (`CONTRIBUTING.md` → _One bundle, many entries_)
every entry hands out the same objects, so this no longer bites. **Still import
platform things from `@saasicat/nest/platform`** when you use `SaaSiCatModule` —
it keeps the composition readable and is guaranteed correct.

If you ever see `UnknownDependenciesException` naming a platform class, this is
the first thing to check.

---

## Step 3 — map every option before deleting anything

Go through your `app.module.ts` option by option. Most map directly. The ones
that surprised us:

| Your wiring                                                                  | Standard stack                                  | Note                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PlanCatalogModule.forRoot({projectKey, app, currency, vatRate, marketing})` | `dbCatalog: {...}`                              | identity only; plans come from the read sink                                                        |
| `EntitlementModule.forRoot({...repos, resolutionConfig})`                    | `entitlement: { resolutionConfig }`             | repos come from the bundle                                                                          |
| `PublicCatalogModule.forRoot(...)`                                           | `catalog: { publicCatalog: true }`              | on by default                                                                                       |
| `PromoCodesModule.forRoot({includePublicController: true})`                  | `promoCodes: { includePublicController: true }` | **default flips to `false`** — set it explicitly or you silently lose `POST /billing/promo/preview` |
| `CatalogModule.forRoot({strictModeCheckMode})`                               | `catalog: { strictModeCheckMode }`              | **platform default is `blocking`** — pass yours verbatim                                            |

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
and it looks for `tenant`/`user`/`subscription` delegates.

Those are **defaults, not requirements**. If your models are called something
else, map them:

```ts
persistence: prismaPersistence({
    client: PrismaService,
    adminResources: {
        delegates: { tenant: 'organization', user: 'account' },
        fields: {
            tenant: { isActive: 'enabled', slug: 'handle', users: 'members' },
            // Prisma names a relation field after what it points at, so an app
            // whose tenant model is `Organization` usually calls this one
            // `organization` — on its own User model, which is why the delegate
            // mapping above does not cover it.
            user: {
                email: 'mail',
                firstName: 'givenName',
                tenant: 'organization',
            },
        },
    },
}),
```

A mapped delegate that does not exist on your client fails at construction and
the error lists the delegates your client does have — so a typo shows up at
boot, not on the first request to the tenants page.

What the mapping does not change is the **shape**. A consumer with an m:n
tenant-user relation, or tenants that have no activity flag at all, should keep
this option `false` and retain its own controllers — or implement
`AdminResourcesPort` directly, which needs no new controllers or DTOs.

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
> `@saasicat/nest/billing` instead — a _different_ class, backed by
> `ENTITLEMENT_SERVICE_TOKEN` rather than the static plan catalog. Pick the one
> matching your entitlement path; binding neither is the failure mode above.
>
> Verify it: call one `@RequireFeature` route with a tenant whose plan lacks
> that feature and confirm you get a 403.

The quota interceptor stays global either way — interceptors run _after_ all
guards, so it does see the authenticated request.

---

## Step 7 — do not forget the second bootstrap

If a CLI boots its own Nest graph, import the **same** SaaSiCat configuration or
derive a CLI-specific configuration from the **same** persistence bundle and
identity constant as the HTTP app. Duplicated identity values can drift
silently; because the manifest hash covers them, HTTP and CLI output will no
longer match.

---

## Step 8 — the only verification that counts is a boot

Unit tests may not catch this class of bug. Dependency and routing failures can
survive a green typecheck and unit suite, then appear only when the process
actually starts:

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
