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
    - a write never reaches another tenant's row
        - a plan change asked for by a stranger changes nothing
        - a cancellation asked for by a stranger changes nothing

<!-- END proof -->

### SC-SEC-002 — Which tenant a request belongs to is derived from the authenticated session

🟢 🔒 Never from a value the caller supplied.

_Source:_ `docs/explanation/data-model.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-tenant-keeps-its-billing-details.test.js`
    - the tenant reads whom it is billed to
        - the tenant comes from the session: another tenant's session reads its own subscriber
- `packages/nest/tests/tenant-billing-controller.test.js`
    - the tenant is taken from the session, not from what the caller sent
    - and a session that names none is refused rather than falling back

<!-- END proof -->

### SC-SEC-003 — Reads that legitimately cross tenants are named as the exceptions they are

🟢 🔒 Platform-wide counts an operator needs are the documented exception; everything else is scoped.
Administration acts on behalf of the platform rather than of a tenant, which is why they are the
only reads that step outside a tenant's boundary.

_Source:_ `docs/explanation/data-model.md`

### SC-SEC-014 — A payment method's reference belongs to exactly one subscriber

🟢 🔒 Within a gateway account, the reference a payment method is kept under names one subscriber,
and it keeps naming it after a newer payment method has replaced it. So asking for a payment method
by its reference is asking whether a named subscriber holds it, and another subscriber is answered
that it holds none rather than with the row; a confirmation carrying a reference another subscriber
holds is refused, rather than recorded or answered as a repeat of a payment method that is not this
subscriber's. Both are reached on the gateway's callback, which arrives without a session, so an
installation that keeps its tenants apart with a policy lifts that policy there (`SC-SEC-003`) and
what the question names is all that is left to bound it. Where a provider issues one reference for
two payers, the second subscriber's confirmation is refused rather than mixed into the first's
(`SC-PRIC-030`): taking it needs an account of its own.

_Source:_ #305

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/a-claim-that-takes-no-row.test.js`
    - a claim that takes no row
        - is refused as a foreign reference, and says nothing of the holder
        - is refused without reading the holder back, because a policy can hide it
- `packages/core/tests/a-reference-belongs-to-one-subscriber.test.js`
    - a reference the account already holds
        - is the subscriber that holds it reading its own back
        - is refused for any other subscriber, naming the reference and its account
        - is refused in a message that does not name the subscriber holding it
        - is refused with the account and the reference beside the sentence
    - the refusal as a caller recognises it
        - is recognised, also from another copy of the class
        - is told apart from every other failure of a write
        - is what an implementation raises where the key refuses the row
- `packages/nest/tests/a-tenant-changes-its-payment-method-through-the-gateway.test.js`
    - changing it opens the gateway form, and the confirmation replaces the one in use
        - a confirmation naming a reference another subscriber holds records nothing, and says so
          once

<!-- END proof -->

### SC-SEC-004 — Every decision that matters is made where the request is served

🟢 🔒 The interface hides what would be refused. It is not what does the refusing.

_Source:_ `docs/guides/build-the-admin-frontend.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-tenant-changes-its-payment-method-through-the-gateway.test.js`
    - the billing permission
        - every route of the payment method is behind authentication and the permission, reading
          included
- `packages/nest/tests/a-tenant-keeps-its-billing-details.test.js`
    - every route of the billing details is behind authentication and the permission, reading
      included
- `packages/nest/tests/public-route.test.js`
    - SaaSiCat public route metadata
        - ${controller.name} is recognized by global auth guards
        - unmarked controllers stay protected

<!-- END proof -->

### SC-SEC-005 — Data arriving from outside is validated at the boundary

🟢 🔒 Requests, external systems and files are checked where they enter; code inside the boundary is
trusted.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - the request for step 4 is validated where it arrives
        - a complete request passes, the tax identifiers left out
        - a request without billing details is refused
        - a missing address line, a lower-case country and a script URL are each refused
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
        - holds a plan's own price in pricingOverrides to the same two fraction digits
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
    - every schema file is exported from both entry points
    - and the two entry points offer the same names
    - and the type shells name what the entry points export
    - tenantLedger accepts a charge carrying its period, origin and money facts
    - tenantLedger accepts a charge that names no contract
    - tenantLedger accepts a payment, which carries no period
    - tenantLedger accepts a payment on account, settling no named charge
    - tenantLedger rejects a charge without an origin
    - tenantLedger rejects an origin outside the catalogue of origins
    - tenantLedger rejects an empty originRef, which would not collide with itself
    - tenantLedger rejects a charge that names no period
    - tenantLedger rejects a payment without an external reference
    - tenantLedger rejects a payment whose external reference is empty
    - tenantLedger rejects an entry that is neither a charge nor a payment
    - tenantLedger rejects a charge wearing a payment field
    - tenantLedger rejects a payment that states a tax of its own
    - tenantLedger rejects a currency that is not an ISO 4217 code
    - tenantLedger rejects a tax rate above 100 per cent
    - tenantLedger accepts a credit, which is a negative charge
    - tenantLedger accepts an account with a balance, open items and history
    - tenantLedger rejects an account that does not say when its balance is true
- `packages/ui-vue/tests/component/payload-shapes-that-are-not-the-type.test.ts`
    - DiscoveryPage survives a snapshot that is not a snapshot
        - ${label} renders instead of throwing
        - the null case still shows the documented fallbacks
- `packages/ui-vue/tests/http-adapters.test.js`
    - createFetchHttpClient
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
    - createAxiosHttpClient
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
    - createAxiosHttpClient — the instance keeps its own error handling
        - a rejection the instance recovers from never reaches the platform
        - a rejection it does not recover from arrives as a response, not a throw
        - a failure with no response stays a throw
        - a structural instance that says nothing is not marked for it
        - …and the way out is the one the fetch adapter uses
        - no validateStatus is imposed on the instance
    - the adapters satisfy what the platform loaders expect
        - a 304 with an ETag is usable by the manifest loader’s cache path
        - a 204 arrives as a status the caller can check before reading a body
    - createAxiosHttpClient — against a real axios instance
        - json() yields what was on the wire, however the instance is configured
        - json() yields what was on the wire when the instance declares how
        - a rejected status is read by the same declaration
        - an instance with its own transform is read as decoding until it says otherwise
        - an empty body throws, whichever instance asked for it
        - an instance that hands the body over reads `""` as the empty string
        - a declaration recovers `""` from an instance that already decoded it
        - `""` is the one body a decoding instance under `auto` cannot get back
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
    - createAxiosHttpClient — the transport brand, against real axios
        - a genuine network failure is marked
        - a DNS failure and a timeout are the same fact and are marked too
        - a network failure a rejection interceptor rethrows is still marked
        - an interceptor's replacement error keeps its message
        - …including when it carries axios’s config across, which is the shape that fooled the old
          reading
        - …and when it carries `request` too, which is why `isAxiosError` is read
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

🟢 🔒 A check that expects an authenticated caller refuses rather than passing when the step before
it did not run.

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

### SC-SEC-013 — The platform's own routes with lasting consequences check the second factor themselves

🟢 🔒 Suspending or reactivating a tenant (`SC-ADM-005`), publishing a plan or bundle version,
ending a plan version, purging a plan, and importing a catalogue, whose plans are published as they
are created. The check sits on the route rather than in the guards an integrator passes, so a guard
list that leaves it out, an override of that list or a module wired by hand does not switch it off;
a module wired by hand that cannot provide the second factor does not start. It runs after the
caller is established and the role is checked, an operator who has not set up a second factor is
refused, and the shipped administration asks for the code before each of these actions. A route an
application serves itself is the application's to protect.

_Source:_ release 1.0.0-rc.12

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/lasting-operator-actions-require-the-second-factor.test.js`
    - which routes the platform mounts ask for the second factor
        - the walk reaches every lasting action
        - each one carries the check on its handler, not in the chain an integrator passes
        - no other route asks for it
    - what the chain Nest builds does with a request
        - each chain holds the role check before the second factor
        - the platform administrator without a code is refused by name
        - a wrong code is refused, and the right one passes
        - an operator who has not set up a second factor is refused rather than let through
        - a caller named by `userId` rather than `id` is checked under that name
        - a platform administrator the request does not name is refused as unauthenticated
        - a tenant user meets the role check, even holding a valid code
        - every other operator route lets the platform administrator through without a code
    - suspending and reactivating a tenant
        - an override of the administration guards that leaves the check out does not leave it out
    - the catalogue import, a module wired by hand
        - asks for the second factor, whatever guards it was given
        - with no guards, nothing establishes a caller and the import is refused
        - without the second factor available, it does not start
- `packages/ui-vue/tests/component/lasting-actions-ask-for-the-second-factor.test.ts`
    - BundlesPage asks for the code before it publishes
        - nothing is published until the code is entered, and the code goes with it
        - cancelling publishes nothing and answers null, which keeps the publish dialog open
        - a refused code asks again and says why
    - PlansPage asks for the code before it purges, ends or publishes
        - purging sends nothing before the code, then the code
        - a cancelled purge sends nothing and shows no error
        - ending a live version waits for the code, and a cancel answers false
        - publishing from the dialog carries the code
- `packages/ui-vue/tests/lasting-actions-carry-the-second-factor.test.js`
    - a lasting action carries the code in the header, and only when there is one
        - ${c.name} sends it with a code
        - ${c.name} sends no header for an empty code
    - the dialog loop the pages share
        - the action runs with the entered code, and the dialog closes after it
        - cancelling runs nothing and says so
        - a refused code keeps the dialog open, says so, and a second code goes through
        - a package error carrying the status counts as a refusal, not only an AdminError
        - any other failure closes the dialog and reaches the caller

<!-- END proof -->
