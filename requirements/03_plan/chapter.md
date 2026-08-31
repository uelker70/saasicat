---
title: Plans and their versions
---

A plan is the thing a customer chooses; a version of it is the offer they actually bought. Almost
every requirement here exists to protect one promise: what a customer was sold does not change
underneath them. That is why a published version freezes once it applies, why a version somebody is
bound to cannot be edited, and why nothing published is ever deleted.

### SC-PLAN-001 — A plan is an identity; a version carries what it costs and includes

🟢 The name a customer recognises stays the same across price changes. What they pay and what they
get belongs to the version they bought.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plans-service.test.js`
    - PlansService — root operations
        - createPlan + listPlans + getPlan happy path
        - createPlan: duplicate planKey → UnprocessableEntity
        - createPlan: a plan key is taken once for the installation
        - updatePlan changes label + sortOrder
        - updatePlan: NotFound for unknown ID
        - softDeletePlan without versions sets deletedAt + disappears from list
        - softDeletePlan idempotent (second call without throw)
        - softDeletePlan: NotFound for unknown ID
        - softDeletePlan: live version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: superseded version (no live anymore) → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: only draft (nothing published) → allowed
        - hardDeletePlan: without versions → plan is gone from list
        - hardDeletePlan: with draft → 422 PLAN_HAS_DRAFTS
        - hardDeletePlan: with published version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - hardDeletePlan: NotFound for unknown ID
        - listPlans returns every plan of the installation
        - listPlans onlyPublished: only plans with a live version
        - listPlans onlyPublished: superseded version does not count as live

<!-- END proof -->

### SC-PLAN-002 — A plan has at most one unpublished draft at a time

🟢 An operator finishes what they started — publishing or discarding the open draft — before opening
another. Two half-written offers for one plan are a state nobody can explain to a colleague.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — Lifecycle
        - createPlanDraft + listPlanVersions returns v1 with publishedAt=null
        - createPlanDraft: second draft → UnprocessableEntity (max 1 draft)
        - createPlanDraft: unknown plan → NotFound
        - updatePlanDraft: changes features + quotas
        - createPlanDraft: bundles default to [] when not provided
        - createPlanDraft + updatePlanDraft: bundles are persisted
        - updatePlanDraft: published version → UnprocessableEntity
        - publishPlanVersion: first version → publishedAt + nonRegressive=true
        - publishPlanVersion: price 0.00 → 422 PLAN_VERSION_ZERO_PRICE (seed placeholder protection)
        - publishPlanVersion: second version sets previous to supersededAt
        - publishPlanVersion: validFrom must be strictly after predecessor → 422
        - publishPlanVersion: without validFrom → 422 PLAN_VERSION_VALID_FROM_REQUIRED
        - publishPlanVersion: regressive version (feature removed) → 422 without forceRegressive
        - publishPlanVersion: forceRegressive lets regressive version through
        - getPlanVersion: NotFound for unknown ID
        - discardPlanDraft: draft → removed, listPlanVersions returns empty list
        - discardPlanDraft: published version → 422 PLAN_VERSION_ALREADY_PUBLISHED
        - discardPlanDraft: NotFound for unknown ID
        - publishPlanVersion: gapless when predecessor has validUntil — successor must start the
          next day
        - terminatePlanVersion: live version gets endsAt set
        - terminatePlanVersion: idempotent — second call overwrites
        - terminatePlanVersion: date in the past → 422 PLAN_TERMINATE_DATE_NOT_FUTURE
        - terminatePlanVersion: draft (publishedAt=null) → 422 PLAN_VERSION_NOT_PUBLISHED
        - terminatePlanVersion: superseded version → 422 PLAN_VERSION_SUPERSEDED
        - terminatePlanVersion: NotFound for unknown ID
        - publishPlanVersion: gapless check not active when predecessor has no validUntil (auto
          succession)
- `packages/nest/tests/version-publish.test.js`
    - assertDraftPublishable
        - accepts a fresh draft
        - null draft → NOT_FOUND
        - published draft → ALREADY_PUBLISHED
        - draft without baseVersionId → NO_BASE_VERSION

<!-- END proof -->

### SC-PLAN-003 — A plan has at most one live version at a time

🟢 Publishing a successor retires its predecessor in the same act, so there is never a moment in
which two versions of one plan are both current and a purchase could land on either.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — Lifecycle
        - createPlanDraft + listPlanVersions returns v1 with publishedAt=null
        - createPlanDraft: second draft → UnprocessableEntity (max 1 draft)
        - createPlanDraft: unknown plan → NotFound
        - updatePlanDraft: changes features + quotas
        - createPlanDraft: bundles default to [] when not provided
        - createPlanDraft + updatePlanDraft: bundles are persisted
        - updatePlanDraft: published version → UnprocessableEntity
        - publishPlanVersion: first version → publishedAt + nonRegressive=true
        - publishPlanVersion: price 0.00 → 422 PLAN_VERSION_ZERO_PRICE (seed placeholder protection)
        - publishPlanVersion: second version sets previous to supersededAt
        - publishPlanVersion: validFrom must be strictly after predecessor → 422
        - publishPlanVersion: without validFrom → 422 PLAN_VERSION_VALID_FROM_REQUIRED
        - publishPlanVersion: regressive version (feature removed) → 422 without forceRegressive
        - publishPlanVersion: forceRegressive lets regressive version through
        - getPlanVersion: NotFound for unknown ID
        - discardPlanDraft: draft → removed, listPlanVersions returns empty list
        - discardPlanDraft: published version → 422 PLAN_VERSION_ALREADY_PUBLISHED
        - discardPlanDraft: NotFound for unknown ID
        - publishPlanVersion: gapless when predecessor has validUntil — successor must start the
          next day
        - terminatePlanVersion: live version gets endsAt set
        - terminatePlanVersion: idempotent — second call overwrites
        - terminatePlanVersion: date in the past → 422 PLAN_TERMINATE_DATE_NOT_FUTURE
        - terminatePlanVersion: draft (publishedAt=null) → 422 PLAN_VERSION_NOT_PUBLISHED
        - terminatePlanVersion: superseded version → 422 PLAN_VERSION_SUPERSEDED
        - terminatePlanVersion: NotFound for unknown ID
        - publishPlanVersion: gapless check not active when predecessor has no validUntil (auto
          succession)

<!-- END proof -->

### SC-PLAN-004 — A published version is never deleted

🟢 A customer bound to a retired version keeps being served and billed by it. That is the whole
reason versions exist, and it is why removing one is not an option even when it is old. Discarding
is refused the moment a version is published — unlike rewriting it, which SC-PLAN-005 leaves open
in one narrow case.

_Source:_ `docs/explanation/data-model.md`

### SC-PLAN-005 — A version somebody has already bought cannot be edited

🟢 💰 Only a draft can be changed, or a published version that is the newest of its line, has nobody
on it, and does not start until some day in the future.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/version-editability.test.js`
    - drafts remain editable
    - published-but-future is only editable when latest-in-chain without a subscription
    - subscriptionCount undefined blocks fail-closed
    - referenced versions remain frozen
    - non-latest, superseded and already-active versions remain frozen
- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — Lifecycle
        - createPlanDraft + listPlanVersions returns v1 with publishedAt=null
        - createPlanDraft: second draft → UnprocessableEntity (max 1 draft)
        - createPlanDraft: unknown plan → NotFound
        - updatePlanDraft: changes features + quotas
        - createPlanDraft: bundles default to [] when not provided
        - createPlanDraft + updatePlanDraft: bundles are persisted
        - updatePlanDraft: published version → UnprocessableEntity
        - publishPlanVersion: first version → publishedAt + nonRegressive=true
        - publishPlanVersion: price 0.00 → 422 PLAN_VERSION_ZERO_PRICE (seed placeholder protection)
        - publishPlanVersion: second version sets previous to supersededAt
        - publishPlanVersion: validFrom must be strictly after predecessor → 422
        - publishPlanVersion: without validFrom → 422 PLAN_VERSION_VALID_FROM_REQUIRED
        - publishPlanVersion: regressive version (feature removed) → 422 without forceRegressive
        - publishPlanVersion: forceRegressive lets regressive version through
        - getPlanVersion: NotFound for unknown ID
        - discardPlanDraft: draft → removed, listPlanVersions returns empty list
        - discardPlanDraft: published version → 422 PLAN_VERSION_ALREADY_PUBLISHED
        - discardPlanDraft: NotFound for unknown ID
        - publishPlanVersion: gapless when predecessor has validUntil — successor must start the
          next day
        - terminatePlanVersion: live version gets endsAt set
        - terminatePlanVersion: idempotent — second call overwrites
        - terminatePlanVersion: date in the past → 422 PLAN_TERMINATE_DATE_NOT_FUTURE
        - terminatePlanVersion: draft (publishedAt=null) → 422 PLAN_VERSION_NOT_PUBLISHED
        - terminatePlanVersion: superseded version → 422 PLAN_VERSION_SUPERSEDED
        - terminatePlanVersion: NotFound for unknown ID
        - publishPlanVersion: gapless check not active when predecessor has no validUntil (auto
          succession)

<!-- END proof -->

### SC-PLAN-006 — Where it cannot be established that nobody is on a version, it stays frozen

🟢 The uncertain case is treated as the dangerous one, so a version is never opened for editing on
the assumption that it is unsold.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/version-editability.test.js`
    - drafts remain editable
    - published-but-future is only editable when latest-in-chain without a subscription
    - subscriptionCount undefined blocks fail-closed
    - referenced versions remain frozen
    - non-latest, superseded and already-active versions remain frozen
- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — published-but-future editing (Pack 2c)
        - updatePlanDraft allows published-but-future version (latest, 0 subs)
        - updatePlanDraft blocks published-but-future version with subscription
        - updatePlanDraft blocks published version that is not latest-in-chain
        - listPlanVersions annotates isLatestInChain + subscriptionCount on the latest version
        - updatePlanDraft fail-closed without SubscriptionRepository

<!-- END proof -->

### SC-PLAN-007 — Publishing says what changed

🟡 _(Decided, not yet delivered.)_ A version is published with a note describing the change, and an
empty note is refused, because the note is what an operator reads a year later when a customer asks
why their price moved. Today the note is optional in the publish interface and a version carrying
none publishes.

_Source:_ current practice

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-publish.test.js`
    - assertChangeNote
        - accepts a non-empty note (trimmed)
        - rejects an empty note
        - rejects null/undefined
        - rejects whitespace-only

<!-- END proof -->

### SC-PLAN-008 — A price of exactly zero has to be meant

🟢 💰 Publishing a plan version priced at zero is refused unless the operator says explicitly that it
is deliberate. An accidental batch publish at 0.00 once set every tariff to free.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-publish-controller.test.js`
    - PlanVersions.publish passes allowZeroPrice through to the service (#63)
    - PlanVersions.publish: allowZeroPrice stays undefined without the DTO flag
    - BundleVersions.publish passes allowZeroPrice through to the service (#63)
    - BundleVersions.publish: allowZeroPrice stays undefined without the DTO flag

<!-- END proof -->

### SC-PLAN-009 — Publishing something that takes away has to be confirmed

🟢 A version that removes a feature, raises a price or lowers one of the three quotas SC-PLAN-025
names is a change existing customers feel. It publishes only on an explicit confirmation, so it is
never the outcome of a mis-click.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-publish.test.js`
    - assertDraftPublishable
        - accepts a fresh draft
        - null draft → NOT_FOUND
        - published draft → ALREADY_PUBLISHED
        - draft without baseVersionId → NO_BASE_VERSION

<!-- END proof -->

### SC-PLAN-010 — One regressive change makes the whole version regressive

🟢 A version that improves nine things and lowers one is treated as a change customers feel, because
one of them will.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-025 — Every quota a version carries counts as a limit that can be lowered

🟡 _(Decided, not yet delivered.)_ A plan version is compared on `users`, `vehicles` and `storageGb`
alone, so a quota an installation defines for itself — NotesApp's `notesMax`, for instance — can be
lowered and published without the confirmation SC-PLAN-009 asks for. Add-on versions are already
compared on every quota they carry.

_Source:_ current practice

### SC-PLAN-011 — A published version says which day it applies from

🟢 Each successor starts strictly after the one before it, so for any given day there is exactly one
answer to "what was on offer".

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/active-plan-version-query.test.js`
    - requires publishedAt IS NOT NULL
    - tolerates validFrom IS NULL (
    - validUntil day-inclusive: &gt;= startOfDay(asOf), not &gt; asOf
    - startOfUtcDay normalizes to 00:00 UTC
    - without withEndsAt: no endsAt clause (CatalogPlanVersion)
    - withEndsAt: adds an endsAt clause (PlanVersion)
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Plans (validFrom tolerance)
        - live plan version with validFrom=NULL appears in the catalog
        - findActivePlanVersion returns the NULL-validFrom version when it is the only live one
        - dated version wins over NULL-validFrom (fallback, not an override)
- `packages/nest/tests/validity-window.test.js`
    - the window a version is published with
        - the publish call wins over the draft for the start
        - the draft carries the start when the call does not
        - an explicit null end means unbounded, not
        - a silent call still takes the draft’s end

<!-- END proof -->

### SC-PLAN-012 — There is no gap and no overlap between two versions of a plan

🟢 Where a version states the last day it is valid, its successor starts the next day. A day on which
a plan exists but has no offer is refused rather than discovered by the first customer to land on
it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/validity-window.test.js`
    - the window a version is published with
        - the publish call wins over the draft for the start
        - the draft carries the start when the call does not
        - an explicit null end means unbounded, not
        - a silent call still takes the draft’s end

<!-- END proof -->

### SC-PLAN-013 — A version is still valid on its own last day

🟢 Validity dates are inclusive, so an offer does not go dark on the day it is advertised until.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Plans (validUntil day-inclusive)
        - single-day version (validFrom=validUntil=today) is active today
        - validUntil = yesterday → dark today
        - succession without a dead day: v1 (…–today) active today, v2 (tomorrow–) not yet

<!-- END proof -->

### SC-PLAN-014 — A plan that has ever been published is kept

🟢 It may be withdrawn from sale; it is not removed. Subscriptions reference the versions under it,
and the record has to survive them.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plans-service.test.js`
    - PlansService — root operations
        - createPlan + listPlans + getPlan happy path
        - createPlan: duplicate planKey → UnprocessableEntity
        - createPlan: a plan key is taken once for the installation
        - updatePlan changes label + sortOrder
        - updatePlan: NotFound for unknown ID
        - softDeletePlan without versions sets deletedAt + disappears from list
        - softDeletePlan idempotent (second call without throw)
        - softDeletePlan: NotFound for unknown ID
        - softDeletePlan: live version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: superseded version (no live anymore) → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: only draft (nothing published) → allowed
        - hardDeletePlan: without versions → plan is gone from list
        - hardDeletePlan: with draft → 422 PLAN_HAS_DRAFTS
        - hardDeletePlan: with published version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - hardDeletePlan: NotFound for unknown ID
        - listPlans returns every plan of the installation
        - listPlans onlyPublished: only plans with a live version
        - listPlans onlyPublished: superseded version does not count as live

<!-- END proof -->

### SC-PLAN-015 — A plan with an open draft is not removed

🟢 The draft is published or discarded first, so no half-written offer disappears without anyone
deciding what it was for.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plans-service.test.js`
    - PlansService — root operations
        - createPlan + listPlans + getPlan happy path
        - createPlan: duplicate planKey → UnprocessableEntity
        - createPlan: a plan key is taken once for the installation
        - updatePlan changes label + sortOrder
        - updatePlan: NotFound for unknown ID
        - softDeletePlan without versions sets deletedAt + disappears from list
        - softDeletePlan idempotent (second call without throw)
        - softDeletePlan: NotFound for unknown ID
        - softDeletePlan: live version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: superseded version (no live anymore) → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: only draft (nothing published) → allowed
        - hardDeletePlan: without versions → plan is gone from list
        - hardDeletePlan: with draft → 422 PLAN_HAS_DRAFTS
        - hardDeletePlan: with published version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - hardDeletePlan: NotFound for unknown ID
        - listPlans returns every plan of the installation
        - listPlans onlyPublished: only plans with a live version
        - listPlans onlyPublished: superseded version does not count as live

<!-- END proof -->

### SC-PLAN-016 — A version can be given an end date, and it lies in the future

🟢 Ending a version stops new bookings on it. It does not move anybody who is already on it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — published-but-future editing (Pack 2c)
        - updatePlanDraft allows published-but-future version (latest, 0 subs)
        - updatePlanDraft blocks published-but-future version with subscription
        - updatePlanDraft blocks published version that is not latest-in-chain
        - listPlanVersions annotates isLatestInChain + subscriptionCount on the latest version
        - updatePlanDraft fail-closed without SubscriptionRepository
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Plans (validUntil day-inclusive)
        - single-day version (validFrom=validUntil=today) is active today
        - validUntil = yesterday → dark today
        - succession without a dead day: v1 (…–today) active today, v2 (tomorrow–) not yet
- `packages/nest/tests/validity-window.test.js`
    - the window a version is refused for
        - no start at all
        - a start that is not a date
        - a start on or before the predecessor’s
        - a start that leaves a gap after a predecessor that ends
        - a predecessor without an end imposes no seam
        - an end that is not a date
        - an end on or before the start
        - the codes come from the caller, so a plan refuses as a plan
        - the gapless refusal says which day it wanted

<!-- END proof -->

### SC-PLAN-017 — Publishing happens in the administration, never in a seed

🟢 Data loaded at set-up may create drafts. Turning a draft into an offer is an act an operator
performs and is recorded as having performed.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-catalog-importer.test.js`
    - PlanCatalogImporterService
        - importFromYaml: first round → all created
        - importFromYaml: second run → all skipped (idempotent)
        - importFromYaml: plan without monthlyNet → warning + skip PlanVersion
- `packages/nest/tests/seed-gate-runner.test.js`
    - runSeedGateFromFile
        - report-only without snapshot → null + warning, no exit
        - blocking without snapshot → exit 4
        - report-only with violations → report, seed continues
        - blocking with violations → exit 4
        - clean seed → report ok, no exit
- `packages/nest/tests/seed-gate.test.js`
    - validateSeedAgainstSnapshot
        - all seeded features discovered → overall ok
        - plan with an undiscovered feature → PLAN_FEATURE_UNKNOWN + error
        - bundle with an undiscovered feature → BUNDLE_FEATURE_UNKNOWN
        - undiscovered quota → QUOTA_MISSING
        - empty input → ok
        - formatSeedGateReport shows entity + code

<!-- END proof -->

### SC-PLAN-018 — The version that applies is the one valid on the day of the purchase

🟢 💰 Not the newest one, and not the one the pricing page happened to be showing.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-plan-binding.test.js`
    - the omitted schema preserves every 0.6 plan default
    - normalized mode resolves both directions
    - catalog read uses the catalog delegate and exposes semantic planKey
    - catalog import resolves planKey to UUID and writes only the catalog delegate
    - entitlement and subscription adapters use their delegate and map UUID back
    - active subscription counts use authoritative PlanVersions
    - a subscription that has ended is not an active tenant
    - all subscription operations honor tenantSubscription.delegate, including tx reads
    - bundle booking count is opt-in and uses active cancellation semantics
    - findActive is opt-in, day-inclusive and can include endsAt
    - active lookups prefer a dated version over a legacy NULL validFrom
    - draft fields, active lookup, atomic publish, succession and termination round-trip
    - legacy constructor keeps planKey storage and drops unsupported fields
    - latest live lookup excludes a version whose explicit endsAt elapsed
    - legacy onlyPublished reads the live versions, and a key names one plan
    - legacy onlyPublished omits a plan whose only version is a draft
    - token factories receive normalized schema options
- `packages/core/tests/active-plan-version-query.test.js`
    - requires publishedAt IS NOT NULL
    - tolerates validFrom IS NULL (
    - validUntil day-inclusive: &gt;= startOfDay(asOf), not &gt; asOf
    - startOfUtcDay normalizes to 00:00 UTC
    - without withEndsAt: no endsAt clause (CatalogPlanVersion)
    - withEndsAt: adds an endsAt clause (PlanVersion)
- `packages/nest/tests/a-preview-answers-on-an-older-schema.test.js`
    - answers, using the newest live version for the redundancy hint
    - and the same answer as a schema that does offer the lookup
    - a bundle the plan does not cover gets no redundancy warning either way
    - with no plan repository at all it still answers
    - a repository that offers the lookup and throws inside it is the bug itself
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Plans (validFrom tolerance)
        - live plan version with validFrom=NULL appears in the catalog
        - findActivePlanVersion returns the NULL-validFrom version when it is the only live one
        - dated version wins over NULL-validFrom (fallback, not an override)

<!-- END proof -->

### SC-PLAN-019 — Two operators cannot publish the same draft

🟢 The second one is told the draft has already been published rather than publishing it again.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-publish.test.js`
    - assertOptimisticLockHeld
        - accepts exactly 1 update
        - 0 updates → OPTIMISTIC_LOCK_CONFLICT
        - multiple updates → OPTIMISTIC_LOCK_CONFLICT

<!-- END proof -->

### SC-PLAN-020 — A draft built on a version that has since been retired has to be rebased

🟢 Publishing it as it stands would put an offer live that was written against something no longer
current.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-publish.test.js`
    - assertBaseVersionFresh
        - accepts a non-superseded base
        - null base → BASE_NOT_FOUND
        - superseded base → BASE_SUPERSEDED

<!-- END proof -->

### SC-PLAN-021 — A plan that is not sold self-service says so and says who to ask

🟢 A tenant meeting a negotiated plan is pointed at the contract manager rather than at a button that
will not work. A plan may also be one that cannot be left by self-service, which is the same idea
in the other direction.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-022 — Everything wrong with an uploaded catalogue is reported at once

🟢 An operator fixing a plan file sees every error in one pass rather than discovering them one round
trip at a time.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/generated-catalog-loads.test.js`
    - with a single quota
    - with several, including a camel-cased key
    - and with --skip-hasher, which does not touch the catalogue
    - the check is not vacuous — a hand-broken catalogue is refused
- `packages/nest/tests/plan-catalog-importer.test.js`
    - PlanCatalogImporterService
        - importFromYaml: first round → all created
        - importFromYaml: second run → all skipped (idempotent)
        - importFromYaml: plan without monthlyNet → warning + skip PlanVersion
- `packages/nest/tests/plan-catalog-loader.test.js`
    - loadPlanCatalogFromString accepts valid example
    - loadPlanCatalogFromString rejects schemaVersion != 1
    - loadPlanCatalogFromString rejects missing required fields
    - loadPlanCatalogFromString rejects addons block (#49 — no addon sales)
    - cross-field: plan references unknown featureKey → error
    - cross-field: duplicate plan IDs → error
    - cross-field: plannedOnly:true allows plan reference (roadmap marker)
    - crossFieldChecks: false skips consistency checks
    - loadPlanCatalogFromFile reads YAML file from disk
    - loadPlanCatalogFromFile throws for non-existent file
    - PlanCatalogValidationError contains error list
    - a catalogue without tenantBilling is refused, and the field is named
    - a rhythm nobody named is refused, rather than read as zero
    - a self-service list nobody named is refused too
    - empty lists and zeroes are values, not omissions
    - a negative notice period is refused
    - a fractional notice period is refused — days are whole
    - an unknown member of the block is refused, not ignored

<!-- END proof -->

### SC-PLAN-023 — A catalogue that cannot be read is the caller's mistake, not a server failure

🟢 It is answered as a rejected upload rather than as an internal error. A caller cannot otherwise
tell a bad file from a broken server, and the one they can fix is the one that looked unfixable.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/generated-catalog-loads.test.js`
    - with a single quota
    - with several, including a camel-cased key
    - and with --skip-hasher, which does not touch the catalogue
    - the check is not vacuous — a hand-broken catalogue is refused
- `packages/nest/tests/plan-catalog-loader.test.js`
    - loadPlanCatalogFromString accepts valid example
    - loadPlanCatalogFromString rejects schemaVersion != 1
    - loadPlanCatalogFromString rejects missing required fields
    - loadPlanCatalogFromString rejects addons block (#49 — no addon sales)
    - cross-field: plan references unknown featureKey → error
    - cross-field: duplicate plan IDs → error
    - cross-field: plannedOnly:true allows plan reference (roadmap marker)
    - crossFieldChecks: false skips consistency checks
    - loadPlanCatalogFromFile reads YAML file from disk
    - loadPlanCatalogFromFile throws for non-existent file
    - PlanCatalogValidationError contains error list
    - a catalogue without tenantBilling is refused, and the field is named
    - a rhythm nobody named is refused, rather than read as zero
    - a self-service list nobody named is refused too
    - empty lists and zeroes are values, not omissions
    - a negative notice period is refused
    - a fractional notice period is refused — days are whole
    - an unknown member of the block is refused, not ignored

<!-- END proof -->

### SC-PLAN-024 — The order plans appear in is set by moving them, not by typing numbers

🟢 An operator drags a row, or moves it with the keyboard, and the platform works out the priorities.
Gaps an operator deliberately left are preserved, and a plan with no live version has no handle to
grab, because there is nothing to order.

_Source:_ release 1.0.0-rc.4

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — comparison matrix (staircase sorting)
        - feature rows: widest coverage first, on a tie the leading plan column

<!-- END proof -->
