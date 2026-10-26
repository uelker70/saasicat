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
- `packages/nest/tests/every-operator-route-requires-the-platform-administrator.test.js`
    - every operator route the platform mounts requires the platform administrator
        - the walk reaches the operator routes of more than one composer
        - each one runs SuperAdminGuard
        - after the guards that establish the caller, never before them
        - a signed-in tenant user is refused by name, and the platform administrator passes
        - a route marked public keeps no role check, so setup and the login branding stay reachable
        - with no guards passed, a request without a caller is refused rather than let through
        - the tenant manifest keeps authentication alone
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
    - MfaGuard — RequireMfa decorator + header check
        - MFA_NOT_SET_UP when port enabled=false
        - MFA_REQUIRED when no X-Mfa-Code header

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
- `packages/nest/tests/lasting-operator-actions-require-the-second-factor.test.js`
    - suspending and reactivating a tenant
        - an override of the administration guards that leaves the check out does not leave it out

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
    - getUsage states the price the subscription pays, as the plan preview reads it off the version
      bound
    - the tenant is taken from the session, not from what the caller sent
    - and a session that names none is refused rather than falling back
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
        - the tenants a subscriber names are read in one question, a soft-deleted one included
        - no tenants named, no question asked
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
    - the manifest commands print what the port answers
        - dump prints the manifest itself
        - hash prints the hash
        - validate reads the manifest before it judges it
- `packages/nest/tests/admin-resources.test.js`
    - AdminResourcesService keeps tenant actions and writes their audit entry
- `packages/nest/tests/an-operator-cancels-an-invoice.test.js`
    - where the cancellation is served
        - beside the invoices’ documents, announced as invoices.cancel with its audit action
        - nowhere the administration shows no tenants
- `packages/nest/tests/an-operator-corrects-a-subscriber-in-the-administration.test.js`
    - every subscriber route
        - the corrections are announced beside the subscriber view, and only there
- `packages/nest/tests/an-operator-finds-a-subscriber.test.js`
    - where the list and the record are served
        - beside the subscriber view, its page announced under the same capability
- `packages/nest/tests/an-operator-reads-and-pays-out-a-credit.test.js`
    - the manifest
        - announces the credits and the payout where they are served, and neither where they are not
- `packages/nest/tests/an-operator-reads-the-invoice-register.test.js`
    - where the register is served
        - beside the invoices’ documents, its page announced under invoices.read
        - nowhere the administration shows no tenants, or no invoices are issued
- `packages/nest/tests/an-operator-reconciles-what-matched-nothing.test.js`
    - the manifest
        - announces the cases, their closing and the payments where they are served, and none where
          they are not
- `packages/nest/tests/an-operator-sees-a-tenants-subscriber.test.js`
    - where the view is served
        - without ${without}, neither the routes nor the capabilities exist
- `packages/nest/tests/maintenance-is-wired-where-it-is-turned-on.test.js`
    - the screen the administration offers
        - one that does not, does not — so the screen is not offered
- `packages/nest/tests/tenant-manifest.test.js`
    - TenantManifestService
        - returns a snapshot with filtered NavItems (feature gate)
        - sorts NavItems by order ASC, default 100
        - requiresFeature as an array = logical OR
        - registerNavItem is idempotent (same id overwrites)
    - SaaSiCatModule + tenantManifest
        - tenantManifest without defaultPlanId/resolver throws
        - tenantManifest + defaultPlanId registers controller + service
- `packages/ui-vue/tests/an-operator-cancels-an-invoice.test.js`
    - where cancelling is offered
        - ${what}: ${offered ? 'at an invoice that stands' : 'nowhere'}
        - never at a cancellation invoice, wherever it is served
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
- `packages/ui-vue/tests/component/a-link-to-a-standard-page-goes-where-the-navigation-does.test.ts`
    - a link from one standard page to another
        - below the shell, goes where the shell’s navigation puts the page
        - outside any shell, goes to each page’s default route
    - a tenant’s page
        - goes back to the list of tenants where the shell put it
- `packages/ui-vue/tests/component/an-operator-corrects-the-subscriber.test.ts`
    - the operator corrects the subscriber in its record
        - without the capability, nothing is offered and no history is shown
- `packages/ui-vue/tests/component/an-operator-pays-out-a-credit.test.ts`
    - the subscriber's record shows its credits
        - without the capabilities, shows nothing and reads nothing, and offers no payout with the
          view alone
- `packages/ui-vue/tests/component/an-operator-retires-a-version-in-the-cockpit.test.ts`
    - retiring a version in the plan cockpit
        - is offered on the version no longer on sale, and on no other
        - says on a version that it was retired, and for which replacement
        - says how far the retirement has come, and marks a move overdue
        - marks the subscriptions not told yet for a look
        - says beside them why they wait, quieter than the count
        - counts the subscriptions reminded beside the states, unmarked
        - says so where the announcements could not be read
        - is not offered where the platform does not serve it
        - shows the replacement, its price, the dates and whom it misses before anything is sent
        - a blocker is said in words, and nothing can be announced
        - announcing names the subscriptions shown, and says what was sent
- `packages/ui-vue/tests/component/an-operator-retires-an-add-on-version.test.ts`
    - retiring an add-on version where the add-on is managed
        - is offered on the version no longer on sale
        - is not offered on the version on sale
        - is not offered where the platform does not serve it
        - says on a version that it was retired, onto which version, and how far that has come
        - says so where the announcements could not be read
        - shows the replacement, its list prices, the dates and whom it misses before anything is
          sent
        - an add-on with no version on sale says so, and asks for no preview
        - a blocker is said in words, and nothing can be announced
        - announcing asks for the code, names the bookings shown, and says what was sent
    - a deleted add-on
        - reads "Deleted", in its row and in the status filter
- `packages/ui-vue/tests/component/lists-mark-a-held-back-subscriber.test.ts`
    - the tenant list
        - marks the tenants held back, each with its reason, and asks once for the page
        - without a tax adapter it asks nothing and marks nobody
    - the subscription list
        - marks the tenant of each subscription held back, beside its name
- `packages/ui-vue/tests/component/maintenance-page-and-lock-banner.test.ts`
    - the lock strip in the administration’s shell
        - an installation that keeps no windows is not asked about them
- `packages/ui-vue/tests/component/subscriber-record-shows-the-account.test.ts`
    - the subscriber's record shows its account
        - moving to another subscriber shows nothing of the first one's account while the next one's
          is read
        - whose account it is, and each charge in the order the platform serves them
        - an amount is shown in the currency it was charged in
        - a subscriber without charges says so
        - a read that fails says so, and a retry asks again
        - without the capability, nothing is asked and no section is shown
- `packages/ui-vue/tests/component/subscriber-record-shows-the-contracts.test.ts`
    - the subscriber's record shows its contracts
        - one timeline per tenant, the latest start first, each naming what it changed and where its
          confirmation stands
        - marks the contracts in force on a day picked, and says so when none was
        - a contract superseded before it began says it was never in force, and is marked on no day
        - opens a contract into what it froze: its lines with where each came from, its invoices and
          its ids
        - leads to the catalogue, and back to the list, where the shell put those pages
        - leads to no catalogue page the platform does not serve
        - shows each line’s features and quotas, and filters the lines by them
        - copies an id, and says whether the browser let it
        - a confirmation that no longer matches its checksum is said at the contract, and not
          offered
        - a confirmation not archived yet, or not due, is said and not offered
        - downloads an intact confirmation under the name it was archived with
        - a download that fails says so, and saves nothing
        - a contract that fails to load says so
        - opening another contract closes the first, and reads the one opened
        - nothing of them where the platform does not serve them
    - the subscriber's record downloads an invoice's document
        - only where the platform serves it, the cancellation beside it or not
        - only for an invoice whose document is archived
        - beside the invoice, under the name it was issued with
- `packages/ui-vue/tests/component/tenant-detail-shows-the-subscriber.test.ts`
    - the tenant detail shows the tenant's subscriber
        - whom the contracts are concluded with, and the way into its record
        - a warning names each reason the next contract is held back
        - a tenant without a subscriber says so, and offers no record
        - a read that fails says so
        - without the capability, nothing is asked and no section is shown
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
        - a page linking to another resolves it as the navigation does
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
- `packages/ui-vue/tests/use-maintenance.test.js`
    - the shell asking whether tenants are locked out
        - asks nothing where the installation keeps no windows
- `packages/ui-vue/tests/use-subscriber-account.test.js`
    - useSubscriberAccount
        - where the manifest announces the account, it is read for the subscriber
        - with ${label}, nothing is asked and nothing is shown
        - a manifest that arrives later brings the account with it
        - another subscriber is another account
        - without a subscriber, nothing is asked
        - a read that fails leaves an error and no account
- `packages/ui-vue/tests/use-subscriber-attention.test.js`
    - useSubscriberAttention
        - asks once for the tenants shown, and answers each by its id
        - with ${label}, nothing is asked and nobody is held back
        - an empty list asks nothing
        - another page of tenants is asked about again
        - a read that fails leaves an error, and nobody marked
- `packages/ui-vue/tests/use-subscriber-corrections.test.js`
    - useSubscriberCorrections
        - where the manifest announces the corrections, the history is read for the subscriber
        - with ${label}, nothing is offered and nothing is read
        - a check is offered only where a tax adapter decides
        - a correction goes out with the second factor, is announced, and the subscriber and its
          history are read again
        - after a correction, the service's answer — ${found} — is announced as such, the correction
          beneath it
        - stepping back from the second factor writes nothing, announces nothing and answers null
        - a correction the server refuses rejects, so the dialog keeps the form and shows why
        - ${what} goes to the subscriber it was confirmed on, though the page moved on during the
          second factor
        - a correction stands though its announcement throws: answered, read again, the throw raised
          apart
        - a failed check whose announcement throws still settles: nothing read again, the throw
          raised apart
        - a change of business status goes out with the second factor and is announced
        - a check needs no second factor, announces what the service found, and reads again
        - a check that fails is reported, and nothing is read again
- `packages/ui-vue/tests/use-subscriber-credits.test.js`
    - the credits of a subscriber
        - are read where the platform serves them
        - are neither read nor offered where it does not, and a payout only with both
    - a payout
        - is recorded behind the second factor, announced, and the credits read again
        - where the operator steps back from the second factor records nothing and answers null
        - that fails rejects, so the dialog keeps the form, and announces nothing
        - belongs to the subscriber it was asked on, even if the page moved on meanwhile
- `packages/ui-vue/tests/use-subscribers.test.js`
    - useSubscribers
        - reads every subscriber at once
        - a search typed reads the list again from its first page
        - narrowed to those without a live tenant, asks for exactly those
        - the next page is added after the last subscriber read
        - a page read for a search no longer asked is dropped
        - a page on its way when the list is read again is dropped
        - two calls for the next page add it once
        - a next page that fails after the list was read again is not that list’s error
        - a next page that fails is shown as the list’s error, not thrown
    - useSubscriberRecord
        - where subscribers are served, the record is read for the subscriber on screen
        - with ${label}, nothing is asked
        - without a subscriber, nothing is asked
- `packages/ui-vue/tests/use-tenant-subscriber.test.js`
    - useTenantSubscriber
        - where the manifest announces the subscriber, it is read for the tenant
        - with ${label}, nothing is asked and nothing is shown
        - another tenant is another subscriber, and no tenant asks nothing
        - a read that fails leaves an error and no subscriber

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

### SC-ADM-019 — Early deletion, cancelling an invoice and joining a subscriber need a second factor

🟡 _(Decided, not yet delivered.)_ 🔒 Deleting a tenant before its recorded date (`SC-ADM-020`),
cancelling an invoice and joining a returning customer's tenant to the subscriber it had
(`SC-ADM-027`). Each also needs an explicit confirmation, and deleting a tenant early asks the
operator to type the tenant's name. A deletion date is not scheduled or withdrawn by hand: it is
recorded when a subscription ends and lifted by a new one (`SC-CANC-020`). The actions that were
there before are `SC-ADM-005`'s.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/invoice-cancel-cli-flow.test.js`
    - the preview is the command, and the cancellation the second one
        - with --apply it asks for the second factor and the confirmation, cancels as the operator
          and records it
- `packages/ui-vue/tests/an-operator-cancels-an-invoice.test.js`
    - the subscribers descriptor
        - cancels with the second factor and the preview’s digest
    - cancelling an invoice
        - is confirmed behind the second factor with the request previewed and its digest,
          announced, and read again
- `packages/ui-vue/tests/component/an-operator-cancels-an-invoice.test.ts`
    - an invoice cancelled from the subscriber’s record
        - is confirmed behind the second factor with the preview’s digest, announced, and the
          invoices read again
- `packages/ui-vue/tests/component/an-operator-reads-the-invoice-register.test.ts`
    - an invoice cancelled from the register
        - reads its subscriber’s record for the dialog, is confirmed behind the second factor, and
          the register read again

<!-- END proof -->

### SC-ADM-020 — Six actions require a written reason, cancelling an invoice among them

🟡 _(Decided, not yet delivered.)_ Resetting somebody's password, deactivating a user, cancelling an
invoice, correcting a subscriber's legal identity (`SC-SUB-017`), joining a tenant to the subscriber
a returning customer had (`SC-ADM-027`), and deleting a tenant before the
deletion date recorded when its subscription ended (`SC-CANC-020`, `SC-CANC-021`). The reason is
part of the record. An early deletion is for a legal reason, such as abuse or an order from an
authority, and only once the export was offered (`SC-PRIV-017`): the operator is shown the announced
date, and nothing is deleted until the operator confirms the deletion against it. Cancelling an
invoice records, beside the reason, any party detail the replacement has to carry corrected
(`SC-PRIC-095`), and an address to deliver to where the subscriber's record no longer holds an
invoice email (`SC-PRIC-094`). This entry supersedes `SC-ADM-006` in the change that delivers it.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-cancels-an-invoice.test.js`
    - what an operator gives a cancellation
        - passes with a reason, and with corrections and an address beside it
        - is trimmed before its lengths are checked, as the service settles it
        - with ${why} is refused
        - keeps the lines through a pipe that strips what no decorator names
    - a cancellation settles what it is given before anything else
        - the reason and the address trimmed, as the preview shows and the cancellation records them
        - an address of blanks as none given
        - refuses a reason ${why}, drawing no number
        - takes a reason of exactly the longest length
        - refuses an address ${why}
        - each correction as the subscriber’s record holds that detail
        - takes a correction of exactly the longest length
        - refuses ${why}
    - the cancellation route
        - writes the cancellation and records it under the operator, the address not named
        - records each line it moved, from what to what, in the invoice’s currency
        - of an invoice there is not is refused as none, and nothing is recorded
- `packages/ui-vue/tests/an-operator-cancels-an-invoice.test.js`
    - the request what the operator entered makes
        - with nothing but a reason: the reason trimmed, no corrections, no address
        - each text trimmed, a detail typed as nothing left as it was, one taken over as none kept
- `packages/ui-vue/tests/component/an-operator-cancels-an-invoice.test.ts`
    - an invoice cancelled from the subscriber’s record
        - previews what the reason and the corrections would write, the record’s values offered

<!-- END proof -->

### SC-ADM-021 — An operator finds everything about a subscriber in one record

🟡 _(Decided, not yet delivered.)_ 🔒 Master data, its live tenant and the ones it had before,
contracts with their history, invoices, payments, open items and the deletion record. The
contract dossier planned in #43 is part of this record rather than a second place to look.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/an-operator-finds-a-subscriber.test.ts`
    - the list of subscribers
        - names each subscriber, leads into its record, and says which tenant it is live for
        - asks again for what the operator types, and for those without a tenant
        - with nobody matching, says so
        - offers the next page where there is one, and reads it after the last subscriber
        - a list that fails to load says so
    - the head of a subscriber's record
        - names the subscriber, its master data with its invoice email, and its live tenant
        - names a tenant whose link was closed, from when until when
        - warns where the application no longer has a tenant whose link is still open
        - says so where the subscriber is linked to no tenant
        - a record that fails to load says so, and shows none of its sections
- `packages/ui-vue/tests/subscriber-record-resource.test.js`
    - subscribersResource.record
        - asks for the subscriber's record by its id, escaped
        - an answer with no body is an error

<!-- END proof -->

### SC-ADM-022 — An operator lists every invoice with totals per period and tax rate, and exports it

🔵 _(Superseded on 2026-10-26 by `SC-ADM-043`.)_ 💰 The register is ordered by issue date,
cancellation and replacement invoices included, and an invoice still awaiting its document
(`SC-PRIC-033`) is listed as such, so no number in the range stands without an explanation. Its
export is machine-readable: each line with its tax treatment and rate (`SC-PRIC-038`), the payments
and reversals against each invoice, the cancellation and replacement each names, and each document's
checksum (`SC-AUD-019`). Every export names the moment it is as of, and every payment, reversal,
cancellation and replacement in it carries the moment it was recorded. The same period as of the
same moment gives the same rows every time it is taken, so a hand-over to a tax advisor can be
repeated and compared; as of a later moment, the export shows what was recorded since, such as a
payment confirmed or an invoice cancelled after a period ended, rather than silently changing a row.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-ADM-023 — An operator can list open items, and every contract including former subscribers'

🟡 _(Decided, not yet delivered.)_ 💰 A contract register that forgets a subscriber once its
tenant is gone answers the one question it exists for wrongly.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-ADM-024 — A suspended tenant's users cannot act, and a read-only tenant cannot write

🟡 _(Decided, not yet delivered.)_ 🔒 SaaSiCat decides the state, and records it with every reason
that holds, such as an ended subscription (`SC-CANC-020`), an overdue invoice (`SC-PRIC-081`), a
suspension or a deletion under way; the strictest of them applies, a deletion under way before a
suspension and a suspension before read-only, and ending one reason lifts only that one. The
application checks it on every request through a port, sign-in included, so a session that was
already open when the state changed is held to it on its next request; SaaSiCat does the same on the
routes it protects. A state that is recorded and not enforced is a switch that looks like
protection. The operator acting as the tenant (`SC-ADM-005`) is not one of its users and is not held
to the state, except once the tenant is being deleted (`SC-PRIV-018`), so support and an export stay
possible on a suspended tenant; that access requires the second factor and is recorded. Read-only
stops at one write: while one of the subscriber's invoices is open, a user of the tenant holding the
billing permission (`SC-UI-023`) can still replace the payment method (`SC-PRIC-030`), because the
claim outlives the subscription (`SC-PRIV-013`) and nobody else can enter a means of payment for it.
A suspended tenant has no such exception, and lifting a suspension is the operator's (`SC-ADM-005`).
Once the tenant is deleted nobody is left to act in it, so an invoice still open is settled through
a payment page of the gateway that the operator sends to the contact address `SC-PRIV-013` keeps,
where the subscriber can pay it with a new payment method and needs no tenant.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-ADM-025 — An operator gets a description of the invoicing procedure to document its own on

🟡 _(Decided, not yet delivered.)_ 💰 German bookkeeping rules (GoBD) ask an operator to document how
its invoices are produced, numbered, corrected, archived, accessed and kept. SaaSiCat's
documentation describes each of those steps as SaaSiCat performs them, and names which parts the
installation's adapters and settings decide, so the operator writes only what is its own.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-ADM-026 — The administrator changes what the tenant pays; billing needs the billing permission

🟡 _(Decided, not yet delivered.)_ 🔒 Changing a plan, booking an add-on and cancelling are not things
any signed-in user of a tenant may do. The plan, the usage and a change's preview stay open to
everyone who is signed in; the invoices, the account and the payment method, reading and changing
alike, are for whoever holds the billing permission (`SC-UI-023`), which the tenant's administrator
holds unless the application says otherwise. This entry supersedes `SC-ADM-013` in the change that
delivers it.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-ADM-027 — An operator joins a returning customer's new tenant to the subscriber it had

🟡 _(Decided, not yet delivered.)_ 🔒 Self-registration creates a subscriber of its own
(`SC-REG-022`): matching a sign-up to an existing subscriber by an email address would hand whoever
types that address into the form another customer's record. A customer whose earlier tenant is
deleted and who signs up again is therefore joined by the operator, who declares that the new
subscriber is the same legal entity, with the second factor (`SC-ADM-019`) and a reason
(`SC-ADM-020`); a different entity is a transfer, as `SC-SUB-017` has it. The new tenant then
becomes the earlier subscriber's live tenant (`SC-SCOPE-012`), and its subscription with its
contract, its account and its payment method move to it, together with the master data sign-up
collected (`SC-PRIC-032`): the billing address and the invoice email replace what the earlier record
kept, and a legal name or tax identifier that differs is recorded as a correction of the same entity
(`SC-SUB-017`). Later invoices carry that subscriber, its customer number and the details just given
(`SC-PRIC-092`), and the contract keeps the party copy it was concluded with, which names the same
legal entity (`SC-AUD-020`). Documents already issued keep the parties they copied (`SC-PRIC-095`),
and the record created at
sign-up names the subscriber it was joined to, so `SC-ADM-021`'s one record shows the customer's
whole history. A subscriber with a live tenant is not joined to a second one.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-ADM-028 — An operator reads a subscriber's charges beside its tenant

🔵 _(Superseded on 2026-10-25 by `SC-ADM-037`.)_ 🔒 The tenant's page shows the charges of its
subscriber's account, newest first: each with the title its contract line had when the contract was
concluded, its period, what made it arise, when it became due, and its net amount in its currency.
The section names whose account it is, by customer number and legal name, and says so when the
tenant has no subscriber. It is read only and shows no total: without invoices and payments, a sum
would be read as what is owed (`SC-ADM-023`). It is offered only where the installation keeps a
journal of charges (`SC-ADM-015`), only the platform administrator reaches it (`SC-ADM-001`), and it
reads past the tenants' row-level policy the way the administration does (`SC-SEC-003`). Once the
subscriber's record exists (`SC-ADM-021`), the account is part of it.

_Source:_ #276 · #318

### SC-ADM-029 — Locking tenants out and letting them back in needs the second factor in the administration

🟢 🔒 Like suspending a tenant (`SC-SEC-013`), the route checks it itself, and the shipped
administration asks for the code and for a confirmation that says every tenant will be locked out.
The command line cannot ask a deploy script for a code: it takes the operator's identity and, against
production, a confirmation a script gives with `--yes`, and it records the action like every other
(`SC-AUD-001`). Announcing, moving and cancelling a window lock nobody out and need neither.

_Source:_ #329

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/maintenance-cli-flow.test.js`
    - what a writing command asks of the operator
        - an identity and the production confirmation — and no second factor
        - reading the status asks for nothing
- `packages/ui-vue/tests/maintenance-resource.test.js`
    - maintenanceResource
        - overview asks for the windows
        - announce posts the times and the message, and no second factor
        - reschedule patches the window, with its id escaped
        - cancel posts to the window
        - lock and unlock carry the second factor
        - an overview that answers nothing is an error, not an empty page
        - an overview that is not one is refused at the boundary, not handed to the page
        - every operation this descriptor declares has a case above
- `packages/ui-vue/tests/use-maintenance.test.js`
    - locking from the administration
        - asks for a confirmation that says every tenant is locked out, then for the code
        - a declined confirmation sends nothing and asks for no code
        - a cancelled code sends nothing
        - a lock that already held is said as such, not as a new lock
        - a refused lock is reported, and nothing claims it held
        - unlocking asks again, and says when there was nothing to unlock

<!-- END proof -->

### SC-ADM-030 — While tenants are locked out, every page of the administration says so

🟢 With the moment the lock began and the announced end, and louder once that end has passed, so an
operator who forgot to unlock is told wherever they are in the administration.

_Source:_ #329

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/maintenance-page-and-lock-banner.test.ts`
    - the lock strip in the administration’s shell
        - while tenants are locked out, the shell says so, with a way to the page
        - past the announced end it asks the operator to unlock
        - an announced window, or nothing, shows no strip
        - an installation that keeps no windows is not asked about them
- `packages/ui-vue/tests/use-maintenance.test.js`
    - the shell asking whether tenants are locked out
        - knows a lock at once, and asks again every interval
        - an announced window is no lock
        - stops asking when the shell unmounts
        - asks nothing where the installation keeps no windows
        - a failed read keeps what it knew rather than hiding the lock

<!-- END proof -->

### SC-ADM-031 — A deleted add-on is called deleted, so retiring names one thing

🟢 The administration labels a deleted add-on, and the filter for it, "Deleted". "Retired" is what
an add-on version is when it is retired for the bookings on it (`SC-BUN-038`), and one word naming
two things would leave an operator guessing which happened.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/an-operator-retires-an-add-on-version.test.ts`
    - a deleted add-on
        - reads "Deleted", in its row and in the status filter

<!-- END proof -->

### SC-ADM-032 — The operator reads a subscriber's history, with who, when and why

🔵 _(Superseded on 2026-10-25 by `SC-ADM-038`.)_ Beside the subscriber on the tenant's page, the
latest first: each correction of its legal identity with the values before and after, each change of
its country or business status, and each check of its VAT number with what the service found and
whether it counts now — each with when, who made it and why, where it says. A change of the number
is named once, as the correction it was. The history is read from the records the corrections write,
so it shows what is kept rather than a second log (`SC-SUB-017`, `SC-PRIC-043`).

_Source:_ #331 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note

🔵 _(Superseded on 2026-10-25 by `SC-ADM-039`.)_ 💰 The part of a refund that no credit takes, and the
part of a reversal that meets a credit already refunded or paid out (`SC-PRIC-084`), each become a
case to reconcile, once however often the gateway reports it. The cases stand on a list of their own
in the administration — with the subscriber, the payment and the gateway's reference, the amount and
when it was recorded — and on the subscriber's tenant page among its open cases, beside its invoices
with what each still owes and its credits. The operator closes a case with a note, behind the second
factor, and the audit log records who closed it, when and why; a closed case stays readable. A
refund that fails or is canceled, and a reversal the gateway takes back (`SC-PRIC-086`), close the
cases they opened, saying so.

_Source:_ #333 (decided 2026-10-14)

### SC-ADM-034 — Each invoice on the tenant page says what it corrects and what cancelled it

🔵 _(Superseded on 2026-10-25 by `SC-ADM-040`.)_ 💰 Each invoice on the subscriber's tenant page
names, by the numbers on the documents, the invoice it corrects — a cancellation invoice the one it
cancels, a replacement the one it replaces — and the cancellation invoice that cancelled it; a
replacement cancelled in turn says both. The operator is offered the cancellation at an invoice that
stands and is no cancellation invoice (`SC-PRIC-095`), where the platform serves it (`SC-ADM-015`).
Before the second factor, the dialog shows what the server says the cancellation will write, and a
cancellation whose figures changed since is refused with the new ones to confirm (`SC-UI-017`).

_Source:_ #334 (decided 2026-10-20)

### SC-ADM-035 — The operator says, line by line, what of a cancelled invoice is still owed

🟢 💰 The cancel dialog lists every line of the invoice with what its charge stands at, a correction
an earlier cancellation wrote included, and offers at each line whose charge asks for something:
owed, not owed, or owed at an amount below what it stands at. A discount, a credit and a correction
offer nothing and say so — a discount follows what it reduced (`SC-PRIC-095`). The lines offered
are the lines the cancellation accepts, because the server says which by the rule it settles them
by. The preview shows each line that moves, from what to what, and the replacement's lines, a
correction naming the line it corrects. The command line takes the same with
`--line <position>=not-owed` or `--line <position>=<amount>`, the amount with a dot and at most two
decimals.

_Source:_ #334 (decided 2026-10-22)

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/invoice-cancel-cli-flow.test.js`
    - the preview is the command, and the cancellation the second one
        - passes each line on by its position, not owed as nothing and an amount as typed
    - what the command refuses
        - a line whose amount takes a comma, saying to use a dot rather than guessing
    - the commands
        - print each line that moves from what to what, and the replacement’s lines with what each
          correction corrects
- `packages/nest/tests/an-operator-cancels-an-invoice.test.js`
    - the invoice the cancel dialog reads
        - names each line with what it stands at, and the charge’s line alone may be corrected
        - of a replacement, says what an earlier cancellation lowered each charge to
        - offers exactly the lines the cancellation accepts
        - of an invoice there is not is refused as none
- `packages/ui-vue/tests/an-operator-cancels-an-invoice.test.js`
    - what of each line the operator says is owed
        - names a line not owed as nothing owed, one owed in part with its amount, and leaves one
          owed out
        - names no lines where every line is owed
        - with ${what}: ${askable ? 'asked about' : 'not asked about yet'}
        - ${what} offers no choice, and says why: ${why}
    - the subscribers descriptor
        - reads the invoice with its lines, by its id escaped
    - cancelling an invoice
        - asks nothing while a line owed in part says no amount
        - sends the lines the operator named with the request it previews
    - the lines the dialog offers
        - are read when it opens
        - of another invoice replace the first one’s at once, and are read for it
        - go when it closes
        - that fail to load say so, and are read again on retry
- `packages/ui-vue/tests/component/an-operator-cancels-an-invoice.test.ts`
    - the lines of an invoice cancelled from the subscriber’s record
        - offer a choice at the line the server says may be corrected, and say why at the others
        - name each choice after its line, and say which option is chosen
        - owed in part ask for the amount before the preview, and send it
        - not owed send nothing owed, and owed again send nothing of the line
        - in the preview, show each line that moves from what to what, and the replacement’s lines
          with what each correction corrects
        - that fail to load say so, offer to read them again, and leave the rest of the dialog
          working

<!-- END proof -->

### SC-ADM-036 — An operator finds a subscriber by its number, name or VAT number, tenant or not

🟢 🔒 The administration lists every subscriber, the latest customer number first, and finds one by
its customer number — behind the prefix typed, in any case, or behind any prefix where none is typed
—, by a part of its legal name in any case and with every character taken literally, or by its VAT
number however it is spaced; a filter shows only those whose every tenant link is closed. A
subscriber's record is reached by the subscriber itself rather than through its tenant, so it stays
where it is once the tenant is gone (`SC-ADM-021`). The record names every tenant the subscriber was
linked to, the live one first and then the earlier ones, the latest first, with when each link began
and ended, and leads to the tenant's page where the application still has the tenant. Where a link
is still open and the application no longer has its tenant, the record says so instead of reading
the link as ended: a link ends when the application's deletion of the tenant closes it, and a tenant
the application soft-deleted can come back. Only the platform administrator reaches the list and the
record (`SC-ADM-001`), and both read past the tenants' row-level policy the way the administration
does (`SC-SEC-003`).

_Source:_ #335 (decided 2026-10-25)

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/admin-resources-mapping.test.js`
    - an app that calls everything something else
        - the tenants a subscriber names are read in one question, a soft-deleted one included
- `packages/core/tests/a-search-reads-what-a-caller-gives.test.js`
    - the terms a search matches
        - ${JSON.stringify(blank)} asks for every subscriber
        - a name is matched as typed, trimmed, and names no customer number
        - ${JSON.stringify(typed)} names the number ${customerNumber.sequence} behind
          ${customerNumber.prefix ?? 'any prefix'}
        - ${why} names no customer number
        - the largest number a store counts to is a number, the next one is none
        - a VAT number typed in one piece names no customer number past what a store counts to
        - a VAT number is matched as a subscriber keeps it: without blanks, dots and hyphens, in
          capitals
        - a line of blanks around a word takes no longer to read than the word
    - the tenant links a record lists
        - the live one first, then the closed ones, the latest closed first
        - two closed at the same moment go by when each was made, then by the tenant
        - leaves the list it was given as it was
- `packages/nest/tests/an-operator-finds-a-subscriber.test.js`
    - the list of subscribers
        - is every subscriber, the latest customer number first, each with the tenant it is live for
        - is searched by a legal name, a customer number or a VAT number
        - names a live tenant the application no longer has by its id alone
        - narrowed to those without a live tenant, is the ones whose every link is closed
        - is read a page at a time, the next one named by the last subscriber on it
        - is read outside the tenants' row-level policy, the tenants named in one question
    - the head of a subscriber's record
        - is its master data with its invoice email, its standing, and the tenant it is live for
        - names a tenant whose link was closed, with when
        - says when the application no longer has a tenant whose link is still open
        - of a subscriber there is not is refused, by code
        - is read outside the tenants' row-level policy
- `packages/ui-vue/tests/component/an-operator-finds-a-subscriber.test.ts`
    - the list of subscribers
        - names each subscriber, leads into its record, and says which tenant it is live for
        - asks again for what the operator types, and for those without a tenant
        - with nobody matching, says so
        - offers the next page where there is one, and reads it after the last subscriber
        - a list that fails to load says so
    - the head of a subscriber's record
        - names the subscriber, its master data with its invoice email, and its live tenant
        - names a tenant whose link was closed, from when until when
        - warns where the application no longer has a tenant whose link is still open
        - says so where the subscriber is linked to no tenant
        - a record that fails to load says so, and shows none of its sections
- `packages/ui-vue/tests/subscriber-record-resource.test.js`
    - subscribersResource.list
        - asks for ${what}
        - an answer with no body is an error, not a list with nobody on it
- `packages/ui-vue/tests/use-subscribers.test.js`
    - useSubscribers
        - reads every subscriber at once
        - a search typed reads the list again from its first page
        - narrowed to those without a live tenant, asks for exactly those
        - the next page is added after the last subscriber read
        - a page read for a search no longer asked is dropped
        - a page on its way when the list is read again is dropped
        - two calls for the next page add it once
        - a next page that fails after the list was read again is not that list’s error
        - a next page that fails is shown as the list’s error, not thrown
    - useSubscriberRecord
        - where subscribers are served, the record is read for the subscriber on screen
        - with ${label}, nothing is asked
        - without a subscriber, nothing is asked

<!-- END proof -->

### SC-ADM-037 — An operator reads a subscriber's charges in its record

🟢 🔒 The subscriber's record shows the charges of its account, newest first, whichever subscription
and tenant each arose under: each with the title its contract line had when the contract was
concluded, its period, what made it arise, when it became due, and its net amount in its currency.
The section names whose account it is, by customer number and legal name. It is read only and shows
no total: a sum of charges would be read as what is owed (`SC-ADM-023`). It is offered only where
the installation keeps a journal of charges (`SC-ADM-015`), only the platform administrator reaches
it (`SC-ADM-001`), and it reads past the tenants' row-level policy the way the administration does
(`SC-SEC-003`).

_Source:_ #276 · #318 · #335 (decided 2026-10-25)

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-reads-a-subscribers-account.test.js`
    - the operator reads a subscriber's account
        - newest first, and within one due date the plan, then its add-ons, then its discounts
        - each charge as the journal holds it, its dates as the wire carries them
        - a charge under a superseded contract keeps the title that contract gave it
        - a charge whose contract line cannot be read is shown without a title
        - names whose account it is by customer number and legal name
        - of a subscriber there is not is refused, by code
        - keeps its charges once the subscription they arose under is gone
    - two charges due at the same moment
        - the one for the later period comes first
    - the account is served in the subscriber's record
        - with a journal and the tenants, the route answers and the manifest announces it
        - an unknown subscriber is answered as not found, by code
        - the subscriber is found and its journal read outside the tenants' row-level policy
        - the journal the route reads is the one the platform writes to, built once
        - without ${without}, neither the route nor the capability exists
    - mounted by hand
        - without the bypass port, it refuses to start rather than read in a tenant scope
        - with it, it starts
- `packages/ui-vue/tests/component/subscriber-record-shows-the-account.test.ts`
    - the subscriber's record shows its account
        - moving to another subscriber shows nothing of the first one's account while the next one's
          is read
        - whose account it is, and each charge in the order the platform serves them
        - an amount is shown in the currency it was charged in
        - a subscriber without charges says so
        - a read that fails says so, and a retry asks again
        - without the capability, nothing is asked and no section is shown
- `packages/ui-vue/tests/subscriber-charges-resource.test.js`
    - subscribersResource.charges
        - asks for the subscriber's charges, with its id escaped
        - an answer with no account is an error, not an account with no charges
- `packages/ui-vue/tests/use-subscriber-account.test.js`
    - useSubscriberAccount
        - where the manifest announces the account, it is read for the subscriber
        - with ${label}, nothing is asked and nothing is shown
        - a manifest that arrives later brings the account with it
        - another subscriber is another account
        - without a subscriber, nothing is asked
        - a read that fails leaves an error and no account

<!-- END proof -->

### SC-ADM-038 — The operator reads a subscriber's history in its record, with who, when and why

🟢 In the subscriber's record, the latest first: each correction of its legal identity with the
values before and after, each change of its country or business status, and each check of its VAT
number with what the service found and whether it counts now — each with when, who made it and why,
where it says. A change of the number is named once, as the correction it was. The history is read
from the records the corrections write, so it shows what is kept rather than a second log
(`SC-SUB-017`, `SC-PRIC-043`).

_Source:_ #331 · #335 (decided 2026-10-25) · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-corrects-a-subscriber-in-the-administration.test.js`
    - the subscriber's history
        - names each correction, change and check once, the latest first, with who and why
        - of a subscriber there is not is refused, by code
- `packages/ui-vue/tests/component/an-operator-corrects-the-subscriber.test.ts`
    - the operator corrects the subscriber in its record
        - offers the corrections, and a check where a tax adapter decides and a number is held
        - offers no check where no tax adapter names a service
        - without the capability, nothing is offered and no history is shown
        - a correction is sent only once something changed and a reason is given, with the second
          factor
        - stepping back from the second factor sends nothing and keeps the form
        - moving to another subscriber closes an open dialog and shows nothing of the first one
          while the next one is read
        - the next subscriber read and its history not yet: none of the first one's history is shown
        - a "${label}" dialog left open does not open again for the next subscriber once it is read
        - while the subscriber is read again after a correction, its actions wait for it
        - a check is asked without the second factor
        - the history lists each correction and check with what it changed, why and by whom
    - the subscriber section on its own
        - closes a "${label}" dialog once ${next ? 'another subscriber' : 'none'} is shown

<!-- END proof -->

### SC-ADM-039 — The operator reconciles what no credit matched, and finds each case in the record

🟢 💰 The part of a refund that no credit takes, and the part of a reversal that meets a credit
already refunded or paid out (`SC-PRIC-084`), each become a case to reconcile, once however often
the gateway reports it. The cases stand on a list of their own in the administration — with the
subscriber, the payment and the gateway's reference, the amount and when it was recorded — and in
the subscriber's record among its open cases, beside its invoices with what each still owes and its
credits. The operator closes a case with a note, behind the second factor, and the audit log records
who closed it, when and why; a closed case stays readable. A refund that fails or is canceled, and a
reversal the gateway takes back (`SC-PRIC-086`), close the cases they opened, saying so.

_Source:_ #333 (decided 2026-10-14) · #335 (decided 2026-10-25)

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/a-reversal-takes-its-turn-in-statements.test.js`
    - a reversal
        - takes the turn of every invoice its payment settles, in one order, then the credits, then
          its own row
        - of a payment this installation does not hold, holds and writes nothing
        - in another currency than its payment, is refused before anything is held
        - held under its reference against another payment, is refused
        - is found by its id, and none by another
    - the cases to reconcile
        - the open ones are read the oldest first, a page at a time, for one subscriber where named
        - the closed ones are read without a cursor in one statement
        - one is closed only where it is still open, and one closed before or unknown is answered as
          such
    - what the credits and invoices read
        - what each invoice owes is read in three statements, and nothing is asked for none
        - the accounts holding credits are asked with the kinds that give back
- `packages/adapter-prisma/tests/a-reversal-is-written-in-its-payments-turn.test.js`
    - a reversal
        - takes the turn of every invoice its payment settles, in one order, then the credits, then
          its own row
        - takes the open credit first, then opens the invoice, and writes its totals on its row
        - reported again unchanged, writes nothing but the row it skips
        - grown since the last report, writes only what grew
        - meeting a credit already paid out and going beyond the payment, opens one case
        - takes a credit another payment for the same invoice left before it opens the invoice
        - of a payment this installation does not hold, writes nothing
        - in another currency than its payment, is refused before anything is held
        - held under its reference against another payment, is refused
    - a reversal given back
        - in full, gives back what it took of the credit, settles the invoice again, and only once
        - closes the case it opened first, as SaaSiCat and saying why
        - after the invoice was paid again, leaves what it no longer owes as a credit from the
          reversal
    - the cases to reconcile
        - are read open or closed, the oldest first, a page after the case it names
        - one is closed with the operator’s note once, and an unknown one is answered as such
        - a refund’s part no credit takes opens one, once, and its failure closes it
    - what the credits and invoices read
        - what each invoice owes is read in three statements, and nothing is asked for none
        - a reversal is found by its id, and none by another
        - the accounts holding credits are asked with the kinds that give back, and read as texts
        - an invoice that owes less than nothing becomes a credit of its own, once
- `packages/core/tests/a-reversal-takes-a-payment-back.test.js`
    - a case to reconcile
        - is opened about exactly what its kind says, open and without a note
        - reads back closed with a note, by the operator or by SaaSiCat
        - ${why} stops the read
- `packages/nest/tests/a-payment-is-recorded-and-a-credit-paid-out.test.js`
    - a refund the operator made in the gateway
        - beyond what the subscriber is owed is recorded, and what matches nothing is a case to
          reconcile, audited
- `packages/nest/tests/a-reversal-reopens-an-invoice.test.js`
    - a reversal the gateway reports
        - that meets a credit already refunded opens a case, audited for the operator
    - a reversal the gateway gives back
        - closes the cases it opened, audited as closed because the money came back
- `packages/nest/tests/an-operator-reconciles-what-matched-nothing.test.js`
    - the cases to reconcile
        - are listed open, the oldest first, with whom and what each is about
        - are read a page at a time, the next one named
        - are closed with the note, trimmed, by the operator who closed it
        - closed once: a second close is refused, and nothing is written
    - a subscriber's payments
        - are its invoices, the latest first, with what each still owes, and its open cases alone
        - of a subscriber there is not are refused, by code
- `packages/ui-vue/tests/component/an-operator-reconciles-what-matched-nothing.test.ts`
    - the reconciliation page
        - lists the open cases with whom and what each is about
        - with nothing open, says so
        - closes a case with its note behind the second factor
        - offers no closing without the capability to close
        - the closed cases show the note, and who closed one where SaaSiCat did
    - the subscriber's payments in its record
        - shows the invoices with what each still owes, and the open cases
        - are not asked for where the platform does not serve them
        - a credit a reversal given back left names the reversal
- `packages/ui-vue/tests/reconciliation.test.js`
    - reconciliationResource
        - has the two operations the cases below drive, and no other
        - cases asks for the state, and continues after a case where one is named
        - close posts the note against the case, escaped, with the second factor
    - subscribersResource.payments
        - asks for the subscriber's payments, with its id escaped
    - the list of cases
        - reads the open cases when the page opens, and the next page when asked
        - switching to the closed cases reads them from the first page, dropping what was added
        - a page that fails to load is shown as the list's error, not thrown
        - closes a case with its note behind the second factor, and reads the list again
        - a cancelled code closes nothing
    - a subscriber's payments
        - are read where the manifest announces them, and not otherwise

<!-- END proof -->

### SC-ADM-040 — Each invoice in the subscriber's record says what it corrects and what cancelled it

🟢 💰 Each invoice in the subscriber's record names, by the numbers on the documents, the invoice it
corrects — a cancellation invoice the one it cancels, a replacement the one it replaces — and the
cancellation invoice that cancelled it; a replacement cancelled in turn says both. The operator is
offered the cancellation at an invoice that stands and is no cancellation invoice (`SC-PRIC-095`),
where the platform serves it (`SC-ADM-015`). Before the second factor, the dialog shows what the
server says the cancellation will write, and a cancellation whose figures changed since is refused
with the new ones to confirm (`SC-UI-017`).

_Source:_ #334 (decided 2026-10-20) · #335 (decided 2026-10-25)

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-cancels-an-invoice.test.js`
    - the invoices in the subscriber’s record after a cancellation
        - say which is cancelled, which cancels it and which replaces it, and nothing of the rest
- `packages/ui-vue/tests/an-operator-cancels-an-invoice.test.js`
    - the invoices a cancellation is offered at
        - ${what}: ${offered ? 'offered' : 'not offered'}
- `packages/ui-vue/tests/component/an-operator-cancels-an-invoice.test.ts`
    - the invoices in the subscriber’s record
        - say what each stands in relation to, and offer cancelling only where one stands
        - offer no cancelling where the platform does not serve it

<!-- END proof -->

### SC-ADM-041 — The record shows every contract as it was concluded, and how one followed another

🟢 💰 Each contract in a subscriber's record shows what was frozen when it was written — its plan,
add-ons and discounts with their titles, descriptions, quantities, prices, tax, features, quotas and
minimum terms, its terms version and notice period — and never what today's catalogue says. The
contracts of each tenant stand in a timeline by their start, each naming what it changed against the
one in force before it: concluded, the plan upgraded or downgraded by its net price per month or
changed at the same price, add-ons added or removed, frozen anew, or cancelled; a contract
superseded before it began is shown as never in force. A day picked marks the contracts in force on
it, read in the installation's time zone. Each line names where it came from and whether that source
is still in the catalogue, was removed from it, or is gone, and leads to the catalogue only where it
still is. A contract names the invoices issued under it. Where its archived confirmation no longer
matches the checksum recorded when it was rendered, the contract says so and offers no download of
it. A contract is read through its subscriber: one that is another subscriber's is refused as one
that does not exist.

_Source:_ #335 (decided 2026-10-26) · #43

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-contract-reads-as-it-was-frozen.test.js`
    - what a contract changed against the one before it
        - the first contract of a tenant is concluded, not changed
        - ${why} is ${expected ?? 'no change of plan'}
        - a plan on one side only is a change of plan; none on either is none
        - names the add-ons added and the ones removed, by their key
        - an add-on at another version is neither added nor removed
        - the same plan and add-ons written anew is frozen anew, at the price it says
        - the price compares per year, so a yearly contract at the same price per month is unchanged
        - the last contract of a tenant that ends is cancelled; one open-ended or superseded is not
        - a contract never in force is not what the next one changed, and is not cancelled
        - a cancellation that lands where a scheduled change was to begin is said at the contract it
          ended
        - each tenant has a timeline of its own, ordered by start and then by when written
    - a contract as the list shows it
        - reads its days in the installation’s zone, across midnight
        - an end at midnight leaves the day before as its last day
        - one never in force has no last day and says so
        - names its plan and add-ons as frozen, and the latest minimum term of its lines
        - lists the one written last first
    - the lines of a contract
        - read the plan, then the add-ons, then the discounts, each kind in the contract’s order
        - a discount names no source, and the catalogue is not asked about it
        - hand out copies of what the contract froze
    - where a line’s source stands in today’s catalogue
        - is in the catalogue, removed from it, or deleted
    - the invoices issued under a contract
        - are only the contract’s, the latest issue day first, and of one day by number
- `packages/nest/tests/a-contract-is-confirmed.test.js`
    - a contract’s dossier
        - is the contract as it was frozen, each line with where it came from, and the invoices
          issued under it
        - says when its archived confirmation no longer matches, and writes that to the audit log
          once
        - is waiting while its confirmation is due and not archived, and not due for one written
          before
        - without a catalogue to ask, no line says where it came from
        - of another subscriber’s contract is refused as one that does not exist, as are an unknown
          one and an unknown subscriber
    - the operator’s download of a confirmation
        - serves a contract’s dossier in its record, read outside any row policy, each line with
          where the platform’s catalogue has it
        - starts where the catalogue’s repositories need what only the catalogue is given, and asks
          them there
- `packages/ui-vue/tests/a-contract-timeline-reads-per-tenant.test.js`
    - the timelines of a subscriber’s contracts
        - are one per tenant, in the order the record names the tenants, the latest start first
        - of two contracts that start together, the one written later comes first
    - a contract in force on a day
        - ${day} is ${expected ? 'in' : 'outside'} 2026-01-05 – 2026-01-31
        - one open-ended is in force on every day from its first
        - one never in force is in force on no day, its first included
    - what a contract changed, as the timeline says it
        - in order: concluded or the plan, the add-ons, frozen anew, cancelled
        - frozen anew says whether the price moved
        - the first contract is concluded
    - the lines a filter keeps
        - are every line while nothing is typed
        - are those with a feature or a quota holding the text, in any case
        - take the text as it is, a character a pattern would read otherwise included
    - a standard page the manifest serves
        - is enabled, and given the capability it names
        - is not one disabled, one without its capability, or one the manifest does not name
    - useContractDossier
        - reads nothing until a contract is opened, then the one opened
        - opening the one open closes it; opening another reads that one
        - another subscriber finds nothing open, and asks nothing about the contract of the one
          before
    - useCopyText
        - writes the text and says it did
        - a clipboard that refuses, or none at all, is said rather than thrown
- `packages/ui-vue/tests/component/subscriber-record-shows-the-contracts.test.ts`
    - the subscriber's record shows its contracts
        - one timeline per tenant, the latest start first, each naming what it changed and where its
          confirmation stands
        - marks the contracts in force on a day picked, and says so when none was
        - a contract superseded before it began says it was never in force, and is marked on no day
        - opens a contract into what it froze: its lines with where each came from, its invoices and
          its ids
        - leads to the catalogue, and back to the list, where the shell put those pages
        - leads to no catalogue page the platform does not serve
        - shows each line’s features and quotas, and filters the lines by them
        - copies an id, and says whether the browser let it
        - a confirmation that no longer matches its checksum is said at the contract, and not
          offered
        - a confirmation not archived yet, or not due, is said and not offered
        - downloads an intact confirmation under the name it was archived with
        - a download that fails says so, and saves nothing
        - a contract that fails to load says so
        - opening another contract closes the first, and reads the one opened
        - nothing of them where the platform does not serve them
- `packages/ui-vue/tests/subscriber-record-resource.test.js`
    - subscribersResource.contract
        - asks for one of the subscriber's contracts by both ids, each escaped
        - an answer with no body is an error

<!-- END proof -->

### SC-ADM-042 — An operator lists the invoices of chosen months, summed per tax treatment and rate

🟢 💰 The register lists every invoice issued in the months asked for — the current month in the
installation's time zone where none is, one month alone where only one is, and never more than
twelve at a time, so one read stays bounded; a longer stretch is read a year at a time —, whichever
subscriber and tenant it was for, a tenant deleted since included. It lists them by issue date and
then by number, cancellation invoices and replacements among them, fifty to a page. Each names its
number, its date, what it corrects and the cancellation invoice that cancelled it however much
later, the subscriber as the invoice names it with the way into its record, its net, tax and gross,
and whether its document is archived or still awaited (`SC-PRIC-033`). Beside the list stand the
sums of each month per currency, tax treatment and rate — net, tax and gross —, a month without
invoices saying so, and the sums of the whole span: two invoices at 0 %, one exempt and one under
the reverse charge, are two sums, two currencies are never added together, and a cancellation
invoice takes off, in the month it was issued, what the invoice it cancels added in its own. Months
that cannot be read — the second before the first, more than twelve — are refused with a code of
their own and said before anything is asked. An invoice that stands is cancelled from its row as
from the subscriber's record (`SC-ADM-020`, `SC-ADM-035`), and on the command line by its number
alone, a tenant named beside it only refusing an invoice issued for another tenant. Only the
platform administrator reaches the register (`SC-ADM-001`), and it reads past the tenants' row-level
policy the way the administration does (`SC-SEC-003`).

_Source:_ #335 (decided 2026-10-26) · #276

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/invoice-cancel-cli-flow.test.js`
    - the invoice the command names
        - is named by its number alone, an invoice of a tenant deleted since included, and no tenant
          is read
        - with --tenant, is cancelled where it was issued for that tenant
        - with --tenant, is refused where it was issued for another tenant, asking no second factor
          and cancelling nothing
- `packages/core/tests/the-register-adds-up-its-months.test.js`
    - the months a view spans
        - ${JSON.stringify(asked)} spans ${from} to ${until}
        - the current month is the one today falls on, from its first day to its last
        - a span across the turn of the year lists December before January
        - ${month} ends on ${last}
        - ${INVOICE_REGISTER_MAX_MONTHS} months are one view
        - one month more is refused, naming how many were asked
        - a span of centuries is refused as one more month is
        - ${from} to ${until} is refused as reversed
        - ${JSON.stringify(text)} is no month to span
    - what a month is
        - ${JSON.stringify(text)} ${month ? 'is' : 'is not'} one
    - what the invoices add up to
        - every month of the span is there, one without invoices with no sums
        - an invoice adds to its month and to the span, its gross its net plus its tax
        - two rates are two sums, the lower rate first
        - 0 % exempt and 0 % under the reverse charge are reported apart, in the order the
          treatments are named
        - a cancellation takes off in its own month what the invoice it cancels added in its month
        - a month a cancellation empties keeps its sum at nothing rather than dropping it
        - two currencies are never added together
        - amounts are added in whole cents, as an advisor adds them
        - an invoice dated outside the span is refused rather than left out
- `packages/nest/tests/an-operator-cancels-an-invoice.test.js`
    - the invoice an operator names by its number
        - is the invoice under that number with the tenant it was issued for, and none for a number
          none carries
- `packages/nest/tests/an-operator-reads-the-invoice-register.test.js`
    - a page of the register
        - is every invoice of the months asked for, whichever tenant it was for, by issue date and
          then number
        - names each invoice’s subscriber as it names itself, the way into its record, and its
          amounts
        - says whose document is archived, and which cancellation invoice cancelled an invoice,
          however much later
        - holds ${INVOICE_REGISTER_PAGE_SIZE} invoices, and the next one continues after its last
        - is the current month in the installation’s zone where no month is asked for
        - is read outside the tenants' row-level policy
    - the totals of the register
        - are the months asked for, per rate, a cancellation taking off in its own month
    - the months the register refuses
        - ${why}, with its code and no read, for the page and the totals
    - what the register takes
        - two months and an invoice to continue after, and nothing else
        - refuses ${why} at ${route}
    - where the register is served
        - beside the invoices’ documents, its page announced under invoices.read
        - nowhere the administration shows no tenants, or no invoices are issued
- `packages/ui-vue/tests/component/an-operator-reads-the-invoice-register.test.ts`
    - the register of invoices
        - reads the platform’s current month once, and shows the months it answered
        - adds up each month per treatment and rate, and the whole span beneath
        - lists each invoice with how it stands, its subscriber and amounts, and whether its
          document is archived
        - leads into a subscriber’s record wherever the shell put the subscribers
        - asks again for the months picked, and refuses months it cannot read without asking
        - says so where no invoice was issued in the months
        - offers cancelling where an invoice stands and the platform serves it, and nowhere else
    - an invoice cancelled from the register
        - reads its subscriber’s record for the dialog, is confirmed behind the second factor, and
          the register read again
- `packages/ui-vue/tests/invoice-register-resource.test.js`
    - the register’s requests
        - every operation the descriptor declares is pinned here
        - a page of ${JSON.stringify(request)} asks ${url}
        - the totals of ${JSON.stringify(months)} ask ${url}, never after an invoice
- `packages/ui-vue/tests/use-invoice-register.test.js`
    - useInvoiceRegister
        - reads the platform’s current month at once, page and totals, and shows the months it
          answered
        - showing the months it answered is no change of what is asked, and reads nothing again
        - months picked are read anew, page and totals, from the first page
        - ${why} is said in the platform’s words before anything is asked
        - ${JSON.stringify(typed)} is no month, and nothing is asked for it
        - back from refused months to the ones read before, reads them again
        - the next page is added after the last invoice read
        - a page whose months were left while it was on its way is dropped
        - months typed while the first answer is on its way are not overwritten by it
        - the months a stale answer named are read when they are picked, not taken as shown
        - a failure of the totals is the register’s failure, and a reload clears it
    - useCancellationParty
        - reads nothing until an invoice names a subscriber, then that subscriber’s record
    - invoiceStandingOf
        - ${why} reads ${JSON.stringify(standing)}

<!-- END proof -->

### SC-ADM-043 — An operator exports the invoice register for a tax advisor

🟡 _(Decided, not yet delivered.)_ 💰 The export of the register (`SC-ADM-042`) is machine-readable:
each line with its tax treatment and rate (`SC-PRIC-038`), the payments and reversals against each
invoice, the cancellation and replacement each names, and each document's checksum (`SC-AUD-019`).
Every export names the moment it is as of, and every payment, reversal, cancellation and replacement
in it carries the moment it was recorded. The same period as of the same moment gives the same rows
every time it is taken, so a hand-over to a tax advisor can be repeated and compared; as of a later
moment, the export shows what was recorded since, such as a payment confirmed or an invoice
cancelled after a period ended, rather than silently changing a row.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md` · #335
