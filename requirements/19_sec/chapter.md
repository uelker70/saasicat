---
title: Security and keeping tenants apart
---

The requirements here are stated from the tenant's side, because that is who bears the cost. Some
of them are things SaaSiCat does; several are things the installation has to do around it, and
those are stated as plainly as the rest, because a property that depends on a deployment is not a
property until the deployment provides it.

### SC-SEC-001 — A tenant never sees another tenant's data

🟢 🔒 Under no circumstances, and not because a screen filtered it out.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-tenant-subscription-write.test.js`
    - the no-options default preserves the 0.6 plan-only write
    - opening a window records the day the subscription is billed on
    - and a change that opens none leaves it alone
    - normalized mode binds semantic plan and active version atomically with named delegates
    - a pending version of the same target plan is retained
    - a failing onboarding callback rolls plan and version back together
    - pending PlanVersion acceptance uses a CAS and reports the concurrent loser
    - pending PlanVersion acceptance rejects a changed CAS target and a missing target
    - invalid validity capability combinations fail at construction

<!-- END proof -->

### SC-SEC-002 — Which tenant a request belongs to is derived from the authenticated session

🟢 🔒 Never from a value the caller supplied.

_Source:_ `docs/explanation/data-model.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/cli-context.test.js`
    - accepts --as flag
    - falls back to env var
    - throws NO_IDENTITY with exit code 2 when nothing is set
    - --as overrides env var
    - accepts SUPER_ADMIN user
    - rejects non-existent user (USER_NOT_FOUND, exit 2)
    - rejects deactivated user
    - rejects non-SUPER_ADMIN (NOT_SUPER_ADMIN)
    - Bypass: SKIP=1 + non-prod
    - bypass NOT in production
    - MFA_NOT_SET_UP when platform MfaService isEnabled=false
    - MFA_FAILED on invalid code
    - accepts valid code
    - skips automatically in non-prod
    - skips with yes=true in prod
    - accepts
    - rejects other answers (PRODUCTION_CONFIRM_ABORTED, exit 1)
    - writes through platform AdminAuditService with cli actor
    - has code, message and exitCode
- `packages/ui-vue/tests/admin-resource-client.test.js`
    - createAdminResourceClient exposes every standard Admin loader and action
    - createAdminResourceClient reports failed Admin requests
- `packages/ui-vue/tests/component/the-client-authenticates-every-request.test.ts`
    - every request carries the client
    - the page adds no header of its own to an unauthenticated client
- `packages/ui-vue/tests/one-way-to-authenticate.test.js`
    - there is a corpus to scan
    - no option named
    - nothing builds a Bearer header by hand

<!-- END proof -->

### SC-SEC-003 — Reads that legitimately cross tenants are named as the exceptions they are

🟢 🔒 Platform-wide counts an operator needs are the documented exception; everything else is scoped.
Administration acts on behalf of the platform rather than of a tenant, which is why they are the
only reads that step outside a tenant's boundary.

_Source:_ `docs/explanation/data-model.md`

### SC-SEC-004 — Every decision that matters is made where the request is served

🟢 🔒 The interface hides what would be refused. It is not what does the refusing.

_Source:_ `docs/guides/build-the-admin-frontend.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-route.test.js`
    - SaaSiCat public route metadata
        - ${controller.name} is recognized by global auth guards
        - unmarked controllers stay protected
- `packages/ui-vue/tests/admin-resource-client.test.js`
    - createAdminResourceClient exposes every standard Admin loader and action
    - createAdminResourceClient reports failed Admin requests
- `packages/ui-vue/tests/component/the-client-authenticates-every-request.test.ts`
    - every request carries the client
    - the page adds no header of its own to an unauthenticated client
- `packages/ui-vue/tests/navigation-guard.test.js`
    - returns null when neither authGuard nor manifestGuard is set
    - redirects to onUnauthenticated() when isAuthenticated is false
    - lets public routes bypass the auth guard
    - redirects to onUnauthenticated when isSuperAdmin is false
    - redirects to errorRoute when ensureLoaded rejects and errorRoute is set
    - avoids redirect loop: when the current route is already errorRoute, returns true
    - falls back to render-allow + console.error when NO errorRoute is set
    - lets the render through when ensureLoaded resolves successfully
    - 401 from the manifest load routes to login, not to the error page
    - 403 is treated the same way
    - a genuine manifest failure still fails closed to the error page
    - an error without a status stays on the fail-closed path
    - without an authGuard a 401 still reaches the error page
    - first 401 offers a re-login, the second stops the circle
    - a successful load re-arms the redirect for a later expiry
    - concurrent navigations on one rejection share the login redirect
    - the second attempt fails closed once the operator has seen login
    - a cached error instance does not resurrect the login loop
    - a later, different rejection still fails closed

<!-- END proof -->

### SC-SEC-005 — Data arriving from outside is validated at the boundary

🟢 🔒 Requests, external systems and files are checked where they enter; code inside the boundary is
trusted.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/bundle-dtos-validate.test.js`
    - CreateBundleDto
        - accepts a complete bundle
        - requires the two identity fields
        - holds the key pattern
        - holds the lengths and the sort-order range
    - UpdateBundleDto
        - accepts an empty patch
        - clears a text field with null, and keeps the same limits
    - CreateBundleVersionDraftDto
        - accepts a complete draft
        - requires the feature list
        - holds the feature-key shape
        - holds the decimal shape, and lets null through
        - holds the date shape, and lets null through
    - UpdateBundleVersionDraftDto
        - accepts an empty patch and the same shapes as create
        - refuses what create refuses, field for field
- `packages/spec/tests/schemas.test.js`
    - adminManifestSchema compiles
    - planCatalogSchema compiles
    - promoCodeSchema compiles
    - auditEventSchema compiles
    - planCatalog accepts minimal valid catalog
    - promoCode CreatePromoCodeRequest accepts a typical PERCENT code
    - promoCode CreatePromoCodeRequest rejects lowercase code
    - auditEvent accepts minimal valid entry
    - auditEvent rejects lowercase action
    - adminManifest accepts minimal valid manifest
    - adminManifest rejects the removed planVersions standard page
    - adminManifest rejects capability with colon notation
- `packages/ui-vue/tests/component/payload-shapes-that-are-not-the-type.test.ts`
    - ${label} renders instead of throwing
    - the null case still shows the documented fallbacks
- `packages/ui-vue/tests/http-adapters.test.js`
    - passes a relative URL through unchanged when there is no base URL
    - prepends the base URL, without doubling the slash
    - leaves an absolute URL alone even with a base URL set
    - reads the headers hook per request, so a refreshed token is picked up
    - awaits an async headers hook
    - asks for JSON
    - an Accept the hook asked for is kept
    - a per-call header wins over the hook, whatever the casing
    - supplies a JSON content type for a body that arrived without one
    - does not invent a content type when there is no body
    - a non-2xx is a response, not a throw
    - response headers are readable under any casing
    - a failed request is marked as one, whichever way the client was built
    - defaultHttpClient is this client with no options
    - strips the prefix the instance already carries as its baseURL
    - tries several prefixes in order, so the longer one is not shadowed
    - a prefix written with a trailing slash strips the same way
    - a query ends the path, so the prefix is still the prefix
    - a fragment ends it too
    - leaves a URL that does not start with the prefix alone
    - a URL that is exactly the prefix becomes the root, not the empty string
    - without stripPrefix the URL passes through whole
    - no status throws — 304, 402 and 500 all arrive as responses
    - the method is upper-cased and defaults to GET
    - a DELETE carries its body through
    - json() returns what axios already parsed
    - json() parses a raw string, for an instance with transformResponse disabled
    - every way of turning axios’s own decoding off is read as text
    - responseType json is the one that still means decoded
    - json() does not decode a second time what axios already decoded
    - a decoded string that reads as JSON keeps its meaning
    - json() throws on a raw body that is not JSON, exactly as Response.json() does
    - a body a decoding instance could not parse is the string it kept
    - an empty body throws whatever the instance decodes
    - a declared decoding instance hands an empty data over as the empty string
    - a declared raw instance still throws on an empty data
    - transformResponse null is a pipeline that ran nothing, so the body is raw
    - a config that merely omits transformResponse has not said anything
    - a response carrying no config is read as already decoded
    - text() gives a string either way
    - response headers are readable under any casing
    - a header that is not there reads as null, not undefined
    - survives an instance that reports no headers at all
    - request headers are handed to the instance untouched
    - a rejection the instance recovers from never reaches the platform
    - a rejection it does not recover from arrives as a response, not a throw
    - a failure with no response stays a throw
    - a structural instance that says nothing is not marked for it
    - …and the way out is the one the fetch adapter uses
    - no validateStatus is imposed on the instance
    - a 304 with an ETag is usable by the manifest loader’s cache path
    - a 204 arrives as a status the caller can check before reading a body
    - json() yields what was on the wire, however the instance is configured
    - json() yields what was on the wire when the instance declares how
    - a rejected status is read by the same declaration
    - an instance with its own transform is read as decoding until it says otherwise
    - an empty body throws, whichever instance asked for it
    - an instance that hands the body over reads
    - a declaration recovers
    - a body no one could decode is the text it was, where axios kept it
    - a rejected status arrives as a response with its body readable
    - the prefix an instance carries as its baseURL is stripped back off
    - a browser Blob body is read through the text() it exposes
    - what an interceptor rewrites, the adapter can no longer judge
    - a body axios delivered as bytes reads as the value those bytes spell
    - and the two readers of a byte body agree about it
    - an empty byte body throws, as an empty text body does
    - a streamed body is refused by name, not mishandled
    - a transform returning an object still hands that object over
    - a genuine network failure is marked
    - a DNS failure and a timeout are the same fact and are marked too
    - a network failure a rejection interceptor rethrows is still marked
    - an interceptor
    - …including when it carries axios’s config across, which is the shape that fooled the old
      reading
    - …and when it carries
    - an interceptor rejecting with another request’s failure is that request’s answer
    - a failure while setting the request up keeps its own words
    - a request interceptor that throws is not a transport failure
    - an answered status never reaches the brand at all
    - the reading holds on its own, not only where the adapter calls it

<!-- END proof -->

### SC-SEC-006 — An installation must terminate traffic at a proxy it controls

🟢 🔒 Rate limits identify a caller from a header a client can set. Without a proxy that overwrites
it, an attacker rotates identities and defeats every limit on sign-in, registration, code resends
and promotional codes.

_Source:_ `SECURITY.md`

### SC-SEC-007 — Rate limits are per process and reset on restart

🟢 🔒 An installation running several instances multiplies every limit it configured. They are a
throttle, not a lockout, and an installation that needs the stronger property provides it itself.

_Source:_ `SECURITY.md`

### SC-SEC-008 — The setup token is a bootstrap secret and is removed once bootstrapping is done

🟢 🔒 Anyone holding it before the first administrator exists can take the installation over.

_Source:_ `SECURITY.md`

### SC-SEC-009 — Checks run in a fixed order and fail closed

🟢 🔒 A check that expects an authenticated caller refuses rather than passing when the step before it
did not run.

_Source:_ `SECURITY.md`

### SC-SEC-010 — A vulnerability is reported privately and never described in public

🟢 🔒 Not in an issue, a pull request, a commit message or a release note. A fix may still be
published; its description must not double as instructions.

_Source:_ `SECURITY.md`

### SC-SEC-011 — Security fixes go to the newest release line, and all packages move together

🟢 🔒

_Source:_ `SECURITY.md`

### SC-SEC-012 — A new dependency's licence is part of the decision to add it

🟢 A copyleft dependency would conflict with the terms SaaSiCat is distributed under, and the
conflict is only discoverable by reading. Where it is unclear, it is raised rather than added.

_Source:_ ADR 0001
