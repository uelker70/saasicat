---
title: Working in the interface
---

The administration is an application SaaSiCat hands over; the tenant-facing pieces are guests in
somebody else's. This chapter says what a person can expect from either: that screens behave
alike, that failures appear where they were caused, and that nothing irreversible happens without
saying what it will do.

### SC-UI-001 — Every standard screen is built the same way

🟢 The same blocks in the same order, so a screen an integrator adds stands next to the shipped ones
without looking like a guest, and a person who has learned one screen has learned the rest.

_Source:_ ADR 0008 · `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/admin-page-shell.test.ts`
    - AdminHero
        - renders the title as the page heading
        - omits the subtitle and the actions bar when neither is supplied
        - renders a markup subtitle through the slot
    - AdminSection
        - names the section by pointing aria-labelledby at its own heading
        - gives sibling sections distinct heading ids
        - renders no heading level above h2
    - page shell contract
        - the source sweep actually finds the pages it claims to check
        - AdminPage renders no &lt;main&gt; — the landmark belongs to AdminLayout
        - no content page renders its own &lt;main&gt; or a QPage
        - no content page hand-writes the hero markup instead of using AdminHero
        - AdminHero renders the only &lt;h1&gt; in the package
        - no view renders its hero inside the page body
        - no view hand-writes the reload button instead of using AdminRefreshBtn
        - no view writes its own table instead of using AdminTable
        - a component whose only job is to emit is never used without a listener
        - the actions column is filled through row-actions, not body-cell-actions
        - no page declares its own statistic tile styling
        - an unscoped page style reaches only its own sub-components
        - no page block titles itself with a heading-shaped &lt;div&gt;
        - no view writes its own disclosure instead of using AdminAccordion
    - the boundaries a page keeps
        - the sweep reaches the pages it claims to check
        - no page reaches for Quasar directly
        - no page redeclares the frame the theme draws
        - a page imports only from the layers below it
        - no primitive hard-codes a user-visible string
        - no file grows past the budget for its layer
- `packages/ui-vue/tests/pages-take-no-callbacks.test.js`
    - a page takes no callbacks
        - the guard reads every page in `src/pages/`
        - no prop in `src/pages/` is callable, and none exceeds the cap
        - the one exception says why, in its own source
    - the guard fails on what it forbids
        - an inline callback prop
        - a callback hidden behind a type alias — what a pattern cannot see
        - a sixth prop
        - an exception tag with no real reason
        - a declared exception passes
- `tests/baselines-record-a-page-at-rest.test.js`
    - recorded baselines
        - none of them recorded a node that was leaving

<!-- END proof -->

### SC-UI-002 — Mounting a shipped screen costs no wiring

🟢 An application that needs one operation to behave differently replaces that one operation and
keeps the other nine. Before this, mounting one screen cost between 8 and 145 lines of glue with
no rule saying which.

_Source:_ ADR 0008

<!-- BEGIN proof -->

_Tested by:_

- `packages/create-saasicat-admin/tests/scaffold.test.js`
    - parseArgs
        - positionals + flags + tokens are separated
    - applyTokens
        - replaces only tokens, passes other **X** strings through
    - walkTemplates
        - finds all .tpl files under templates/
    - scaffold
        - writes all templates into target + replaces tokens
        - dryRun writes nothing
    - bin entry point
        - runs through a bin symlink, as npm create / npx invoke it
- `packages/ui-vue/tests/boot-loader.test.js`
    - BootLoader.load
        - returns body on 200
        - sends GET to the configured endpoint
        - configurable endpoint
        - throws BootLoadError on non-200
        - endpoint is required: without an endpoint BootLoader throws
- `packages/ui-vue/tests/component/bootstrap-installs-what-it-provides.test.ts`
    - resolveQuasarOptions
        - with no app options, the platform set is installed
        - an app configuring Quasar still gets every plugin the ports need
        - the app’s own config is kept
        - an app may replace a plugin with its own build
        - an app that passes only a config keeps the whole platform set
    - the resource registry is installed only with a real client
        - an app that names its client gets a registry
        - an app that does not gets none, rather than one wired to a bare fetch
- `packages/ui-vue/tests/component/promo-code-detail-follows-the-route.test.ts`
    - PromoCodeDetailPage follows the route param
        - navigating from one code to another loads the second
- `packages/ui-vue/tests/component/route-mounted-pages.test.ts`
    - pages mounted by createAdminRoutes()
        - ${name} declares no required props
        - ${name} mounts with no props and without Vue warnings
        - the roster covers every page create-admin-routes mounts directly
    - AdminManifestErrorPage retry
        - boots into a guarded route rather than reloading the public error route
        - discards the cached manifest before booting, not after
    - AdminManifestErrorPage without callbacks
        - its buttons are wired to handlers, never to a possibly-undefined prop
- `packages/ui-vue/tests/component/tenant-detail-follows-the-route.test.ts`
    - TenantDetailPage follows the route param
        - navigating from one slug to another loads the second
- `packages/ui-vue/tests/component/the-plan-page-steps-aside-for-its-steps.test.ts`
    - the route table marks the plan steps as steps
        - the plans route has the two steps as children
        - every nested standard route carries the step marker
        - a claimed plans route keeps the steps beneath it
        - an own children list on a claimed route wins outright
        - a top-level standard route is not marked
    - the condition the page reads answers per route
        - the paths resolve at all
        - on the plans route itself the page owns the hero
        - on the editor step the page stands aside
        - on the review step the page stands aside
        - and on a sibling page it owns the hero again
- `packages/ui-vue/tests/integration.test.js`
    - Full bootstrap flow: Boot → Manifest → Routes → Actions
        - Consumer login bootstrap sequence
        - Cache-hit path: second manifest load returns 304
        - Logout path: clearCache clears everything
        - Manifest reload after a `manifest reload` action invalidates the cache
    - Drift detection: manifest vs. consumer shell build
        - Action drift detected: manifest action without a handler
        - UI rejects routes with a missing capability
    - Bulk publish: end-to-end with server path
        - Publish 3 drafts: 2 OK, 1 conflict — atomic progress
- `packages/ui-vue/tests/pages-barrel-is-complete.test.js`
    - the pages barrel and the pages directory agree
        - there are pages to compare
        - every page on disk is in the barrel
        - every entry in the barrel is a page on disk
        - each name matches the file it loads
    - the standard routes point at pages that exist
        - there are routes to check
        - each names a page the barrel maps
        - no two routes answer the same path
        - the error page is not among them
- `packages/ui-vue/tests/pages-read-the-params-their-routes-declare.test.js`
    - a page reads the route parameter its route declares
        - the table was read at all
        - every parameterised route is answered by a page that reads it
    - the reader sees what it has to see
        - a mismatched read is reported
        - a read written across lines counts
        - a bracketed read counts
        - the path parser finds the parameter
- `packages/ui-vue/tests/plan-step-routes-exist.test.js`
    - every step of the plan wizard navigates to a registered route
        - the plan pages and their routes are found
        - ${page} pushes only to standard routes
- `packages/ui-vue/tests/platform-loaders.test.js`
    - createPlatformLoaders
        - returns BootLoader + ManifestLoader instances
        - derives default endpoints from apiBase
        - honors explicit endpoint overrides
        - passes storageKeyPrefix and the client through to ManifestLoader
- `packages/ui-vue/tests/the-fixture-installs-what-the-bootstrap-does.test.js`
    - the visual fixture installs what createSuperAdminApp installs
        - both files were actually read
        - no seam the bootstrap installs is missing from the fixture
    - the reader sees what a pattern would miss
        - a provide spread over several lines is found
        - a missing key is reported rather than passed over

<!-- END proof -->

### SC-UI-003 — Replacing one operation that does not exist is refused at start-up

🟢 With the list of the ones that do. A typo in an override is otherwise a call that quietly keeps
the old behaviour until somebody notices an approval was never recorded.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

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
- `packages/ui-vue/tests/catalog-composables.test.js`
    - usePlans
        - the endpoint is required
        - load() filters by project key and sends the auth header
        - load() without a token sends none rather than an empty one
        - a failed load lands on `error` and leaves the list alone
        - an unparseable error body is still an error, with no body
        - create() appends the created row
        - update() replaces exactly the row it changed
        - softDelete() and hardDelete() drop the row and hit different paths
        - a mutation the server answered without a body does not touch the list
        - loadTenantCounts() fills the map, and swallows its own failure
        - autoLoad fetches without being asked
    - usePlanVersions
        - the endpoint and the plan id are both required
        - load() reads the versions of that plan
        - a failed load says PlanVersions, not Plans
        - createDraft() appends the new version out of the mutation result
        - updateDraft() and publish() replace the version they addressed
        - discardDraft() removes it and terminateVersion() replaces it
        - every mutation that needs a body rejects when none arrives
        - autoLoad fetches without being asked
    - useBundles
        - the endpoint is required
        - load(), create(), update() and softDelete() keep the list in step
        - a failed load lands on `error`
        - autoLoad fetches without being asked
    - useBundleVersions
        - the endpoint and the bundle id are both required
        - createDraft() appends and updateDraft() replaces
        - publish() reloads, because it can supersede another version
        - discardDraft() removes the version from the list
        - a failed load says BundleVersions
        - autoLoad fetches without being asked
    - useCatalogEntries
        - the endpoint is required
        - load() reads capabilities, features and quotas in one go
        - one failing request fails the load, and the lists stay empty
        - reviewFeature() and reviewQuota() replace the entry they reviewed
        - the i18n and base editors address their own paths
        - every editor rejects when the answer carries no entry
        - syncDiscovery() posts the snapshot and reloads the three lists
        - autoLoad fetches without being asked
    - usePromotions
        - the endpoint is required
        - load(), create(), update() and remove() keep the list in step
        - a failed load lands on `error`
        - autoLoad fetches without being asked
    - useMarketingProjections
        - the endpoint is required
        - the query string carries only the filter parts that are set
        - setFilter() replaces the filter and reloads with it
        - create() reloads, because a new tuple can fall inside the filter
        - update() patches the row in place, remove() drops it
        - a mutation without a body rejects, and create() does not reload after it
        - a failed load lands on `error`
        - autoLoad fetches without being asked
- `packages/ui-vue/tests/composables.test.js`
    - usePublicBoot
        - initial state: boot=null, loading=false
        - load() fills boot.value
        - load() sets error on HTTP failure
        - loading state toggles correctly
    - useManifest
        - initial state: manifest=null
        - load() fills manifest
        - reload() discards cache + loads fresh
        - clearCache() sets manifest to null
- `packages/ui-vue/tests/resources-match-the-composables.test.js`
    - the list descriptors match the list composables
        - ${resource.name}: ${testCase.name}
        - the list operation these cases drive is the one they name
    - plansResource matches usePlans
        - ${testCase.name} sends the same request
    - planVersionsResource matches usePlanVersions
        - ${testCase.name} sends the same request
    - the comparison itself
        - covers every operation both sides declare
        - terminate matches too, under the composable’s own name
        - the one header the two sides do not agree on
    - family.name
        - ${testCase.op} sends the same request
    - the comparison covers the whole roster
        - ${key}: every operation is driven by a case
- `packages/ui-vue/tests/resources-optional-arguments.test.js`
    - a list with no filter asks for no filter
        - promoCodes.list() sends a bare path
        - users.list() sends a bare path
        - marketing.listProjections() sends a bare path when nothing narrows it
        - tenants.list() asks for the first page at the default size
    - a publish with nothing overridden
        - planVersions.publish sends an empty object, not an absent body
        - bundleVersions.publish does the same
    - a discovery read with no tag to revalidate against
        - read() sends no If-None-Match
        - read(null) is the same request — that is how a forced reload is spelled
        - read(etag) revalidates
        - an unchanged snapshot is not re-read
        - a loaded snapshot carries the tag the next read revalidates with
        - a status that is neither 200 nor 304 fails rather than reading a body
        - a rescan that does not answer 200 or 201 fails the same way
    - an empty list answer is a list, not a null
        - ${def.key}.${op} answers []

<!-- END proof -->

### SC-UI-004 — Nothing is written until the person saves or publishes

🟢 Editors keep unsaved work across the steps of a wizard, and a step only moves on when the save
actually succeeded — a rejected save used to look exactly like a successful one.

_Source:_ release 1.0.0-rc.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/bundles-page-owns-what-it-saves.test.ts`
    - BundlesPage loads the live plan versions the overlap check reads
        - each plan maps to its live version
    - BundlesPage writes back what a mutation returns
        - an edited label shows in the row the page owns
        - a saved version reaches the aggregate map the KPIs read
- `packages/ui-vue/tests/component/clearable-fields.test.ts`
    - clearable fields
        - the sweep finds the fields it claims to check
        - no clearable model has a string method called on it unguarded
- `packages/ui-vue/tests/component/discovery-page-keeps-the-first-edit.test.ts`
    - DiscoveryPage carries a saved translation into the next save
        - the second payload still holds the first edit
- `packages/ui-vue/tests/component/grouped-options-keep-their-defaults.test.ts`
    - a page configured with nothing still shows what it used to
        - TenantsPage renders the plan column
        - PromoCodesPage offers the four statuses in its filter
- `packages/ui-vue/tests/component/plan-wizard-keeps-its-draft.test.ts`
    - the wizard carries its unsaved draft across the two routes
        - the editor writes what was typed into the wizard, not into the page
        - the review renders the unsaved values, not the published version
        - the draft outlives the navigation between the two steps
        - cancelling clears the draft rather than leaving it for the next plan
    - a step leaves the wizard only when the write happened
        - a refused save keeps the draft and stays on the step
        - a save that succeeds clears the draft
        - publish carries the form and the checklist flags
        - a publish that does not go through keeps the draft
- `packages/ui-vue/tests/kv-store.test.js`
    - defaultKvStore
        - without localStorage it is a no-op store
        - a throwing localStorage getter does not escape
        - reads and writes go through when localStorage works
        - a failing write is swallowed — quota or private mode
        - a failing read yields null rather than throwing
- `packages/ui-vue/tests/use-plan-editor.test.js`
    - usePlanEditor — Discovery (availableFeatures)
        - lists all catalog features with correct marker flags
        - featuresByTier groups + sorts by tier order
        - features without tier land in OTHER group at the end
        - manifest without features block: empty but no crash
    - usePlanEditor — toggleFeature
        - toggle add + remove
        - toggle on plannedOnly feature is ignored (no state change)
        - nonRegressive: inherited feature cannot be removed
        - nonRegressive=false: inherited feature may be removed
    - usePlanEditor — validateDraft + snapshot
        - snapshot returns sorted selection
        - validateDraft accepts a clean selection
        - validateDraft throws PlannedOnlyFeatureError when (e.g. via direct set) a plannedOnly key
          is present
- `packages/ui-vue/tests/use-steps.test.js`
    - a linear wizard knows where it is
        - it starts on the first step
        - every step is done, current or upcoming
        - back on the first step is refused rather than wrapping around
        - next on the last step is refused
        - reset takes it back to the start
    - a guarded step refuses to advance
        - the guard stops the move and says so
        - a click on a next button the guard refuses moves nothing
        - the same predicate answers the button and the move
    - focus follows the step
        - advancing puts focus on the new heading
        - going back puts focus on the heading too
        - a refused move does not move focus
        - the heading is focusable without joining the tab order
    - a wizard with no steps is a mistake, not an empty wizard
        - it refuses to be built
- `packages/ui-vue/tests/use-subscription-draft.test.js`
    - useSubscriptionDraft — plan selection
        - selectedPlan is null before selection
        - setPlan removes bundles incompatible with the new plan
        - setPlan keeps universally compatible bundles
    - useSubscriptionDraft — cycle toggle
        - Monthly uses monthlyNet, Yearly uses yearlyNet
        - yearSavings = 12*monthly − yearly
        - yearlyNet=null falls back to monthly × DEFAULT_YEARLY_FACTOR
    - useSubscriptionDraft — Bundles
        - Bundle toggle marks bundle + activates its features
        - Bundle deselect removes activated features again
        - Bundle price flows into subtotalNet
    - useSubscriptionDraft — Promo-Discount
        - PERCENT promo is applied to subtotalNet
        - ABSOLUTE promo is capped at subtotal
        - clearPromo removes discount + sets status idle
        - setPromoCode clears a previous valid status
    - useSubscriptionDraft — toApiPayload
        - serializes plan + cycle + bundle version IDs
        - without bundle selection bundleVersionIds is missing from the payload
        - serializes promoCode only when status is valid
        - throws when plan is not set
    - useSubscriptionDraft — redundant (covered) bundles
        - covered bundle does not flow into bundlesNet nor into the breakdown
        - covered bundle is missing from toApiPayload().bundleVersionIds
        - deselecting the covering bundle charges the other one again
        - mutual coverage Y={C},Z={C} → exactly ONE bundle charged + sent
    - useSubscriptionDraft — isDirty
        - false with fresh state
        - true as soon as a bundle is added

<!-- END proof -->

### SC-UI-005 — A failure appears where the person was looking

🟢 A page that could not load says so under its title; an action that failed inside an open dialog
says so in the dialog; only a failure with nothing on screen to attach to becomes a notification.
Never a notification for a failed load, and never one for something already visible.

_Source:_ `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/admin-error.test.js`
    - AdminError
        - defaults to status 0 — a request that never produced one
        - the diagnostic message names the request, the status and the code
        - the diagnostic carries the detail when there is one
        - an explicit message overrides the derived one
        - cause is preserved
    - isAdminError
        - recognises an instance
        - rejects a plain error, a look-alike object, and nothing at all
    - isEmptyResponse
        - recognises what a throw site marked, and nothing else
        - the marker is not enumerable, so it does not leak into a log line
    - isTransportFailure
        - recognises what a client marked, and nothing else
        - marking a non-object is a no-op rather than a second failure
        - the marker is not enumerable, so it does not leak into a log line
    - toAdminError
        - passes an AdminError through untouched
        - reads an axios rejection: status, code, body, url and method
        - a status-bearing error with an unreadable body has no detail at all
        - joins a NestJS ValidationPipe message array instead of stringifying it
        - reads one of the package’s own API errors, which carry status and body
        - an answer that was empty is not a connection problem
        - a consumer client rejecting with status 0 is not an empty response
        - a manifest 304 that survives to be thrown is a diagnostic like any other
        - a real HTTP failure is not an empty response
        - a declared transport failure keeps its diagnostic off detail, so the catalog answers
        - an axios failure with no response is transport too
        - but an interceptor’s own error is not, however much of axios it carries
        - but an error from app code keeps its message — that IS what was said
        - wraps a thrown string
        - survives a thrown nothing
    - a transport failure is declared by the client, not read off the class
        - a null dereference is not a connection problem
        - a real fetch failure still says "check your connection"
        - a malformed URL is a transport failure too, not an unknown one
        - the client passes a response through untouched
    - toAdminError and consumer errors
        - a consumer error carrying a status keeps its message
        - a consumer error merely NAMED like ours is still a consumer error
    - emptyResponse is read off the throw site, not off the class
        - a mutation the server answered without a body is an empty response
        - a boot GET a client resolved as status 0 never reached the server
        - a manifest GET a client resolved as status 0 never reached the server
        - nor did a mutation a client resolved as status 0 — on any of the surfaces
        - a discovery load a client resolved as status 0 never reached the server
    - toAdminError and rejections that are not Errors
        - a plain object keeps the message it carries
        - an Error from another realm is such an object
        - an object with nothing readable falls through to the generic wording
        - a non-string message is not a message
    - adminErrorMessage
        - what the failing side said outranks anything the platform could guess
        - maps the statuses that have their own wording
        - any other status falls through to the generic template, with the number in it
        - a failure nothing knows anything about says so, rather than blaming the network
        - a seam that declares the request never went out gets the network wording
        - converts before formatting, so an axios rejection needs no pre-processing
        - German is a complete alternative, not a fallback to English
    - HttpJsonError is AdminError
        - the two names are one class, so an existing instanceof check keeps working
    - getJson / postJson raise AdminError
        - a non-2xx carries status, code, detail, url and method
        - postJson reports its own method
        - an error body that is not JSON does not become a second failure
        - a validation rejection keeps its constraints — the array is joined here too
        - a 2xx still returns the parsed body
    - httpStatusOf reads the status whichever shape carries it
        - an AdminError carries it at `status`
        - an axios rejection carries it at `response.status`
        - anything else has none
- `packages/ui-vue/tests/component/error-state-outranks-the-accent.test.ts`
    - the accent label yields to the error state
        - the stylesheet the theme has to outrank really parsed
        - a focused valid field still gets the accent label
        - a focused invalid field keeps its negative label
        - an invalid field that was never focused keeps it too
        - a list item has no error state for the sibling rule to trample

<!-- END proof -->

### SC-UI-006 — What a person is shown after a failure is what the failing side said

🟢 Not the diagnostic that helps a developer find it. The two are kept apart deliberately, so a
stack-shaped message never reaches a screen.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/admin-error.test.js`
    - AdminError
        - defaults to status 0 — a request that never produced one
        - the diagnostic message names the request, the status and the code
        - the diagnostic carries the detail when there is one
        - an explicit message overrides the derived one
        - cause is preserved
    - isAdminError
        - recognises an instance
        - rejects a plain error, a look-alike object, and nothing at all
    - isEmptyResponse
        - recognises what a throw site marked, and nothing else
        - the marker is not enumerable, so it does not leak into a log line
    - isTransportFailure
        - recognises what a client marked, and nothing else
        - marking a non-object is a no-op rather than a second failure
        - the marker is not enumerable, so it does not leak into a log line
    - toAdminError
        - passes an AdminError through untouched
        - reads an axios rejection: status, code, body, url and method
        - a status-bearing error with an unreadable body has no detail at all
        - joins a NestJS ValidationPipe message array instead of stringifying it
        - reads one of the package’s own API errors, which carry status and body
        - an answer that was empty is not a connection problem
        - a consumer client rejecting with status 0 is not an empty response
        - a manifest 304 that survives to be thrown is a diagnostic like any other
        - a real HTTP failure is not an empty response
        - a declared transport failure keeps its diagnostic off detail, so the catalog answers
        - an axios failure with no response is transport too
        - but an interceptor’s own error is not, however much of axios it carries
        - but an error from app code keeps its message — that IS what was said
        - wraps a thrown string
        - survives a thrown nothing
    - a transport failure is declared by the client, not read off the class
        - a null dereference is not a connection problem
        - a real fetch failure still says "check your connection"
        - a malformed URL is a transport failure too, not an unknown one
        - the client passes a response through untouched
    - toAdminError and consumer errors
        - a consumer error carrying a status keeps its message
        - a consumer error merely NAMED like ours is still a consumer error
    - emptyResponse is read off the throw site, not off the class
        - a mutation the server answered without a body is an empty response
        - a boot GET a client resolved as status 0 never reached the server
        - a manifest GET a client resolved as status 0 never reached the server
        - nor did a mutation a client resolved as status 0 — on any of the surfaces
        - a discovery load a client resolved as status 0 never reached the server
    - toAdminError and rejections that are not Errors
        - a plain object keeps the message it carries
        - an Error from another realm is such an object
        - an object with nothing readable falls through to the generic wording
        - a non-string message is not a message
    - adminErrorMessage
        - what the failing side said outranks anything the platform could guess
        - maps the statuses that have their own wording
        - any other status falls through to the generic template, with the number in it
        - a failure nothing knows anything about says so, rather than blaming the network
        - a seam that declares the request never went out gets the network wording
        - converts before formatting, so an axios rejection needs no pre-processing
        - German is a complete alternative, not a fallback to English
    - HttpJsonError is AdminError
        - the two names are one class, so an existing instanceof check keeps working
    - getJson / postJson raise AdminError
        - a non-2xx carries status, code, detail, url and method
        - postJson reports its own method
        - an error body that is not JSON does not become a second failure
        - a validation rejection keeps its constraints — the array is joined here too
        - a 2xx still returns the parsed body
    - httpStatusOf reads the status whichever shape carries it
        - an AdminError carries it at `status`
        - an axios rejection carries it at `response.status`
        - anything else has none

<!-- END proof -->

### SC-UI-007 — Loading, empty and error are handled deliberately on every screen

🟢 Through the same shared elements rather than a variant per page.

_Source:_ `docs/explanation/design-guide.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/list-resource.test.js`
    - isSentInQuery — which values reach the server
        - the three spellings of "not filtered" are left out
        - the falsy values that are answers are not
    - listUrl
        - always states its page, first and in order
        - appends to an endpoint that already carries a query
        - serialises the filter after the pagination, in insertion order
        - omits the empty values and keeps the falsy ones
        - encodes with URLSearchParams — a space is a plus, not %20
    - filterQueryString — the endpoints that do not page
        - is empty when nothing survives the rule
        - leads with a question mark when something does
    - readListPage — both shapes real controllers answer with
        - a bare array reports the rows it sent
        - an envelope is read field by field
        - what the answer did not state stays absent
        - a body that is neither is an empty page, not a crash
        - an `items` that is not an array is not passed off as rows
    - the page bounds the admin API serves
        - a page below the first is the first
        - a fractional page is the one it is on
        - a page size stays inside 1..max
- `packages/ui-vue/tests/use-async-action.test.js`
    - useAsyncAction — the happy path
        - resolves what the action returned
        - passes every argument through
        - pending is true while in flight and false afterwards
        - runs onSuccess with the result, before run resolves
        - stays silent on success by default
        - notifyOn "both" raises the success message
        - a success message may be computed at call time
    - useAsyncAction — failure
        - reports the failure in the result instead of throwing
        - a void action is still distinguishable — the whole reason for the shape
        - records the failure as an AdminError
        - clears pending even when the action throws
        - skips onSuccess
        - reports through the notify port, worded from the default catalog
        - what the server said outranks the catalog
        - errorMessage outranks both, and sees the AdminError
        - notifyOn "none" records the error without announcing it
        - without a notify port the failure is still recorded
    - useAsyncAction — overlapping invocations
        - pending stays true until the last one settles
    - useAsyncAction — a stale failure does not outlive a newer success
        - the older call failing last leaves no error behind
        - but a failure from the newest call is still recorded
    - useAsyncAction — a report cannot change what happened
        - a success toast that throws leaves the action successful
        - a successMessage that throws does the same
        - an error toast that throws still returns the action failure
    - useAsyncAction — the success continuation
        - a failing continuation fails the action, and says so only once
        - a continuation that succeeds still gets its success toast
    - useAsyncAction — the error ref over time
        - a later success clears an earlier failure
        - reset clears it without running anything
- `packages/ui-vue/tests/use-async-data.test.js`
    - useAsyncData — loading
        - starts at the initial value
        - loads on creation by default
        - immediate: false loads nothing until asked
        - does not block setup — nothing has loaded synchronously
        - pending is true while in flight
    - useAsyncData — failure
        - records the failure as an AdminError
        - puts the data back to initial rather than leaving stale rows
        - reload does not throw
        - clears pending even when the load throws
        - a later success clears the error
    - useAsyncData — overlapping loads
        - a superseded load does not overwrite the newer one
        - a superseded load does not clear pending while the newer one runs
        - a superseded load that FAILS does not wipe the page or raise its error
    - useAsyncData — watch
        - reloads when a watched source changes
        - a watched source combines with immediate: false — the first load is the change

<!-- END proof -->

### SC-UI-008 — Equivalent actions behave the same everywhere

🟢 Delete, save, cancel, edit, back, filter, search, pagination, confirmation and validation errors
work the same way on every screen unless there is a stated reason not to.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/action-registry.test.js`
    - ActionRegistry.get + dispatch
        - returns {def, handler} for a registered key
        - dispatch calls handler with input
    - ActionRegistry.get — error paths
        - ActionDefNotInManifestError for an unknown key
        - MissingHandlerError for a declared key without a handler
    - ActionRegistry.register — late binding
        - accepts handler registration for a declared key
        - rejects registration for non-declared keys
    - ActionRegistry — drift detection
        - listOrphanedDefs: manifest-declared actions without a handler
        - listOrphanedHandlers: registered handlers without a manifest def
- `packages/ui-vue/tests/pages-take-no-callbacks.test.js`
    - a page takes no callbacks
        - the guard reads every page in `src/pages/`
        - no prop in `src/pages/` is callable, and none exceeds the cap
        - the one exception says why, in its own source
    - the guard fails on what it forbids
        - an inline callback prop
        - a callback hidden behind a type alias — what a pattern cannot see
        - a sixth prop
        - an exception tag with no real reason
        - a declared exception passes
- `packages/ui-vue/tests/use-tenant-action-flow.test.js`
    - useTenantActionFlow — empty actions
        - actionsForRow returns [] when manifest is null
        - actionsForRow returns [] when tenants.actions is empty
    - useTenantActionFlow — flow order
        - Confirm → MFA → Handler in correct order
        - Confirm abort prevents MFA + Handler
        - MFA abort prevents Handler
    - useTenantActionFlow — capability and handler filter
        - hides action when requiredCapability is false in the manifest
        - hides action when no handler is registered in the actions map
        - visibleForRow filters row-specifically by capability+handler
        - availableActions is row-independent — Reactivate stays visible despite a sample row with
          isActive=true
        - availableActions statically filters disabled capabilities + orphan handlers
    - useTenantActionFlow — provider drift
        - throws when an action requires MFA but no mfa provider is set
        - throws when an action requires confirm but no confirm provider is set
        - orphanedDefs lists manifest actions without a handler

<!-- END proof -->

### SC-UI-009 — A destructive action says what it will destroy, by name

🟢 Not "Are you sure?" but "Delete API key 'Production Integration'? This action cannot be undone."

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/ui-confirm-port.test.ts`
    - quasarConfirmOptions
        - carries the wording the page wrote, not a generic "are you sure"
        - a destructive action is coloured as one
        - tone defaults to primary — only the caller may call something destructive
        - both buttons are labelled, so neither reads "OK"
        - no prompt means no input — a plain confirm stays plain
        - a prompt carries its initial value and type
        - a prompt with no initial value starts empty and takes text
    - useSuperAdminConfirm
        - an app-provided port is the one that gets asked
        - without one, the Quasar implementation is the fallback — which still asks
        - a context from an older package version still resolves, because the key is Symbol.for
- `packages/ui-vue/tests/use-bulk-publish.test.js`
    - useBulkPublish.setItems
        - sets items with default status pending
    - useBulkPublish.run — parallel publishes
        - all successful → success count = 3, done=true
        - single error → success=2, failure=1, done=true
        - empty changeNote → all items failed
        - mfaCode sets X-Mfa-Code header
        - auth token is sent along
    - useBulkPublish — endpoint mapping
        - endpoints are called per kind
        - override endpoints configurable
    - useBulkPublish — progress
        - progress=0 for empty set
        - progress=0 before run, =1 after run

<!-- END proof -->

### SC-UI-010 — An action sits with the object it acts on

🟢 "Publish this version" does not share a footer with "delete this bundle and every version of it".
One releases a draft; the other destroys the thing.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/action-registry.test.js`
    - ActionRegistry.get + dispatch
        - returns {def, handler} for a registered key
        - dispatch calls handler with input
    - ActionRegistry.get — error paths
        - ActionDefNotInManifestError for an unknown key
        - MissingHandlerError for a declared key without a handler
    - ActionRegistry.register — late binding
        - accepts handler registration for a declared key
        - rejects registration for non-declared keys
    - ActionRegistry — drift detection
        - listOrphanedDefs: manifest-declared actions without a handler
        - listOrphanedHandlers: registered handlers without a manifest def
- `packages/ui-vue/tests/component/bundle-actions-belong-to-their-object.test.ts`
    - the version keeps its actions together
        - save and publish share one bar
        - discard stays with the draft state that offers it
        - nothing spans both columns any more
    - the bundle keeps its own
        - soft-delete is not among the version actions
        - it sits in the card header, named for a reader who cannot see icons
        - it is not a button inside a button
        - deleting does not also expand the row it removes
    - deleting asks through the platform, not through the browser
        - the confirm port decides, and window.confirm is never called
    - two forms in one panel say which one is waiting
        - a pristine form offers nothing to save
        - an edit shows the marker and enables the button
- `packages/ui-vue/tests/component/one-dialog-per-page-not-per-row.test.ts`
    - the one-time-password dialog is one dialog
        - the fixture renders several rows — without that this proves nothing
        - one instance exists, however many rows there are

<!-- END proof -->

### SC-UI-011 — A list says how many rows there are, or says it is showing what it received

🟢 It does not present the number of rows in hand as a total it cannot know.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/batch-column-fetcher.test.js`
    - BatchColumnFetcher.fetchAll
        - 1 request per column with comma-separated tenantIds
        - paramStyle=repeat
        - Capability filter: insufficient columns are not fetched
        - empty tenantIds list → empty object, no request
        - the client's auth header reaches the request untouched
        - appends correctly to an endpoint with an existing query
    - BatchColumnFetcher — drift detection
        - per-Tenant placeholder in endpoint → BatchColumnDriftError
        - listDriftIssues collects all problematic columns
        - non-200 response throws an error naming column, endpoint and status
    - BatchColumnFetcher.eligibleColumns
        - returns only columns with a satisfied Capability
- `packages/ui-vue/tests/component/the-page-suite-finds-the-dashboard-distributions.test.ts`
    - the page suite finds the dashboard distributions where the page renders them
        - every distribution title answers the selector the suite ships
- `packages/ui-vue/tests/component/typed-lists-carry-their-row-type.test.ts`
    - useResourceList — the typed surface
        - hands a page its rows already typed, with no assertion at the call site
        - refuses the resources and operations that cannot answer with a page
- `packages/ui-vue/tests/list-resource.test.js`
    - isSentInQuery — which values reach the server
        - the three spellings of "not filtered" are left out
        - the falsy values that are answers are not
    - listUrl
        - always states its page, first and in order
        - appends to an endpoint that already carries a query
        - serialises the filter after the pagination, in insertion order
        - omits the empty values and keeps the falsy ones
        - encodes with URLSearchParams — a space is a plus, not %20
    - filterQueryString — the endpoints that do not page
        - is empty when nothing survives the rule
        - leads with a question mark when something does
    - readListPage — both shapes real controllers answer with
        - a bare array reports the rows it sent
        - an envelope is read field by field
        - what the answer did not state stays absent
        - a body that is neither is an empty page, not a crash
        - an `items` that is not an array is not passed off as rows
    - the page bounds the admin API serves
        - a page below the first is the first
        - a fractional page is the one it is on
        - a page size stays inside 1..max
- `packages/ui-vue/tests/use-api-list-shape.test.js`
    - useApiList response shape tolerance
        - Raw array `[{...}, {...}]` is consumed as items[]+total (array shape)
        - Wrapper object `{items, total, page, pageSize}` is supported the same way (wrapper shape)
        - Empty array → items=[], total=0
        - null/undefined body → items=[], no crash
- `packages/ui-vue/tests/use-api-list.test.js`
    - useApiList — autoLoad + reload
        - autoLoad triggers first request
        - autoLoad=false skips initial load
        - reload() makes an additional request
    - useApiList — Pagination
        - goToPage(N) → page param changes
        - setPageSize(N) → jumps to page 1
        - goToPage(0) → clamps to page 1
    - useApiList — Filter
        - filter values as query params, empty values omitted
        - endpoint with query string → correct separator
    - useApiList — Auth + Error
        - the client's auth header reaches the request untouched
        - non-200 → error.value set, items.value empty
- `packages/ui-vue/tests/use-resource-list.test.js`
    - useResourceList — the first load
        - asks the descriptor’s endpoint, which no caller had to supply
        - does not block setup — nothing has loaded synchronously
        - immediate: false loads nothing until asked
        - an opening page size is one request, not two
        - an opening page size past the cap is capped, not sent
    - useResourceList — the pagination it owns
        - goToPage moves the request and the ref
        - setPageSize returns to the first page
        - a page off the scale is clamped before it is sent
        - a changed filter reloads from the first page
        - a filter mutated in place is seen too
    - useResourceList — what the rows and the count say
        - a reported total is the total
        - an unreported total falls back to the rows in hand
        - a bare array — what the tenants controller actually answers — is rows and count
    - useResourceList — the state it delegates
        - a failure arrives as an AdminError carrying the status
        - a failure empties the table rather than leaving stale rows under it
        - a superseded load does not overwrite the newer one
    - useResourceList — the page the server actually served
        - a clamped page is adopted, so the next request asks for what is shown
        - an overdue answer moves neither the rows nor the paginator
        - an answer that says nothing about the page leaves the asked-for one
    - useResourceList — the failures it refuses to swallow
        - an operation the resource does not have fails by name, listing what there is
        - an operation named after an Object prototype key does not exist either
        - no registry in scope says so, in the registry’s own words
        - a filter that claims the pagination fails where it is written
        - a filter that gains one later fails on the next load, without a word for the operator
        - an empty or absent pagination key in the filter is not a claim

<!-- END proof -->

### SC-UI-012 — The interface works on desktop, tablet and phone

🟢 Every header control stays inside the viewport from the narrowest supported width. Where space
runs out, labels are dropped before controls are — nothing a person can press is removed. No
screen pushes the page sideways, except where horizontal scrolling is a deliberate part of a
component such as a wide table.

_Source:_ internal engineering guidelines · release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/roster-primitives.test.ts`
    - AdminBanner carries meaning without relying on colour
        - each tone brings its own icon, so the shape differs before the hue does
        - an explicit `icon: false` renders none — for a body that carries its own
        - the close button is only there when the caller asked for it
    - AdminErrorBanner is bound unconditionally and decides for itself
        - a null error renders nothing at all — no empty box above the body
        - a rejection becomes a sentence, not "[object Object]"
        - retry is offered only when there is something to retry
    - AdminFormDialog owns the submit lifecycle
        - a failed submit keeps the dialog open and shows the reason
        - a successful submit closes it and says so once
    - AdminConfirmDialog escalates the irreversible ones
        - typing the wrong name leaves the confirming button unusable
        - the typed answer does not survive a reopen
    - AdminRowActions
        - a hidden action is not rendered — a row shows what it is eligible for
        - a disabled action stays visible, so the row does not change shape
    - AdminField associates what it shows
        - the error is announced, and it replaces the hint rather than joining it
        - the slot is handed the id to point `aria-describedby` at
    - AdminToolbar
        - the end group is pushed away from the start one, not centred
        - with no end content there is no empty end group to space against
        - sticky is opt-in — a toolbar that follows the scroll is a decision
    - AdminFieldGrid
        - the column count reaches the DOM, because the layout is CSS
        - a field carries its span, so one wide input can sit in a narrow grid
    - AdminEmptyState
        - the title is the message; description and actions are optional
        - inline and block are different treatments, not the same one twice
    - AdminStatusPill
        - the tone is a class, so the theme decides what it looks like
        - the label is always there — colour never carries the status alone
- `packages/ui-vue/tests/flex-direction-override.test.js`
    - a rule that changes flex-direction states its own main-axis alignment
        - the sweep found the stylesheets
        - no rule flips flex-direction while inheriting justify-content
- `tests/px-to-scale.test.js`
    - pixels snap to the nearest rung
        - an exact value takes its own token
        - a midpoint rounds down
        - a value nearer one rung takes it, up or down
        - radii use their names, not their numbers
        - a negative keeps its sign in a calc
        - tracking is converted rather than snapped
    - what the codemod leaves alone
        - a property no scale answers for
        - a declaration that already reads a token
        - a token definition
        - every value in a shorthand moves together
        - a zero stays a zero
    - rewriting a file
        - touches declarations and nothing else

<!-- END proof -->

### SC-UI-013 — A tenant-facing section can be embedded without adopting a UI framework

🟢 The plan section, the upgrade wizard and the add-on store render inside the integrator's own
application. For a developer evaluating SaaSiCat, "you also need this UI framework" is not a line
item on the decision — it is the end of it. A component that is a guest in somebody else's product
does not bring a framework with it.

_Source:_ ADR 0010 · #206

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/no-hardcoded-app-prefix.test.js`
    - Platform package: no hardcoded app URL prefixes
        - No composable/loader has `/api/(v1/)?{admin,billing}/...` as a default
    - Platform package: useTenants explicitly requires an endpoint
        - useTenants() WITHOUT the endpoint option throws with a clear error message
- `packages/ui-vue/tests/project-page-host.test.js`
    - createProjectPageHostRoute
        - returns a catch-all route with the ProjectPageHost component
        - path pattern can be overridden
        - does not match the empty /admin path so the dashboard redirect applies
    - ProjectPageHost — platform contract
        - exports SUPER_ADMIN_EXTENSIONS_KEY and SUPER_ADMIN_MANIFEST_KEY
        - ProjectPageHost is a defineComponent-compatible component
    - useSuperAdminManifest
        - returns null when no accessor was provided
        - returns the manifest value via a provided accessor
- `packages/ui-vue/tests/use-tenant-billing-url.test.js`
    - useTenantBilling URL construction
        - default apiPrefix is /billing (no /api prefix → no doubling)
        - custom apiPrefix /api/v1/billing is used 1:1 as sub-path (no /api adapter)
        - trailing slash in apiPrefix is normalized (no //billing)
        - plan preview, bundles and cancel all go under the same prefix
    - useTenantBillingCatalog URL construction
        - default apiPrefix is /billing — catalog endpoints land under
          /billing/{plans,bundles,feature-registry}
    - the rhythm a bundle is booked in reaches the wire
        - an explicit cycle is sent by both the preview and the booking
        - omitting it sends no field at all, so the plan’s rhythm decides
        - a minimum term still travels, alone or beside a cycle
- `packages/ui-vue-tenant/tests/component/tenant-primitives.test.ts`
    - the tenant button is a button
        - it renders a native button that does not submit
        - an accessible name from the call site lands on the button itself
        - a click listener from the call site reaches the button
        - the two axes are independent
    - a running button says so and stays readable
        - loading disables the button and marks it busy
        - the ring is added beside the label, not instead of it
        - a disabled button is not a busy one
    - the card primitives are one element each
        - %s renders its slot inside one classed element
    - the spinner respects a reduced-motion preference
        - the default animation turns
        - a reduce block replaces the turn for the spinner
- `tests/the-tenant-package-needs-no-quasar.test.js`
    - the tenant package needs no Quasar
        - there is a source tree to judge
        - no dependency field names it
        - the keywords do not advertise it
        - nothing in the source imports it
        - no template writes a Quasar component
        - no template writes a class Quasar defines

<!-- END proof -->

### SC-UI-014 — The administration brings its own UI framework

🟢 It is the application SaaSiCat hands over and it owns its own page, so the integrator installs one
package and nothing else — no framework, no build plugin, no stylesheet compiler. The framework's
own global stylesheet stays an import the integrator writes, because bundling it would mean they
could no longer decline it.

_Source:_ ADR 0011 · #207

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/theme-layer-discipline.test.js`
    - the token layers only point one way
        - the sweep reached all four layers
        - the sweep reached the inline styles too
        - the audit's Quasar palette is Quasar's
        - the audit's idea of a Quasar component is Quasar's
        - L1 primitives reference nothing
        - L2 roles contain no colour literal
        - L3 component sheets contain no colour literal
        - L3 component sheets do not reach past the roles into the palette
        - every font-size names a step of the type scale
        - the package does not use its own deprecation shims
        - a foreground role is never used as a background
        - surfaces that do not follow the theme use only roles that do not flip
        - pages and components do not reach past the roles into the palette
        - no rule paints --sa-color-accent as text on an accent surface
- `tests/a-generated-admin-imports-every-stylesheet.test.js`
    - every entry point imports the stylesheets the package publishes
        - the export map still publishes stylesheets
        - ${label} imports all of them
        - ${label} loads the theme after Quasar's stylesheet
        - ${label} takes them from this package, not from Quasar
- `tests/quasar-colours-resolve-to-the-theme.test.js`
    - quasar colours resolve to the theme
        - the sources actually paint Quasar colours
        - no page paints a Quasar palette rung the theme cannot move
        - every painted colour is one the platform decides
        - the neutral greys do not grow
        - every linked tone is a role the theme declares
    - the guides name the role the bridge actually reads
        - the guides show some overrides
        - every role the bridge links is one a guide tells you to override

<!-- END proof -->

### SC-UI-015 — One colour makes the administration look like the integrator's product

🟢 The brand colour is a single value passed at start-up and it moves everything that follows from
it. Asking an integrator to restate the status colours as well is how those drifted: a scaffolded
warning colour once sat at 2.15:1 beside a platform role painting 4.8:1.

_Source:_ ADR 0011 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/brand-colour-reaches-both-namespaces.test.ts`
    - the brand colour replaces $primary
        - it lands on the document element, not the body
        - an app that names no colour leaves the variable alone
        - the colour is also handed to the components as part of the brand
    - disposing gives the document back
        - a shell that set a colour removes it again
        - a host value marked !important keeps its priority
        - our own writes claim no priority of their own
        - a value the host set itself is put back, not deleted
        - a shell that named no colour touches nothing on the way out
    - the theme declares the link the option relies on
        - the accent role reads Quasar’s variable
    - the status tones follow the roles instead of being restated
        - the shell writes no status colour of its own
        - the theme hands Quasar the filled role, in both schemes
- `packages/ui-vue/tests/design-token-budget.test.js`
    - design-token budgets
        - the audit reaches the source tree
        - the inline-style sweep reads a fixture it cannot miss
        - a CSS-wide keyword is not a typographic value
        - a palette prop counts on a Quasar component and nowhere else
        - ${metric} does not grow (floor ${floor} — ${why})
        - ${metric} baseline has not overshot its floor
- `packages/ui-vue/tests/identity-accents-match-theme.test.js`
    - the identity ramp is one ramp
        - the resolver reaches a hex at all
        - both halves are the same length
        - every stored value is what its role resolves to in the light theme
        - the neutral matches too
    - the exemption cannot become a dumping ground
        - every hex in the file is one of the ramp values
    - a stored colour fits what the API accepts
        - ${label} is concrete, not a token reference
        - ${label} fits the promotion column
- `packages/ui-vue/tests/login-branding.test.js`
    - resolveLoginBranding — boot values win, app branding fills in
        - a complete boot response is used as-is
        - production is not shown as an environment badge
    - resolveLoginBranding — malformed boot must not take the card down
        - ${name}: falls back instead of throwing
        - without boot and without app branding the card still renders
        - empty strings from boot do not blank the card
    - isProductionBoot — the dev-credentials guard
        - true only for an explicit production environment
        - a malformed payload is not treated as production
        - other environments are not production
- `packages/ui-vue/tests/scaffolder-brand-defaults.test.js`
    - the visual fixture brands itself like a scaffolded app
        - both declarations are found
        - they are the same colour
        - the fixture declares no palette of its own
- `tests/quasar-colours-resolve-to-the-theme.test.js`
    - quasar colours resolve to the theme
        - the sources actually paint Quasar colours
        - no page paints a Quasar palette rung the theme cannot move
        - every painted colour is one the platform decides
        - the neutral greys do not grow
        - every linked tone is a role the theme declares
    - the guides name the role the bridge actually reads
        - the guides show some overrides
        - every role the bridge links is one a guide tells you to override
- `tests/token-audit-template-scan.test.js`
    - a colour written as paint is found
        - a static style attribute
        - a bound style with a literal fallback
        - an SVG paint attribute
        - a functional notation with literal channels
        - a named colour is a literal too
        - a named colour BARE in an SVG paint attribute
        - a named colour as a string inside a bound paint attribute
        - the two halves do not report the same colour twice
        - `color` inside SVG is paint
        - the namespace, not the tag name — a bare &lt;g&gt; is not SVG
        - `color` on the SVG elements a tag list forgets
        - every CSS named colour, not the obvious eighteen
        - a longer keyword is not read as the shorter one inside it
        - several literals in one binding
        - a literal nested deep in the tree
        - a literal AFTER a nested &lt;template&gt;
    - everything else a # means in a template stays silent
        - a hex in template TEXT is content, not paint
        - a pull-request number in an HTML comment
        - a slot shorthand that happens to spell a colour
        - an input mask
        - an anchor href
        - a Quasar `color` prop names a palette entry, not a colour
        - a var() is the goal, not a finding
        - a functional notation with a var() channel is a token in use
        - a binding that carries data rather than a literal
        - the SVG keywords that are not colours
        - a paint-server reference is an address, not a colour
        - a CSS function name is case-insensitive
        - a comment in a style attribute is prose, not paint
        - a colour beside a comment is still found
        - a modern colour function is a literal too
        - a named colour in any property that paints
        - a colour WORD where the property names something
        - a custom property holding a literal is NOT excused
        - an asset URL that spells a colour is an address
        - a hyphenated identifier that begins with a colour name
        - a colour function written in capitals
        - a real colour beside a paint-server reference is still found
        - a word that merely contains a colour name is not one
        - a dynamic directive argument does not throw
    - the other blocks belong to the other categories
        - a &lt;style&gt; block is not a template finding
        - a &lt;script&gt; block is not a template finding
    - null and empty mean different things
        - a file that is not an SFC is null, not empty
        - an SFC with no template at all is null
        - an SFC the parser cannot read is null, not empty
        - a template that parses and holds nothing is empty, not null
    - the line is the line the literal is on
        - a literal on the third line of the template
        - a binding spread over several lines points at the literal
    - blanking a string an expression only compares
        - the text keeps its length, so every offset still points where it did
        - a comparison between two literals is left alone
    - what the comparison blanking deliberately does not do
        - a path it cannot cross is kept, because it cannot tell
        - but a name inside another string is not a use of it
    - counting a name in an expression
        - a name is bounded by the alphabet it is written in
        - a trailing ! ends the name, and only `!.` carries it onwards
        - and the literal survives, because the class is rendered
    - the font shorthand hides three scales behind one property
        - a size, a weight or a leading in it is a literal
        - a tokenized shorthand is not
        - a number in the family name is a name, not a size
    - an inline style is a stylesheet fragment
        - a static style attribute is a fragment
        - several attributes, in template order
        - a bound :style is NOT a fragment
        - an attribute that is not `style` is not a fragment
        - null and empty still mean different things
        - a bound style that is one string literal is inline CSS too
        - the line is the line the attribute value starts on
    - a Quasar palette class is a colour decision
        - a static class list
        - a bound class list holds its literals as strings
        - a brand or status name, not only a palette hue
        - a two-word hue is read whole
        - a string the list COMPARES is not a class it renders
        - a name compared twice is still only compared
        - an optionally chained name is one name, not its last segment
        - and a name carrying a dollar sign is still one name
        - but a literal the comparison can render is kept
        - and grouping around the operand does not save it
        - the branch a comparison SELECTS is still a class
        - a class that merely ends in a palette word is not one
        - a rule ABOUT the class is not a use of it
        - blanking a compared string does not move the line after it
        - null and empty still mean different things
    - a Quasar palette prop is the same colour decision
        - a static prop
        - the two halves a component paints
        - a brand or status name, not only a hue
        - a bound prop holds its literals as strings
        - a string the binding COMPARES is not a palette name it emits
        - a binding that names nothing is not a finding
        - a nested object is configuration, not props
        - every prop that ends in -color on a Quasar component is one
        - the object form of v-bind is read like the arg form
        - a value outside the palette is not a palette finding
        - a two-word hue is read whole, with its shade
        - a value that merely begins with a palette word is not one
        - an attribute that is not a colour prop is not read
        - `color` inside SVG belongs to the paint category
        - the class form belongs to the class category
        - a comment in a binding is prose, not a palette
        - null and empty still mean different things
        - the line is the line the value sits on
    - the vocabulary is data, the pattern is the shape
        - a prop in palette shape but not in the palette is not counted
        - a rejected quoted word does not swallow the accepted one after it
        - named colours are ASCII case-insensitive, as CSS keywords are

<!-- END proof -->

### SC-UI-016 — Light and dark are both shipped, and a person can pick

🟢 Or follow whatever their system says. Two installations sharing one address do not inherit each
other's pick.

_Source:_ #137 · ADR 0009

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/theme-bootstrap.test.ts`
    - the bootstrap and an already-chosen theme
        - Quasar's configured dark mode survives the bootstrap
        - an explicit scheme still outranks what Quasar was set to
        - Quasar's configured LIGHT mode survives a dark machine
        - the machine still decides when Quasar says 'auto'
        - Quasar's 'auto' stays 'system' rather than freezing
        - with no dark configuration at all, the theme is left on system
        - Quasar's own toggle is carried back into the theme
        - the two directions do not chase each other
        - a 'system' pick survives the bridge's own round trip
        - Quasar's 'auto' comes back as 'system', not as a frozen value
        - a hard pick that agrees with the machine is still a pick
        - 'system' still follows the machine once the bridge has written to Quasar
        - dispose() stops the bridge writing to the document
- `packages/ui-vue/tests/component/theme-switcher.test.ts`
    - ThemeSwitcher visibility
        - renders when the shell provides a theme
        - renders nothing when the app opted out
        - a context from an older package version still shows it
        - a catalog from an older package version renders instead of throwing
    - ThemeSwitcher contents
        - the button names the active scheme
        - 'system' is named as itself, not as what it resolves to
        - an unknown active scheme falls back to its value instead of blanking
        - the accessible label comes from the catalog
        - all three schemes become menu entries
    - ThemeSwitcher selection
        - picking an entry writes the shared scheme
        - picking 'system' stores 'system' rather than what it resolves to
        - only the active entry carries the check mark
- `packages/ui-vue/tests/identity-accents-match-theme.test.js`
    - the identity ramp is one ramp
        - the resolver reaches a hex at all
        - both halves are the same length
        - every stored value is what its role resolves to in the light theme
        - the neutral matches too
    - the exemption cannot become a dumping ground
        - every hex in the file is one of the ramp values
    - a stored colour fits what the API accepts
        - ${label} is concrete, not a token reference
        - ${label} fits the promotion column
- `packages/ui-vue/tests/theme-reaches-every-page.test.js`
    - the theme reaches every page it ships
        - the reach markers are derivable from the stylesheets
        - a marker that exists only inside a comment does not count
        - every standard page renders a node inside that reach
- `packages/ui-vue/tests/theme-token-parity.test.js`
    - light and dark declare the same roles
        - the files were actually read
        - every light role has a dark counterpart, and the reverse
        - the theme fires only on a signal the application sent
        - no role is declared twice within one theme
- `packages/ui-vue/tests/use-sa-theme.test.js`
    - createSaTheme
        - defaults to 'system'
        - an explicit scheme resolves to itself
        - without matchMedia, 'system' resolves to light
        - 'system' follows the operating system, and keeps following it
        - an explicit pick outranks the operating system
        - the picked scheme is written to storage
        - a stored pick outranks the app default
        - a corrupt stored value falls back to the app default
        - persist: false neither reads nor writes storage
        - an app-supplied Ref is used as-is and is not persisted
        - dispose() ends the operating-system subscription
        - dispose() is idempotent and stops persisting
        - a stored pick does not overrule an app-supplied Ref
    - the switcher the theme offers
        - the switcher is on by default
        - an app can turn it off
        - a readonly scheme turns it off on its own
        - it offers exactly the three schemes, in a stable order
    - the persisted key
        - two apps on one origin can keep their picks apart
        - a prefixed app reads back its own pick, not the unprefixed one
        - the key itself is unchanged
    - useSaTheme
        - outside a shell it returns a shared, unpersisted instance
        - the injection key is a global symbol
- `tests/a-role-that-is-read-is-defined.test.js`
    - a role that is read is a role the theme defines
        - both sides of the comparison were actually read
        - the definitions reach the scale, not only the colours
        - the reads reach the two files the defect shipped in
        - no role is read that the theme leaves undefined
        - the rule is not vacuous: an undefined role is reported, with its line
        - and a role the theme defines is not reported
        - a fallback answers for the role it stands in for
        - a nested read is a read of its own
        - a role named in a comment is not a read
        - a comment above a read does not move its line
        - the import graph is followed, not guessed

<!-- END proof -->

### SC-UI-017 — A confirmation shows the answer to the question actually being asked

🟢 While a new answer is on its way, the previous one is not left on screen to be confirmed. A reader
could otherwise tick "I understand this happens on 1 January" and get something else, and the
screen and the invoice would describe different events.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/ui-confirm-port.test.ts`
    - quasarConfirmOptions
        - carries the wording the page wrote, not a generic "are you sure"
        - a destructive action is coloured as one
        - tone defaults to primary — only the caller may call something destructive
        - both buttons are labelled, so neither reads "OK"
        - no prompt means no input — a plain confirm stays plain
        - a prompt carries its initial value and type
        - a prompt with no initial value starts empty and takes text
    - useSuperAdminConfirm
        - an app-provided port is the one that gets asked
        - without one, the Quasar implementation is the fallback — which still asks
        - a context from an older package version still resolves, because the key is Symbol.for
- `packages/ui-vue/tests/use-dialog.test.js`
    - the dialog is announced as one
        - the panel carries the modal role and is named by its heading
    - focus enters and comes back
        - opening moves focus into the panel
        - closing puts focus back where it was
        - a trigger that is gone by then leaves focus at the document body
        - unmounting while open still gives the focus back
    - the trap keeps tab inside the panel
        - tab from the last control wraps to the first
        - shift+tab from the first control wraps to the last
        - shift+tab from the panel itself wraps to the last control
        - a tab from outside the panel is pulled back in
        - a panel with nothing tabbable keeps the caret on itself
    - escape and the backdrop
        - escape asks the caller to close
        - a persistent dialog ignores escape
        - a click on the backdrop closes, a click in the panel does not
        - a persistent dialog ignores the backdrop too
        - a closed dialog no longer answers escape
    - the page behind does not scroll
        - the lock is taken while open and given back on close
        - an inner dialog closing does not give the page back to the outer one
    - the panel can be teleported somewhere other than body
        - the default is body
        - a host that names a container gets it
- `packages/ui-vue-tenant/tests/component/tenant-dialogs.test.ts`
    - the dialog shell names itself
        - the panel is a modal named by its own heading
        - a persistent dialog still renders a way out
        - a closed dialog renders nothing at all
        - the close control asks the caller to close
    - the bundle preview reaches the shell
        - its title and the bundle label both reach the head
        - the footer confirm carries the action, and blockers disable it
        - while it loads, the ring is decoration and the sentence carries the news

<!-- END proof -->

### SC-UI-018 — Where two answers are outstanding, the current question's answer wins

🟢 Not the one that happens to arrive last. A slower response is not necessarily the older one, and
prices resolved against a plan the tenant has since left are not stale — they are about a
different question.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/ui-confirm-port.test.ts`
    - quasarConfirmOptions
        - carries the wording the page wrote, not a generic "are you sure"
        - a destructive action is coloured as one
        - tone defaults to primary — only the caller may call something destructive
        - both buttons are labelled, so neither reads "OK"
        - no prompt means no input — a plain confirm stays plain
        - a prompt carries its initial value and type
        - a prompt with no initial value starts empty and takes text
    - useSuperAdminConfirm
        - an app-provided port is the one that gets asked
        - without one, the Quasar implementation is the fallback — which still asks
        - a context from an older package version still resolves, because the key is Symbol.for
- `packages/ui-vue-tenant/tests/component/a-preview-in-flight-blocks-the-confirmation.test.ts`
    - while a replacement preview is on the wire
        - the answer to the abandoned question is taken off the screen
        - and the confirmation cannot be given
    - when the answers come back out of order
        - the outdated one does not install itself
- `packages/ui-vue-tenant/tests/component/the-latest-question-wins.test.ts`
    - only the current question commits its answer
        - a slower earlier answer does not overwrite a faster later one
        - answers in order still commit only the last
        - a single question commits, so the guard does not swallow the normal case
        - a superseded call resolves rather than hanging

<!-- END proof -->

### SC-UI-019 — A row that opens is a control

🟢 Operable from the keyboard, announced as expandable, and controls inside its header do not toggle
it on the way past. The page decides which row is open, so opening one can close another and load
what it needs.

_Source:_ #133 · `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/admin-accordion.test.ts`
    - the trigger is a control, not a div that listens
        - it is a button, and one that does not submit
        - aria-expanded says which state it is in
        - aria-controls names the body that is actually there
        - the body names the trigger back
        - two instances on ONE page do not share their ids
        - a disabled row is inert and says so
    - the page owns the state
        - the body is absent while closed, not merely hidden
        - a click asks for the opposite, and changes nothing by itself
        - an open row asks to close
    - a control in the header is not part of the trigger
        - it renders outside the button
        - clicking it does not toggle the row
        - nothing is rendered for it when the slot is unused
    - the badge is the component, the glyph is the page
        - the page supplies a glyph and the component supplies the frame
        - a row whose state the badge should report says so
        - no badge is drawn for a row that has no glyph
        - the badge sits inside the trigger, unlike the actions
- `packages/ui-vue/tests/component/disclosures-open-what-they-say.test.ts`
    - a promotion row opens its editor
        - the row is a button that says whether it is open
        - clicking one row opens that row, and only that one
        - clicking the open row closes it again
        - the timeline bar that opens the same row is a control too
    - the advanced section of the promo-code form opens
        - the toggle is a button that says whether it is open
        - the backend-only fields appear once it is open
        - the toggle asks its owner rather than deciding
    - the promotions tab is a reactive form, not a snapshot
        - an edit in the open editor reaches the update handler
    - a marketing row opens its editor from anywhere but its fields
        - the plan cell is the keyboard path, and says what it controls
        - a click on a cell that holds no control opens the row
        - a click on a field in the row does not
        - the handle moves the row with the arrow keys
        - the arrow keys stop at the ends of the list
        - a drag from the first row to the second reports that move
        - a drag downwards lands where the pointer is, not one row further
        - a twitch inside the dragged row is not a move
        - a drag upwards lands where the pointer is
        - a drag released where it started reports nothing
        - a row that cannot be written is not part of the order
        - a row without a live version has no handle
        - a focusable ancestor does not silence the row
        - the plan cell opens the row exactly once

<!-- END proof -->

### SC-UI-020 — A page never takes the whole screen down because data arrived in a shape it did not expect

🟢 A malformed payload leaves a page that says so, not a blank content area beside a working shell.

_Source:_ release 0.24.1

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/use-async-action.test.js`
    - useAsyncAction — the happy path
        - resolves what the action returned
        - passes every argument through
        - pending is true while in flight and false afterwards
        - runs onSuccess with the result, before run resolves
        - stays silent on success by default
        - notifyOn "both" raises the success message
        - a success message may be computed at call time
    - useAsyncAction — failure
        - reports the failure in the result instead of throwing
        - a void action is still distinguishable — the whole reason for the shape
        - records the failure as an AdminError
        - clears pending even when the action throws
        - skips onSuccess
        - reports through the notify port, worded from the default catalog
        - what the server said outranks the catalog
        - errorMessage outranks both, and sees the AdminError
        - notifyOn "none" records the error without announcing it
        - without a notify port the failure is still recorded
    - useAsyncAction — overlapping invocations
        - pending stays true until the last one settles
    - useAsyncAction — a stale failure does not outlive a newer success
        - the older call failing last leaves no error behind
        - but a failure from the newest call is still recorded
    - useAsyncAction — a report cannot change what happened
        - a success toast that throws leaves the action successful
        - a successMessage that throws does the same
        - an error toast that throws still returns the action failure
    - useAsyncAction — the success continuation
        - a failing continuation fails the action, and says so only once
        - a continuation that succeeds still gets its success toast
    - useAsyncAction — the error ref over time
        - a later success clears an earlier failure
        - reset clears it without running anything
- `packages/ui-vue/tests/use-async-data.test.js`
    - useAsyncData — loading
        - starts at the initial value
        - loads on creation by default
        - immediate: false loads nothing until asked
        - does not block setup — nothing has loaded synchronously
        - pending is true while in flight
    - useAsyncData — failure
        - records the failure as an AdminError
        - puts the data back to initial rather than leaving stale rows
        - reload does not throw
        - clears pending even when the load throws
        - a later success clears the error
    - useAsyncData — overlapping loads
        - a superseded load does not overwrite the newer one
        - a superseded load does not clear pending while the newer one runs
        - a superseded load that FAILS does not wipe the page or raise its error
    - useAsyncData — watch
        - reloads when a watched source changes
        - a watched source combines with immediate: false — the first load is the change

<!-- END proof -->

### SC-UI-021 — A campaign that worked looks like a success, not a fault

🟢 A fully redeemed promotional code is shown as spent, not in the colour reserved for errors.

_Source:_ release 1.0.0-rc.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/promo-code-tiles.test.ts`
    - promo code status tiles
        - count every row the tenant has
        - keep their counts when a tile narrows the table
        - keep their counts while the search narrows the table

<!-- END proof -->
