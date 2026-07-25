# From Capability to Contract

SaaSiCat connects five parts of a SaaS product that are often built and
maintained separately:

```text
Capability → Discovery → Packaging → Contract → Enforcement
```

The point is simple: define a product capability close to the code that
implements it, sell it in one or more packages, and enforce exactly what the
customer bought.

## 1. Capability: describe what the code can do

A capability is a concrete operation implemented by your application. A
quota is a countable limit attached to product use.

```ts
@Post()
@ImplementsCapability('notes.create', { feature: 'NOTES' })
@RequireFeature('NOTES')
@EnforceQuota('notesMax')
createNote() {
    // Your application code stays yours.
}
```

The declarations live next to the implementation. You do not need to keep a
separate spreadsheet or hard-coded billing feature list in sync.

## 2. Discovery: turn code into reviewable product input

At boot, SaaSiCat scans capability and quota declarations and writes a
discovery snapshot. The SuperAdmin shows new and changed entries for review.

Discovery does not publish or sell anything automatically. It gives product
owners a controlled way to accept code reality into the product catalog.

## 3. Packaging: build plans and bundles

Accepted features and quotas can be:

- included in a plan;
- sold through a bundle;
- given different limits by plan;
- described in multiple languages in the public catalog.

Plans and bundles use drafts and published versions. Publishing creates a
fixed snapshot, so future edits do not change an offer that is already in
use.

## 4. Contract: freeze what the customer bought

Checkout creates a frozen offer from the selected plan, bundles, billing
cycle and price. Purchase turns that offer into an immutable subscription
contract.

The contract is the source of truth for billing and entitlements. When a
customer changes plans, SaaSiCat creates a new contract and keeps the old one
as history. Catalog edits never silently rewrite a running subscription.

## 5. Enforcement: apply the contract in the application

SaaSiCat resolves the active contract for the current tenant and applies it
at the endpoint:

- `@RequireFeature(...)` blocks an operation that is not licensed and can
  include relevant upgrade offers in the structured 403 response.
- `@EnforceQuota(...)` checks current usage and blocks a request that would
  cross the contracted limit.

The same product definition drives the catalog, the sold contract and runtime
access. That removes a common source of drift between pricing pages, billing
records and application behavior.

## What your application owns today

SaaSiCat is embedded in your application. Your application currently owns:

- your tenant isolation or authentication;
- your business logic;
- the application-specific code that counts usage.

Payment-provider connections currently use integration ports. Built-in
payment-provider integration is planned.

SaaSiCat supplies the product and entitlement layer between these systems,
with ready-made NestJS modules, PostgreSQL adapters and a Vue SuperAdmin UI.

## See the loop running

The [NotesApp example](../examples/notesapp/) declares `notes.create` and
`notes.export`, discovers both at boot, packages them into Starter and Pro,
and demonstrates allowed, feature-blocked and quota-blocked requests.

Continue with the [quickstart](quickstart.md) to add the same flow to an
existing multi-tenant NestJS application.
