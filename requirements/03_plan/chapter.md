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

- `packages/nest/tests/plan-helpers.test.js`
    - findPlan returns a plan for a known ID
    - findPlan returns undefined for an unknown ID
    - getPlanOrThrow throws a typed error for an unknown ID
    - getMarketedPlans excludes marketed: false
    - getMarketedPlans treats undefined as marketed=true
    - getPlanPriceNet MONTHLY for a marketed plan
    - getPlanPriceNet YEARLY for a marketed plan
    - getPlanPriceNet for an unknown plan → null
    - getPlanPriceNet for ENTERPRISE (marketed: false) → null
    - getPlanPriceGross MONTHLY = net * 1.19
    - getPlanPriceGross with override vatRate
    - getPlanPriceGross for ENTERPRISE → null
    - getPlanQuota returns a concrete value
    - getPlanQuota returns -1 for unlimited ENTERPRISE quotas
    - getPlanQuota for an unknown plan/key → undefined
    - isFeatureInPlan: true when the feature is directly in the plan
    - isFeatureInPlan: false when the feature is not in the plan
    - isFeatureInPlan: false for an unknown plan
    - getActiveFeatureKeys excludes plannedOnly
    - isFeaturePlannedOnly: true for a declared plannedOnly key
    - isFeaturePlannedOnly: false for a declared production key
    - isFeaturePlannedOnly: false for an unknown key (conservative)
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
        - publishPlanVersion: lowering an installation's own quota → 422
        - publishPlanVersion: raising an installation's own quota publishes
        - publishPlanVersion: forceRegressive lets an own quota's cut through
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
        - publishPlanVersion: lowering an installation's own quota → 422
        - publishPlanVersion: raising an installation's own quota publishes
        - publishPlanVersion: forceRegressive lets an own quota's cut through
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

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/a-catalogue-remembers-its-versions.integration.test.js`
    - discarding a draft
        - a published version is refused — it is what somebody may have booked

<!-- END proof -->

### SC-PLAN-005 — A version somebody has already bought cannot be edited

🟢 💰 Only a draft can be changed, or a published version that is the newest of its line, has nobody
on it, and does not start until some day in the future.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/version-editability.test.js`
    - isVersionEditable
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
        - publishPlanVersion: lowering an installation's own quota → 422
        - publishPlanVersion: raising an installation's own quota publishes
        - publishPlanVersion: forceRegressive lets an own quota's cut through
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
    - isVersionEditable
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

- `packages/nest/tests/version-diff.test.js`
    - classifyPlanDiff — identical versions → no changes, nonRegressive=true
    - classifyPlanDiff — price increase → REGRESSION
    - classifyPlanDiff — price decrease → IMPROVEMENT
    - classifyPlanDiff — feature removed → REGRESSION
    - classifyPlanDiff — feature added → IMPROVEMENT
    - classifyPlanDiff — mixed: 1 improvement + 1 regression → nonRegressive=false
    - classifyPlanDiff — Decimal-like object with toNumber() accepted
    - classifyPlanDiff — quotas
        - a version with no quotas at all → no quota changes
        - limit increase → IMPROVEMENT, nonRegressive=true
        - limit decrease → REGRESSION, nonRegressive=false
        - an installation's own quota lowered → REGRESSION
        - an installation's own quota raised → IMPROVEMENT
        - a quota the successor drops counts as 0 → REGRESSION
        - a quota the successor adds counts from 0 → IMPROVEMENT
        - unlimited replaced by a finite number → REGRESSION
        - a key that names something on Object.prototype is still read as a quota
        - and dropping one is a regression like any other
        - a value written as a string is read as the number it is
        - the same allowance written twice is not a change
        - "-1" is unlimited, and losing it is a regression
        - a value nothing can read is not evidence of an improvement
        - and it reaches the record as what it was, not as nothing
        - every change survives the round trip through a JSON column
        - a number too large to be one is a regression, not the best offer ever
        - a finite number replaced by unlimited → IMPROVEMENT
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

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-diff.test.js`
    - classifyPlanDiff — identical versions → no changes, nonRegressive=true
    - classifyPlanDiff — price increase → REGRESSION
    - classifyPlanDiff — price decrease → IMPROVEMENT
    - classifyPlanDiff — feature removed → REGRESSION
    - classifyPlanDiff — feature added → IMPROVEMENT
    - classifyPlanDiff — mixed: 1 improvement + 1 regression → nonRegressive=false
    - classifyPlanDiff — Decimal-like object with toNumber() accepted
    - classifyPlanDiff — quotas
        - a version with no quotas at all → no quota changes
        - limit increase → IMPROVEMENT, nonRegressive=true
        - limit decrease → REGRESSION, nonRegressive=false
        - an installation's own quota lowered → REGRESSION
        - an installation's own quota raised → IMPROVEMENT
        - a quota the successor drops counts as 0 → REGRESSION
        - a quota the successor adds counts from 0 → IMPROVEMENT
        - unlimited replaced by a finite number → REGRESSION
        - a key that names something on Object.prototype is still read as a quota
        - and dropping one is a regression like any other
        - a value written as a string is read as the number it is
        - the same allowance written twice is not a change
        - "-1" is unlimited, and losing it is a regression
        - a value nothing can read is not evidence of an improvement
        - and it reaches the record as what it was, not as nothing
        - every change survives the round trip through a JSON column
        - a number too large to be one is a regression, not the best offer ever
        - a finite number replaced by unlimited → IMPROVEMENT

<!-- END proof -->

### SC-PLAN-025 — Every quota a version carries counts as a limit that can be lowered

🟢 Not only the three keys the platform once knew by name: which quotas exist is the installation's
decision, and one of its own being lowered is the same event to the customer it belongs to.
Add-on versions are compared the same way.

_Source:_ current practice

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-quota-is-read-one-way.test.js`
    - a quota is read the same way everywhere
        - a number is itself
        - a number written as a string is that number
        - anything that is not a finite number reads as nothing
        - and so does a number too large to be one
        - a record keeps what it can read and leaves out what it cannot
        - and anything that is not a record reads as an empty one
        - a key inherited from the prototype is not a quota
- `packages/nest/tests/a-quota-arrives-as-a-number.test.js`
    - a quota arrives as a number or it does not arrive
        - integers are accepted, and so is -1 for unlimited
        - an empty record is accepted — a version may carry no quota at all
        - a numeric string is refused, and the message names the key
        - "-1" is refused too — it is the value that would lock a tenant out
        - a fraction, a negative below -1, null and a nested object are refused
        - an array is not a quota record
        - the update DTO holds the same line, and leaving quotas out is still allowed
        - an add-on version is held to it as well — it is the same comparison
- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — Lifecycle
        - publishPlanVersion: lowering an installation's own quota → 422
        - publishPlanVersion: raising an installation's own quota publishes
        - publishPlanVersion: forceRegressive lets an own quota's cut through
- `packages/nest/tests/version-diff.test.js`
    - classifyPlanDiff — quotas
        - a version with no quotas at all → no quota changes
        - limit increase → IMPROVEMENT, nonRegressive=true
        - limit decrease → REGRESSION, nonRegressive=false
        - an installation's own quota lowered → REGRESSION
        - an installation's own quota raised → IMPROVEMENT
        - a quota the successor drops counts as 0 → REGRESSION
        - a quota the successor adds counts from 0 → IMPROVEMENT
        - unlimited replaced by a finite number → REGRESSION
        - a key that names something on Object.prototype is still read as a quota
        - and dropping one is a regression like any other
        - a value written as a string is read as the number it is
        - the same allowance written twice is not a change
        - "-1" is unlimited, and losing it is a regression
        - a value nothing can read is not evidence of an improvement
        - and it reaches the record as what it was, not as nothing
        - every change survives the round trip through a JSON column
        - a number too large to be one is a regression, not the best offer ever
        - a finite number replaced by unlimited → IMPROVEMENT

<!-- END proof -->

### SC-PLAN-011 — A published version says which day it applies from

🟢 Each successor starts strictly after the one before it, so for any given day there is exactly one
answer to "what was on offer".

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/a-bundle-version-has-a-window.integration.test.js`
    - two versions inside the same moment
        - the one whose window opened later wins
        - a version with no window at all loses to one that has a window it is inside
        - a closed window is excluded even when it is the later one
    - the edges of one window
        - a version is active throughout its last day, and not the next
        - a version is not active before its window opens
        - a bundle with no published version at all answers null, not an error
    - an adapter that does not promise windows
        - does not offer the method, rather than answering from columns it ignores
        - and hands back no window on a version that has one stored
- `packages/core/tests/active-plan-version-query.test.js`
    - buildActivePlanVersionWhere
        - requires publishedAt IS NOT NULL
        - tolerates validFrom IS NULL ("valid since forever") alongside validFrom &lt;= asOf
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
        - an explicit null end means unbounded, not "ask the draft"
        - a silent call still takes the draft’s end
- `packages/ui-vue/tests/newly-published-composables.test.js`
    - the barrels publish all four
        - every one of them arrived
    - attachCause
        - it attaches a cause without the ES2022 constructor option
        - it returns the same error rather than a copy
        - the property stays writable, the way the native one is
    - useMfaPrompt
        - a prompt opens the dialog and waits
        - a second prompt settles the first instead of stranding it
        - closing answers the caller with null
    - the plan wizard state
        - a provided state reaches a descendant
        - without a provider it hands back a fresh, unshared one
        - reset empties the draft
    - useSignOut
        - it ends the session and then goes to the login page
        - a rejecting logout still leaves the protected page
        - with no adapter it navigates anyway
        - the manifest cache is cleared whether or not an adapter ran

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
        - an explicit null end means unbounded, not "ask the draft"
        - a silent call still takes the draft’s end
- `packages/ui-vue/tests/version-maps.test.js`
    - useLivePlanVersions
        - the endpoint and the plan list are both required
        - an empty plan list asks nothing
        - the live version is the newest published one that was not superseded
        - two versions activated on the same day are ordered by version number
        - a plan with no published version maps to null, not to a missing key
        - one failing plan does not blank the others
        - an unreadable body is treated as no versions
        - a changed plan list reloads on its own; an unchanged one does not
    - useBundleVersionsMap
        - the endpoint and the bundle list are both required
        - an empty bundle list asks nothing and holds an empty mapping
        - every bundle gets its list, keyed by id
        - a bundle whose versions fail gets an empty list, not a missing key
        - an unreadable body becomes an empty list
        - refreshOne() replaces one entry and leaves the rest as they were
        - a failing refreshOne() leaves the previous entry standing

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
        - softDeletePlan: live version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: superseded version (no live anymore) → 422 PLAN_HAS_PUBLISHED_VERSIONS

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

- `packages/adapter-drizzle/tests/integration/an-operator-runs-the-plan-catalogue.integration.test.js`
    - the plans an operator has on sale
        - a plan is found by its key, and a key nobody took is not
        - listing is ordered by sort order, then by key
        - a retired plan drops out of the list, and comes back when asked for
        - onlyPublished hides a plan whose versions are all still drafts
        - a plan key cannot be claimed twice, so no version lineage is shared
        - a retired plan still occupies its key
        - renaming a plan touches what was named and nothing else
        - renaming a plan that is gone says so instead of writing nothing
        - deleting a plan twice is not an error
    - the versions behind a plan
        - drafts are numbered in order, and listed that way
        - the current draft is the unpublished one, and there is none once it ships
        - the latest live version is the newest unsuperseded one
        - a terminated version is not live any more
        - a draft can be edited, and only the named fields move
        - a version published for a future date can still be corrected
        - editing a version that is gone says so
        - a draft can be discarded, a published version cannot, and a missing one is a no-op
        - publishing the same draft twice fails the second time
    - a tenant's own writes
        - a scheduled change is written, and only while the row is uncancelled
        - an immediate change binds the plan and refuses once a cancellation lands
        - changing to a plan with no live version says so rather than binding nothing
        - an immediate change stays on its own connection when a version is pending
        - accepting a pending version is idempotent, and reports the second call as such
        - accepting when nothing is pending says so
        - a second cancellation returns the first one instead of replacing it
        - an operator ending a contract on the spot flips the status
    - the statements a tenant write sends
        - an ordinary cancellation never names the status column
        - ending a contract on the spot does name it
        - an immediate change locks the row it decides from
    - the subscription a tenant is shown
        - a tenant with no subscription reads as none, not as an error
        - the dates and the plan version a person is shown all come back
        - a pending version comes with what a person needs to decide
        - the version a subscription is billed for cannot be deleted underneath it
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

### SC-PLAN-018 — The version that applies is the one valid on the day of the purchase

🟢 💰 Not the newest one, and not the one the pricing page happened to be showing.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-plan-binding.test.js`
    - Prisma plan binding options
        - the omitted schema preserves every 0.6 plan default
        - normalized mode resolves both directions
    - normalized plan identity across Prisma adapters
        - catalog read uses the catalog delegate and exposes semantic planKey
        - catalog import resolves planKey to UUID and writes only the catalog delegate
        - entitlement and subscription adapters use their delegate and map UUID back
        - active subscription counts use authoritative PlanVersions
        - a subscription that has ended is not an active tenant
        - all subscription operations honor tenantSubscription.delegate, including tx reads
        - bundle booking count is opt-in and uses active cancellation semantics
        - findActive is opt-in, day-inclusive and can include endsAt
        - active lookups prefer a dated version over a legacy NULL validFrom
    - PrismaPlanRepository normalized lifecycle
        - draft fields, active lookup, atomic publish, succession and termination round-trip
        - legacy constructor keeps planKey storage and drops unsupported fields
        - latest live lookup excludes a version whose explicit endsAt elapsed
        - legacy onlyPublished reads the live versions, and a key names one plan
        - legacy onlyPublished omits a plan whose only version is a draft
    - prismaPersistence schema forwarding
        - token factories receive normalized schema options
- `packages/core/tests/active-plan-version-query.test.js`
    - buildActivePlanVersionWhere
        - requires publishedAt IS NOT NULL
        - tolerates validFrom IS NULL ("valid since forever") alongside validFrom &lt;= asOf
        - validUntil day-inclusive: &gt;= startOfDay(asOf), not &gt; asOf
        - startOfUtcDay normalizes to 00:00 UTC
        - without withEndsAt: no endsAt clause (CatalogPlanVersion)
        - withEndsAt: adds an endsAt clause (PlanVersion)
- `packages/nest/tests/a-preview-answers-on-an-older-schema.test.js`
    - a bundle preview on a schema without validity windows
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
- `packages/ui-vue/tests/resolve-plans.test.js`
    - resolvePlans
        - picks the currently valid version as the live one
        - falls back to the next scheduled version when nothing is live
        - gives a plan with only drafts a row without a version
        - marks a plan expired only when nothing is left to come
        - lists sub-rows without repeating the parent
        - sorts by sortOrder, then by key
    - countPlans
        - counts what the tiles above the list show

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

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding throws ForbiddenException for blocked self-service plans

<!-- END proof -->

### SC-PLAN-022 — Everything wrong with an uploaded catalogue is reported at once

🟢 An operator fixing a plan file sees every error in one pass rather than discovering them one round
trip at a time.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/an-operator-runs-the-plan-catalogue.integration.test.js`
    - the plans an operator has on sale
        - a plan is found by its key, and a key nobody took is not
        - listing is ordered by sort order, then by key
        - a retired plan drops out of the list, and comes back when asked for
        - onlyPublished hides a plan whose versions are all still drafts
        - a plan key cannot be claimed twice, so no version lineage is shared
        - a retired plan still occupies its key
        - renaming a plan touches what was named and nothing else
        - renaming a plan that is gone says so instead of writing nothing
        - deleting a plan twice is not an error
    - the versions behind a plan
        - drafts are numbered in order, and listed that way
        - the current draft is the unpublished one, and there is none once it ships
        - the latest live version is the newest unsuperseded one
        - a terminated version is not live any more
        - a draft can be edited, and only the named fields move
        - a version published for a future date can still be corrected
        - editing a version that is gone says so
        - a draft can be discarded, a published version cannot, and a missing one is a no-op
        - publishing the same draft twice fails the second time
    - a tenant's own writes
        - a scheduled change is written, and only while the row is uncancelled
        - an immediate change binds the plan and refuses once a cancellation lands
        - changing to a plan with no live version says so rather than binding nothing
        - an immediate change stays on its own connection when a version is pending
        - accepting a pending version is idempotent, and reports the second call as such
        - accepting when nothing is pending says so
        - a second cancellation returns the first one instead of replacing it
        - an operator ending a contract on the spot flips the status
    - the statements a tenant write sends
        - an ordinary cancellation never names the status column
        - ending a contract on the spot does name it
        - an immediate change locks the row it decides from
    - the subscription a tenant is shown
        - a tenant with no subscription reads as none, not as an error
        - the dates and the plan version a person is shown all come back
        - a pending version comes with what a person needs to decide
        - the version a subscription is billed for cannot be deleted underneath it
- `packages/cli/tests/generated-catalog-loads.test.js`
    - the catalogue init writes is one the platform accepts
        - with a single quota
        - with several, including a camel-cased key
        - and with --skip-hasher, which does not touch the catalogue
        - the check is not vacuous — a hand-broken catalogue is refused
    - either init refuses the input, or the platform accepts the output
        - JSON.stringify(input)
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
    - the catalogue init writes is one the platform accepts
        - with a single quota
        - with several, including a camel-cased key
        - and with --skip-hasher, which does not touch the catalogue
        - the check is not vacuous — a hand-broken catalogue is refused
    - either init refuses the input, or the platform accepts the output
        - JSON.stringify(input)
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
- `packages/ui-vue/tests/reorder-priorities.test.js`
    - reorderedPriorities
        - a move within equal priorities produces the order it promises
        - it keeps the gaps an operator chose
        - rows that keep their value are reported as unchanged
        - no move, no writes
        - a value at the top of the range stays inside it
        - a list already at the ceiling still separates
        - pulling ties apart never goes below zero
        - a move to the end lands at the end
- `packages/ui-vue/tests/resources-plans.test.js`
    - bindResource
        - supplies http and context, leaving the operation its own arguments
        - binds every operation the resource declares, and nothing else
        - reads a context getter per call, so a changed endpoint is picked up
    - plansResource
        - list addresses the plan catalogue
        - list turns an empty response into an empty list, not null
        - tenantCounts has its own path and the same scoping
        - tenantCounts turns an empty response into an empty map
        - create posts to the unscoped collection — the body carries the project
        - update patches the plan by id
        - softDelete and hardDelete are different endpoints
        - a delete tolerates both an empty response and one with a body
    - planVersionsResource
        - reading versions goes through the plan
        - creating a draft goes through the plan too
        - but every mutation of an existing version addresses the version directly
        - discarding a draft deletes the version, not the plan
        - listForPlan turns an empty response into an empty list
    - the shared request policy
        - sends a JSON content type
        - a caller header wins over the default
        - serialises the body — the transport only carries strings
        - sends no body when there is none, rather than the string "undefined"
        - a client that resolved with no status never reads as an answer
        - a 204 and an unparsable 2xx both read as no body
        - a non-2xx throws an AdminError carrying the parsed body and the code
        - what the server said survives — a page must not lose actionable text
        - a validation array is joined here too, not only in the JSON helper
        - a non-2xx without a readable body still reports its status
        - a mutation that answers with nothing is a failure, not a null
        - each empty-body failure names the operation it came from
        - publish with no options sends an empty payload, not nothing
        - a request with no init at all defaults to GET
        - requestJsonBody names the default method when it has no init either
        - a non-string code on the body is not treated as a code
        - a non-2xx whose body is not an object still carries what came back
        - requestJsonBody passes a present body through untouched
- `packages/ui-vue/tests/use-plans.test.js`
    - usePlans — construction
        - refuses to run without an endpoint, because the platform cannot guess it
        - does not load until asked
        - autoLoad fires exactly one request
    - usePlans — load
        - fills the list and clears loading
        - an empty response is an empty list, not a failure
        - a failure lands in error and does not escape
        - tenantCounts failing is swallowed on purpose and leaves an empty map
    - usePlans — mutations keep the list in step
        - create appends what came back
        - update replaces in place, keeping the order
        - softDelete removes the row
        - a rejected delete leaves the row where it was
        - a create that answers with nothing is a failure, not a silent no-op
    - usePlanVersions
        - needs both an endpoint and a plan
        - load fills the versions
        - createDraft appends the nested version, not the whole result
        - publish replaces the version in place
        - discardDraft removes it
        - terminateVersion replaces the version with what came back
        - its errors carry the API name they came from

<!-- END proof -->
