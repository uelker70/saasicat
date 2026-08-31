---
title: Administration and access to it
---

Who may act on the platform, and what has to be true before they can. Most of this chapter is
about the beginning and the end of a session — bootstrapping the first administrator, requiring a
second factor, and the roles that separate a tenant's administrator from a platform one.

### SC-ADM-001 — Only a platform administrator reaches the administration surface

🟢 🔒

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - SuperAdminGuard
        - accepts SUPER_ADMIN
        - rejects TENANT_ADMIN
        - rejects a missing user
- `packages/nest/tests/admin-manifest-module.test.js`
    - AdminManifestModule.forRoot — guard configuration
        - throws when the controller should be registered and `guards` is missing
        - accepts empty `guards: []` as an explicit auth-free choice
        - does NOT throw when `includeManifestController: false`
        - accepts a configured `guards` list
        - additionally accepts `reloadGuards` for MFA protection on reload
        - throws on missing `guards` even without an explicit includeManifestController
- `packages/nest/tests/discovery-controller.test.js`
    - DiscoveryController — GET /admin/discovery
        - returns the discovery snapshot as the body
        - sets the ETag header with snapshot.hash + scannedAt
        - returns HTTP 304 + null body on an If-None-Match match
        - returns the full snapshot when If-None-Match does not match
        - ignores an empty If-None-Match header
- `packages/nest/tests/saasicat-module-escape-hatches.test.js`
    - includeManifestController
        - is passed through to AdminManifestModule
        - defaults to mounting the manifest controller
- `packages/ui-vue/tests/one-way-to-authenticate.test.js`
    - the HttpClient is the only way a request gets its auth
        - there is a corpus to scan
        - no option named `getAuthToken` survives
        - nothing builds a Bearer header by hand

<!-- END proof -->

### SC-ADM-002 — A tenant-facing endpoint with no access rules configured refuses, it does not open

🟢 🔒 Failing loudly is the only safe reading; waving requests through would be silent.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-manifest-module.test.js`
    - AdminManifestModule.forRoot — guard configuration
        - throws when the controller should be registered and `guards` is missing
        - accepts empty `guards: []` as an explicit auth-free choice
        - does NOT throw when `includeManifestController: false`
        - accepts a configured `guards` list
        - additionally accepts `reloadGuards` for MFA protection on reload
        - throws on missing `guards` even without an explicit includeManifestController

<!-- END proof -->

### SC-ADM-003 — The administration requires a second factor

🟢 🔒 A one-time code alongside the sign-in. A code that cannot be checked — malformed, or a stored
secret that is unreadable — is treated as wrong, and the underlying cause is recorded so it can be
diagnosed rather than leaving somebody staring at "code invalid".

_Source:_ `docs/reference/error-codes.md` · `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaService — TOTP setup + verify
        - setup() generates secret + otpauth URI and persists via port
        - verify() rejects when no secret exists
        - verify() rejects an invalid code
        - disable() deletes the secret
        - isEnabled() reflects port state

<!-- END proof -->

### SC-ADM-004 — A one-time code is accepted across a small clock difference

🟢 Half a minute either way, so an administrator with a slightly wrong clock is not locked out.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaService — TOTP setup + verify
        - setup() generates secret + otpauth URI and persists via port
        - verify() rejects when no secret exists
        - verify() rejects an invalid code
        - disable() deletes the secret
        - isEnabled() reflects port state

<!-- END proof -->

### SC-ADM-005 — Actions with lasting consequences need the second factor and an explicit confirmation

🟢 🔒 Suspending or reactivating a tenant, acting as a tenant, exporting their data, cancelling their
subscription, and granting or withdrawing a pilot. The most serious of them ask the operator to
type the tenant's name.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaGuard — RequireMfa decorator + header check
        - SetMetadata decorator sets REQUIRE_MFA_KEY
        - passes through when endpoint is not MFA-required
        - NOT_AUTHENTICATED on missing user
        - MFA_NOT_SET_UP when port enabled=false
        - MFA_REQUIRED when no X-Mfa-Code header
        - MFA_FAILED on invalid code
        - accepts a valid code
        - bypass with SAAS_PLATFORM_SKIP_MFA=1 in non-prod
        - no bypass in production

<!-- END proof -->

### SC-ADM-006 — Two actions require a written reason before they run

🟢 Resetting somebody's password and deactivating a user. The reason is part of the record, which is
why a confirmation can carry a value rather than only a yes.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - AdminAuditService
        - actorTag formats source:email:context
        - log() writes through and appends the actor tag to changes
        - fromWebRequest builds AdminActor with source=web
        - fromWebRequest falls back to "unknown" when there is no session
        - fromCli builds AdminActor with source=cli + hostname

<!-- END proof -->

### SC-ADM-007 — There is no default confirmation that answers yes

🟢 An implementation that approved everything would silently approve every deletion, revocation and
deactivation, so an installation supplies its own or gets none.

_Source:_ release 0.26.0

### SC-ADM-008 — A password that cannot be retrieved again is shown without a way to dismiss it

🟢 Giving that dialog a cancel button would let an operator throw away something they cannot get
back.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/mfa-setup-flow.test.js`
    - MfaSetupFlow.run — first setup
        - returns secret + otpauthUri for SUPER_ADMIN
        - audit log contains issuer in changes
    - MfaSetupFlow.run — re-setup
        - rejects re-setup without confirmation (MFA_SETUP_ABORTED)
        - accepts re-setup with "yes" answer and audits MFA_SETUP_RESET
        - accepts re-setup with force=true without prompt
    - MfaSetupFlow.formatSetupResult
        - returns multi-line instructions with secret + URI

<!-- END proof -->

### SC-ADM-009 — First-run setup stops working the moment an administrator exists

🟢 Whatever token is presented. An installation cannot be taken over after it has been bootstrapped,
and the token is compared in a way that does not leak how close a guess was.

_Source:_ `SECURITY.md`

### SC-ADM-010 — Without a setup token configured, there is no setup route

🟢 That is the correct steady state once an installation is bootstrapped, rather than a route sitting
there refusing people.

_Source:_ `SECURITY.md`

### SC-ADM-011 — The first administrator is set up with a second factor immediately

🟢 Not as a later step somebody might skip.

_Source:_ release 1.0.0-rc.4

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/mfa-setup-flow.test.js`
    - MfaSetupFlow.run — first setup
        - returns secret + otpauthUri for SUPER_ADMIN
        - audit log contains issuer in changes
    - MfaSetupFlow.run — re-setup
        - rejects re-setup without confirmation (MFA_SETUP_ABORTED)
        - accepts re-setup with "yes" answer and audits MFA_SETUP_RESET
        - accepts re-setup with force=true without prompt
    - MfaSetupFlow.formatSetupResult
        - returns multi-line instructions with secret + URI

<!-- END proof -->

### SC-ADM-012 — Test-only bypasses are ignored in production

🟢 🔒 The switches that skip the second factor and the rate limits exist for continuous integration
and are honoured only outside production. An integrator cannot add their own.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaGuard — RequireMfa decorator + header check
        - SetMetadata decorator sets REQUIRE_MFA_KEY
        - passes through when endpoint is not MFA-required
        - NOT_AUTHENTICATED on missing user
        - MFA_NOT_SET_UP when port enabled=false
        - MFA_REQUIRED when no X-Mfa-Code header
        - MFA_FAILED on invalid code
        - accepts a valid code
        - bypass with SAAS_PLATFORM_SKIP_MFA=1 in non-prod
        - no bypass in production

<!-- END proof -->

### SC-ADM-013 — A tenant-facing action that costs money requires the tenant's own administrator

🟢 🔒 Changing a plan, booking an add-on and cancelling are not things any signed-in user of a tenant
may do. Reading stays open to everyone who is signed in.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-route-that-costs-money-asks-for-the-role.test.js`
    - a route that costs money asks for the role
        - the controller has routes, and each carries its metadata
        - every writing route asks for the tenant administrator
        - the three that cost money are actually among them
        - reading and previewing stay open to every tenant user
- `packages/nest/tests/tenant-billing-controller.test.js`
    - getEntitlement returns EffectiveLimitsSnapshot generically (quotas map)
    - getUsage joins Subscription + Limits + Usage and fills missing quotaKeys with 0
    - getUsage passes packageSnapshot + checkoutOfferId through 1:1 (P11.4)
    - getUsage returns packageSnapshot=null when the Subscription has no snapshot
    - getUsage throws NotFoundException when the Subscription is missing
    - getUsage throws NotFoundException when tenantIdResolver yields no ID
    - ComposedTenantAuthGuard chains guards in order — all ok = true
    - ComposedTenantAuthGuard short-circuits on the first false
    - ComposedTenantAuthGuard throws 403 without configured guards
- `packages/nest/tests/tenant-manifest.test.js`
    - buildTenantManifestController
        - creates a controller class with the configured path
- `packages/nest/tests/the-cost-routes-require-the-tenant-admin.test.js`
    - the cost-relevant tenant routes
        - the controller declares some, and each one is a real route
        - a caller without a role is refused, with the code the client reads
        - an unauthenticated caller is refused separately
        - the tenant's own administrator is admitted
        - `role` is honoured where `platformRole` is absent
        - a platform operator is admitted too
        - a plain member is refused

<!-- END proof -->

### SC-ADM-014 — An administrator identity may live in the platform's tables or the application's

🟢 The second factor works either way, so an installation that already has an admin user table does
not have to keep a second one.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/whoami-flow.test.js`
    - WhoAmIFlow.run
        - SUPER_ADMIN with MFA → full diagnosis
        - user not found → isSuperAdmin=false, no crash
        - production is detected
        - MFA skip visible in non-prod
        - MFA skip NOT active in production
    - WhoAmIFlow.formatResult
        - shows SUPER_ADMIN checkmark + MFA status
        - shows bypass warning when active
- `packages/nest/tests/admin-guards.test.js`
    - SuperAdminGuard
        - accepts SUPER_ADMIN
        - rejects TENANT_ADMIN
        - rejects a missing user

<!-- END proof -->

### SC-ADM-015 — The administration only offers what the application actually has

🟢 A screen or an action for something the application never declared is not shown at all.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/admin-resources-mapping.test.js`
    - the mapping
        - defaults to exactly the names that used to be hardcoded
        - a partial mapping leaves the rest at the defaults
    - a mapped delegate that does not exist fails at construction
        - and names what the client does have
        - and does not offer $connect as a candidate
        - the adapter refuses to be built with it
        - but an unmapped adapter is built even without those delegates
    - an app that calls everything something else
        - the tenant list queries and reads the mapped names
        - the detail route addresses the tenant by the mapped slug
        - suspending writes the mapped flag
        - the user list filters and reads the mapped names
    - an app that matches the convention is unaffected
        - no mapping means the same queries as before
    - the mapping reaches the two places it used to stop short of
        - the relation counter defaults to the mapped users relation
        - an explicit tenantMetrics still wins
        - the subscription list selects and reads the mapped tenant columns
        - and an unmapped app still selects slug and name
    - the two relations that live on the app models
        - the tenant list reads the mapped subscription relation
        - the detail route reads it as well
        - the user list filters and reads the mapped tenant relation
        - an unmapped app is unaffected in all three
- `packages/adapter-prisma/tests/prisma-admin-resources.test.js`
    - PrismaAdminResourcesAdapter serves every standard Admin resource
- `packages/cli/tests/manifest-cli-flow.test.js`
    - ManifestCliFlow.dump / hash / validate
        - dump returns the manifest 1:1
        - hash returns manifestHash
        - hash throws when hash is missing
        - validate ok for a clean manifest
        - validate rejects wrong schemaVersion
    - ManifestCliFlow.diff
        - null for identical hash
        - returns added/removed componentKeys
    - ManifestCliFlow.runChecks — DEFAULT_MANIFEST_CHECKS
        - clean manifest → overall=ok, all checks green
        - wrong manifestHash pattern → error, exitCode=7
        - per-tenant endpoint in TenantColumn → error
        - non-/admin route → error
        - unknown requiredCapability ref → error
        - wrong Capability pattern → error
        - SCREAMING_SNAKE_CASE actionKey now violates domain.action → error
        - formatReport shows severity icons + paths
- `packages/nest/tests/admin-resources.test.js`
    - AdminResourcesService keeps tenant actions and writes their audit entry
- `packages/nest/tests/tenant-manifest.test.js`
    - TenantManifestService
        - returns a snapshot with filtered NavItems (feature gate)
        - sorts NavItems by order ASC, default 100
        - requiresFeature as an array = logical OR
        - registerNavItem is idempotent (same id overwrites)
    - SaaSiCatModule + tenantManifest
        - tenantManifest without defaultPlanId/resolver throws
        - tenantManifest + defaultPlanId registers controller + service
- `packages/ui-vue/tests/app-served-resources.test.js`
    - pilotsResource — the paths a consumer already serves
        - ${c.op} calls ${c.method} ${c.url}
        - every operation this descriptor declares has a case above
    - platformEmailResource and emailHistoryResource
        - ${name}.${c.op} calls ${c.method} ${c.url}
        - ${name}: every operation has a case above
    - the second factor travels as a header, and only when there is one
        - ${name} sends the header with a code
        - ${name} sends no header for an empty code
    - the two operations the platform ships but does not serve
        - users.resetPassword posts the audit reason
        - promoCodes.detail reads one code by id
    - dashboardResource — the endpoint comes from the card, not from us
        - reads exactly the endpoint the card declares
        - a reading, not a rendering — the timestamp comes back unformatted
        - a body with no recognised number reads as null, not as a failure
- `packages/ui-vue/tests/manifest-loader.test.js`
    - ManifestLoader.load — first call
        - GET without If-None-Match, persists body + ETag
        - the client's auth header reaches the request untouched
        - storageKeyPrefix isolates caches
    - ManifestLoader.load — cache hit (304)
        - sends If-None-Match + returns cached body on 304
        - a 304 whose cached body is gone is repaired, not reported
        - a cached body that no longer parses is repaired the same way
        - a 304 to a request that carried no ETag is a server fault, and is reported
        - a server answering 304 unconditionally is reported after one repair, not looped on
    - ManifestLoader.load — refresh (200 with new ETag)
        - 200 overwrites cache with new body + ETag
    - ManifestLoader.clearCache
        - deletes body + ETag from storage
    - ManifestLoader.readCachedBody
        - returns null on empty cache
        - returns {etag, body} after a successful load
    - ManifestLoader — the client authenticates, per request
        - a token acquired after construction reaches the next request
        - a token that changes between requests is not cached
- `packages/ui-vue/tests/manifest-store-factory.test.js`
    - createManifestStore — Happy Path
        - initial: manifest=null, loaded=false, loading=false
        - ensureLoaded triggers load + sets loaded=true
        - ensureLoaded is idempotent — second call does not load again
        - parallel ensureLoaded calls share the same inflight promise
    - createManifestStore — error path
        - ensureLoaded rejects with the original error, state is still set
        - parallel ensureLoaded calls all reject with the same error
    - createManifestStore — clearCache + reload
        - clearCache clears manifest, loaded, loader cache
        - reload forces a re-load
    - createManifestStore — store ID override
        - uses the given `id`, so parallel stores are isolated
- `packages/ui-vue/tests/nav-builder.test.js`
    - buildRoutes — StandardPages filter
        - lists enabled StandardPages with Capability=true
        - rejects disabled pages
        - rejects pages without Capability
        - default routes from DEFAULT_STANDARD_PAGE_ROUTES
        - does not expose the removed planVersions standard page
        - ignores standard pages unsupported by this UI build
        - standardPageRoutes override
        - isStandard=true for StandardPages
    - buildRoutes — ProjectPages
        - lists a ProjectPage without requiredCapability
        - rejects a ProjectPage with a missing Capability
        - lists a ProjectPage with a satisfied Capability
        - navSection is passed through
        - availableExtensions filters out ProjectPages with an unknown componentKey
        - availableExtensions keeps ProjectPages with a known componentKey
    - buildSidebar — section grouping
        - sectionOrder wins, the rest alphabetical
        - sectionOrder override via second parameter
        - items within a section without mutation
    - resolveExtension
        - returns the registered component
        - null for an unknown key
- `packages/ui-vue/tests/resource-registry.test.js`
    - createResourceRegistry — the http requirement
        - refuses to be built without a client, rather than reaching for fetch
        - the message names the two clients the package ships
    - createResourceRegistry — a registry without a project to name
        - every platform resource builds from apiBase and locale alone
        - and the plan list it hands out addresses the catalogue
    - createResourceRegistry — reaching a resource
        - hands out the operations of the resource asked for
        - an unknown key fails by name, listing what there is
        - keys() reports what it can answer for
        - asking twice gives the same operations
        - a context getter is read per call
    - createResourceRegistry — overrides
        - a context override redirects one resource and leaves the others
        - an http override sends one resource through another client
        - one operation is wrapped and the other five stay the platform’s
        - the wrapper may answer without calling the platform at all
        - overriding a resource that does not exist fails at boot too
        - an override named after an Object prototype key is still rejected
        - an operation named after Object.prototype does not exist either
        - overriding an operation that does not exist fails at boot, not at click
    - platformResources
        - is what the shell registers, and every entry is a resource
    - registry.bind — an override for one page instance
        - the instance wrapper runs outside the app wrapper, and both run
        - an instance context wins over the app context for that page only
        - binding one operation leaves the others on the platform implementation
        - an unknown resource says so instead of returning something inert

<!-- END proof -->

### SC-ADM-016 — Signing out ends the session

🟢 It used to leave the operator looking at a sign-in form while still signed in.

_Source:_ release 0.22.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/sign-out-ends-the-session.test.ts`
    - AdminManifestErrorPage sign-out
        - calls the login adapter’s logout before leaving for /login
        - says so loudly when the app supplied no way to end the session
        - an explicit onLogout prop still wins over the default
    - AdminLayout sign-out
        - ends the session when no @logout listener is attached
        - defers to the app when one is
        - also defers when the listener was attached with @logout.once
    - sign-out and the cached manifest
        - discards the manifest, and does so even when logout rejects
    - handlers hand their promise back to Vue
        - a rejecting %s prop reaches Vue’s error handler

<!-- END proof -->

### SC-ADM-017 — An expired session offers a fresh sign-in once, not in a loop

🟢 Repeating it forever is how a rejected session becomes an unbreakable login loop.

_Source:_ release 0.22.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/navigation-guard.test.js`
    - buildNavigationGuard — auth path
        - returns null when neither authGuard nor manifestGuard is set
        - redirects to onUnauthenticated() when isAuthenticated is false
        - lets public routes bypass the auth guard
        - redirects to onUnauthenticated when isSuperAdmin is false
    - buildNavigationGuard — manifest fail-closed
        - redirects to errorRoute when ensureLoaded rejects and errorRoute is set
        - avoids redirect loop: when the current route is already errorRoute, returns true
        - falls back to render-allow + console.error when NO errorRoute is set
        - lets the render through when ensureLoaded resolves successfully
    - buildNavigationGuard — expired session vs broken manifest
        - 401 from the manifest load routes to login, not to the error page
        - 403 is treated the same way
        - a genuine manifest failure still fails closed to the error page
        - an error without a status stays on the fail-closed path
        - without an authGuard a 401 still reaches the error page
    - buildNavigationGuard — no login loop on a persistent manifest 401
        - first 401 offers a re-login, the second stops the circle
        - a successful load re-arms the redirect for a later expiry
        - concurrent navigations on one rejection share the login redirect
        - the second attempt fails closed once the operator has seen login
        - a cached error instance does not resurrect the login loop
        - a later, different rejection still fails closed

<!-- END proof -->

### SC-ADM-018 — A one-time code that was just accepted can currently be accepted again

🟢 Within its validity window. This is a known limitation, named rather than left to be discovered,
and the ordering of the checks plus transport encryption are the current mitigations.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaService — TOTP setup + verify
        - setup() generates secret + otpauth URI and persists via port
        - verify() rejects when no secret exists
        - verify() rejects an invalid code
        - disable() deletes the secret
        - isEnabled() reflects port state

<!-- END proof -->
