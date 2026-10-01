---
title: What a tenant may do at runtime
---

Everything above decides what was sold. This chapter is about the moment it is applied: a request
arrives, and the answer has to be the one the contract gives. These are the requirements an
integrating developer relies on most directly, because a mistake in them is either a customer
paying for something they cannot use or using something they did not pay for.

### SC-ENTL-001 — What a tenant may do is their plan plus the add-ons they booked

🟢 Features are the union; limits add up.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - aggregateLimits — main aggregator
        - plan default without bundles
        - plan + bundle quotas sum additively
        - bundle features add to the features set
        - plannedOnly features are consistently hidden
        - customLimits.quotas overrides plan + bundles
        - canceled bundles (canceledEffectiveAt &lt; now) are not included
        - bundle quota in a quota dimension the plan does not have is passed through
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — deriveLimits + Resolution
        - TRIAL: uses trialEntitlementPlan via DB lookup
        - TRIAL: the plan the trial grants is read at its version on sale at that moment
        - Pilot with config: pilotEntitlementPlan overrides
- `packages/nest/tests/entitlement-subscription-bundle-aggregation.test.js`
    - SubscriptionBundle aggregation (P11.7.3)
        - filterActiveSubscriptionBundles: canceled with a past effective date are dropped
        - aggregateSubscriptionBundleQuotas: Σ per key, -1 dominates
        - collectSubscriptionBundleFeatures: set union
        - aggregateLimits: bundle quotas add to plan quotas + bundle features are included
        - aggregateLimits: canceled bundle is ignored
        - aggregateLimits: -1 in a bundle quota makes the total quota unlimited
        - aggregateLimits without subscriptionBundles → plan-only behavior unchanged

<!-- END proof -->

### SC-ENTL-002 — An unlimited allowance beats any number, and an absent one counts as none

🟢 So a single unlimited grant cannot be diluted by adding numbers to it, and a limit nobody set is
not silently generous.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - aggregateLimits — main aggregator
        - plan default without bundles
        - plan + bundle quotas sum additively
        - bundle features add to the features set
        - plannedOnly features are consistently hidden
        - customLimits.quotas overrides plan + bundles
        - canceled bundles (canceledEffectiveAt &lt; now) are not included
        - bundle quota in a quota dimension the plan does not have is passed through
- `packages/nest/tests/entitlement-subscription-bundle-aggregation.test.js`
    - SubscriptionBundle aggregation (P11.7.3)
        - filterActiveSubscriptionBundles: canceled with a past effective date are dropped
        - aggregateSubscriptionBundleQuotas: Σ per key, -1 dominates
        - collectSubscriptionBundleFeatures: set union
        - aggregateLimits: bundle quotas add to plan quotas + bundle features are included
        - aggregateLimits: canceled bundle is ignored
        - aggregateLimits: -1 in a bundle quota makes the total quota unlimited
        - aggregateLimits without subscriptionBundles → plan-only behavior unchanged

<!-- END proof -->

### SC-ENTL-003 — A feature declared as not yet rolled out is never granted

🟢 Wherever it comes from — a plan, an add-on, or a negotiated arrangement. It can be advertised in
the catalogue and still not be handed over. A tenant's entitlements are answered from a cache up to
a minute old (`SC-PLAN-026`), so a feature marked as planned only stops being granted within that
minute.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - filterPlannedOnlyFeatures
        - plannedOnly features are filtered out
        - unknown features (not in catalog) stay in
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — a feature the catalog says is not built yet
        - a contract snapshot that carries it grants everything else instead
        - a contract line item that carries it is treated the same
        - a successor reached through a replaces chain does not slip past it
        - a successor that is built is still granted through the same chain
        - a contract keeps everything the catalog does say is built
        - a feature the catalog has never heard of is left alone
    - EntitlementService — a feature marked planned only after the service was built
        - is granted at most a minute longer, the time a cached answer may be old
        - a caller that read the catalogue gets the answer computed from that reading
        - a reading handed in does not become the answer for everybody else

<!-- END proof -->

### SC-ENTL-004 — Once a contract is agreed, it is the truth about what the tenant may do

🔵 _(Superseded on 2026-08-31 by `SC-ENTL-021`.)_ Catalogue edits do not reach a running contract.

_Source:_ `docs/explanation/capability-to-contract.md` · `README.md`

### SC-ENTL-021 — A commercial edit does not reach a running contract; a feature losing its code does

🟢 What was sold stays sold: a price, a quota or a feature set changed in the catalogue leaves an
agreed contract alone. The one edit that does reach it is a feature marked as not yet rolled out,
because that is not a statement about the offer but about whether the capability exists —
`SC-ENTL-003` holds there too, and granting a feature with no code behind it would only weaken the
guard in front of it.

_Source:_ `docs/explanation/capability-to-contract.md` · `README.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - toEffectiveLimitsSnapshot
        - set becomes sorted array (deterministic)
        - snapshot is independent of the original quota object (deep copy)
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — deriveLimits + Resolution
        - TRIAL: uses trialEntitlementPlan via DB lookup
        - TRIAL: the plan the trial grants is read at its version on sale at that moment
        - Pilot with config: pilotEntitlementPlan overrides
    - EntitlementService — V3 ContractLineItems
        - reads entitlements from active contract snapshot without catalog join
        - Contract entitlementSnapshot wins over line-item aggregation

<!-- END proof -->

### SC-ENTL-022 — An operator is told which running contracts hold a feature vocabulary left behind

🟢 A contract keeps the feature keys it was frozen with, so a key renamed, dropped or added in a plan
version afterwards does not reach it (`SC-ENTL-021`). `<app> doctor` names each contract in force
whose frozen features hold a key that neither the application's code nor the catalogue knows any
more, or lack a feature that the plan version its subscription is bound to and the add-on versions
it covers grant today and that no `replaces` declaration carries one of its keys to. It names them
and changes nothing.

_Source:_ #73

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/contracts-refresh-cli-flow.test.js`
    - `&lt;app&gt; doctor` about the contracts in force
        - without frozen contracts there is nothing to look at
        - contracts on today’s vocabulary pass
        - a contract behind is a warning that names it, its keys, and the command to look further
        - it names five and counts the rest
        - a contract that could not be compared is a warning with its reason, never a pass
        - contracts that cannot be read are an error
- `packages/nest/tests/an-operator-carries-a-vocabulary-into-running-contracts.test.js`
    - what `doctor` is told
        - a contract frozen before a rename holds a key the code dropped and lacks its successor
        - a replaces declaration that carries the old key over leaves nothing to report
        - a contract frozen with today’s vocabulary is not reported
        - a contract whose features today cannot be read is named as such, not passed as current
        - inspecting writes nothing
- `packages/nest/tests/what-a-contract-refresh-would-change.test.js`
    - the vocabulary a contract has fallen behind
        - a frozen key nothing knows is unknown; a key granted today and not frozen is missing
        - a renamed key a replaces declaration carries over is neither

<!-- END proof -->

### SC-ENTL-023 — An operator carries a changed vocabulary into running contracts, seeing it first

🟢 Only on the operator's command, for the contracts named or for every contract in force — never by
itself (`SC-ENTL-021`). For each contract the command first shows what it would change: its
features, quotas, price, tax rate and currency. It writes only when asked a second time. By default
it replaces the frozen features alone, with those the plan version and the add-on versions the
contract covers grant today, and copies the lines, prices, terms and parties as they stand. Asked to
re-freeze in full, it composes the features, quotas and lines the way a plan change would — which
also leaves out an add-on whose cancellation is declared — while keeping what the contract agreed
beyond money, such as its terms and its minimum terms, and refuses each contract whose price, tax
rate or currency would change, naming it for a decision by hand: a price edited into a plan version
in place does not reach a customer this way. Either way the contract in force is kept, superseded,
beside the successor that replaces it (`SC-AUD-007`).

_Source:_ #73

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/contracts-refresh-cli-flow.test.js`
    - the preview is the command, and the write is the second one
        - without --apply it previews, asks who is asking, and asks for no confirmation
        - --apply writes, after the confirmation production asks for
        - --full asks for a full re-freeze
        - a selection is required, and only one kind of it — refused before anything is read
    - what it prints and which exit code a script sees
        - a preview names each change and says that nothing was written
        - an apply that wrote everything exits 0 and names the successor
        - one contract refused or moved makes the exit code 6, after the others were written
        - the command runs the preview without --apply and the write with it, and sets the exit code
        - --contract repeats, and --output json prints the results as they are
- `packages/nest/tests/a-successor-replaces-the-contract-in-force.test.js`
    - a successor that copies its lines as they stand
        - gives rise to no charge of its own, in its first period or after
- `packages/nest/tests/an-operator-carries-a-vocabulary-into-running-contracts.test.js`
    - carrying the features over
        - the preview shows the change and writes nothing
        - applied, a successor grants the new key and the contract it replaces is kept, superseded
        - lines, prices, terms, window and quotas are copied as they stand
        - the parties are the ones agreed, not a correction made since — and a migrated copy stays
          marked
        - a contract whose features are already today’s is left as it is
        - a subscription bound to another version than the contract records is refused, and named
        - the quotas of a cancelled add-on stay: replacing features changes nothing it counts
        - the refresh is in the audit log, with the contract it replaced
    - re-freezing in full
        - leaves a cancelled add-on out of the snapshot, names it, and keeps billing it
        - a price edited into the plan version in place is refused, named, and not written
        - a tax rate changed in the configuration is refused
        - a currency changed in the configuration is refused
        - keeps the terms, the offer and each line’s minimum term the contract agreed
        - with the money unchanged, it carries the renamed feature too
    - what the refresh is asked about
        - a contract named that is not in force is refused, and so is one that does not exist
        - a contract that moves between the read and the write is left alone, and said so
- `packages/nest/tests/what-a-contract-refresh-would-change.test.js`
    - money
        - a successor that charges the same is no change, whatever version its lines name
        - a price edited into the version is named, on the total and on the line
        - a tax rate and a currency are changes of their own
        - a line on one side only is named with its price

<!-- END proof -->

### SC-ENTL-005 — A request for something the contract does not include is refused

🟢 🔒 And the refusal may carry what would unlock it, so the tenant is told how to proceed rather than
only that they may not. Where several features would each admit the request, having any one of
them is enough.

_Source:_ `README.md` · `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - hasFeature / hasAnyFeature
        - hasFeature matches
        - hasAnyFeature: at least one is enough
        - hasAnyFeature: empty list → false
- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — annotation evaluation
        - lets routes without @RequireFeature pass unchecked
        - @RequireFeature with an empty array passes unchecked
    - FeatureGuard — feature set matching
        - lets the tenant through when the feature is active in the plan
        - blocks with ForbiddenException when the feature is missing
        - Logical OR: multiple features, one suffices (second matches)
        - Logical OR: none match → Forbidden with all keys in the message
        - Class-level annotation applies when the handler has none
        - Handler annotation overrides class annotation

<!-- END proof -->

### SC-ENTL-006 — A missing feature and an exhausted limit are told apart

🟢 They are two different answers, and a client can act differently on each. An exhausted limit says
which limit and where the tenant stands against it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/feature-guard.test.js`
    - StaticFeatureGuard — FEATURE_NOT_LICENSED body
        - emits the full FeatureNotLicensedBody with empty offers
- `packages/nest/tests/limit-exceeded-filter.test.js`
    - LimitExceededFilter
        - responds with HTTP 402 + standard body shape
        - carries the quota dimension correctly from the exception
        - lets floating-point `used`/`max` pass through for storage
        - robust when method/url are missing from the request

<!-- END proof -->

### SC-ENTL-007 — Two simultaneous requests cannot both take the last remaining unit of a limit

🟢 🔒 Counting and then writing happens as one indivisible step per tenant; otherwise two requests
that each fit both go through and the limit an operator sold is not the limit that applies.

_Source:_ `docs/explanation/data-model.md` · `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - the read that decides takes the row lock
        - enforcing a limit reads the subscription locked, never plainly
        - the count and the write happen while it is still held
    - EntitlementService.enforceLimit — forwards tx to lookup ports (#70)
        - contract, bundle and bundle-version lookups receive the runner tx

<!-- END proof -->

### SC-ENTL-008 — A single large action can be refused by a limit it would cross in one go

🟢 The check is against what the action would consume, not against a single unit, so one ten-gigabyte
file does not fit under a one-gigabyte allowance.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService.enforceLimit — a limit nobody can read
        - a dimension the plan does not declare is a misconfiguration
        - a declared quota that cannot be read lets the request through

<!-- END proof -->

### SC-ENTL-009 — The declarative check is a guard, not a guarantee

🟢 Applied to a route it is deliberately a soft check and can be raced. Where a limit must hold
exactly, the transactional path is the one to use, and the difference is stated rather than
implied.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — annotation evaluation
        - lets routes without @RequireFeature pass unchecked
        - @RequireFeature with an empty array passes unchecked

<!-- END proof -->

### SC-ENTL-010 — A limit nothing can count does not block anybody

🟢 The request goes through and the gap is reported for review, rather than a tenant being refused
because an installation has not finished wiring a counter.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService.enforceLimit — a limit nobody can read
        - a dimension the plan does not declare is a misconfiguration
        - a declared quota that cannot be read lets the request through
- `packages/nest/tests/saasicat-module.test.js`
    - StaticEntitlementService (via StaticPlanResolver)
        - snapshot returns features+quotas from the plan catalog
        - hasFeature + quotaLimit as convenience methods
        - snapshot with an unresolved plan = empty set

<!-- END proof -->

### SC-ENTL-011 — Enforcing a limit nobody declared is the installation's fault, not the tenant's

🟢 It is answered as a misconfiguration rather than as a refusal the tenant could do something about.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService.enforceLimit — a limit nobody can read
        - a dimension the plan does not declare is a misconfiguration
        - a declared quota that cannot be read lets the request through
- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — config hooks
        - tenantContextRunner wraps the computeLimits call (RLS consumers)
        - userRoleResolver allows a project-specific role source
        - tenantIdResolver can fetch tenantId from an alternative field

<!-- END proof -->

### SC-ENTL-012 — A cancellation that has taken effect grants nothing

🟢 🔒 No features, no limits. Until this rule existed, a subscription cancelled eight months earlier
was granted exactly what it was granted while active.

_Source:_ #219 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-landed-cancellation-ends-what-it-granted.test.js`
    - once the cancellation has taken effect
        - nothing is granted
        - the plan is still named, so a page can say which one ended
        - a configured floor is granted instead
        - and the floor does not inherit what was bought on top
        - a contract signed earlier does not outlive it

<!-- END proof -->

### SC-ENTL-013 — A cancellation that is merely declared changes nothing

🟢 A subscription cancelled in month three of a year runs, is billed and keeps everything until the
term ends.

_Source:_ #219

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a cancellation still to come
        - lets the plan change, and does not sell a term it cuts short
        - while an uncancelled subscription does get a fresh term
- `packages/nest/tests/a-landed-cancellation-ends-what-it-granted.test.js`
    - while a subscription is running
        - it is granted its plan
        - and a cancellation still to come changes nothing
- `packages/ui-vue-tenant/tests/component/a-cancelled-plan-still-runs.test.ts`
    - while nothing is cancelled
        - the tenant is offered the act
        - and told nothing about a cancellation
    - once it is cancelled
        - the date is shown, not just the word
        - and the subscription is described as unchanged until then
        - the act is no longer offered
        - changing plan still is

<!-- END proof -->

### SC-ENTL-014 — An installation may name a floor a cancelled subscription falls back to

🟢 A read-only tier a former customer can export from, or a free plan, instead of nothing. Add-on
bookings and negotiated limits are not carried into it, because those belonged to the subscription
that ended.

_Source:_ #219 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-landed-cancellation-ends-what-it-granted.test.js`
    - once the cancellation has taken effect
        - nothing is granted
        - the plan is still named, so a page can say which one ended
        - a configured floor is granted instead
        - and the floor does not inherit what was bought on top
        - a contract signed earlier does not outlive it

<!-- END proof -->

### SC-ENTL-015 — The end of a subscription is seen on every enforcement path

🟢 A rule written into one of two paths is enforced in half the applications, and two paths that
disagree about what a cancelled subscription keeps would be worse than either answer alone.

_Source:_ #219

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-landed-cancellation-ends-what-it-granted.test.js`
    - a cancellation older than the fields that describe it
        - is read from the only column it has
        - and a legacy row whose date is still to come keeps everything
- `packages/nest/tests/both-enforcement-paths-see-the-end.test.js`
    - the default enforcement stack
        - grants nothing once the cancellation has landed
        - grants the configured floor instead, where one is configured
        - while a cancellation still to come grants everything
        - and an uncancelled subscription is unaffected
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - what else ends when the subscription does
        - the frozen contract is ended on the same date
        - and a cancellation already recorded repairs its contract too
        - and a consumer without contracts is unaffected

<!-- END proof -->

### SC-ENTL-016 — An answer computed before an end date arrives is not served after it

🟢 A date arriving is not a change anybody makes, so nothing would invalidate a remembered answer by
itself.

_Source:_ #219

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancelled-add-on-ends-on-its-date.test.js`
    - a remembered answer and a cancelled add-on
        - an answer computed before the date is not served on it
- `packages/nest/tests/both-enforcement-paths-see-the-end.test.js`
    - a cached answer at the cancellation boundary
        - is not served past the moment it ends
        - and is still served inside its ordinary lifetime
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — computeLimits + Cache
        - returns plan default limits for STANDARD
        - second call on the same tenant does NOT hit the DB
        - NotFound for unknown tenant
        - invalidateTenant forces a re-read
        - TTL: reloads after &gt;60 s
        - different tenants are cached separately

<!-- END proof -->

### SC-ENTL-017 — A feature that was renamed keeps working for customers who bought the old name

🟢 An existing contract holding a superseded key grants its successors, and keeps the old one too, so
a rename in the catalogue is never a silent downgrade for somebody already paying.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-018 — An offer shown alongside a refusal is one the tenant could actually buy

🟢 Only currently marketed, live add-ons are offered, ranked by how much of what is missing they
cover and then by price. A failure to work out an offer never turns a correct refusal into a
server error.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-bundle-upsell-resolver.test.js`
    - CatalogBundleUpsellResolver
        - returns published+marketed bundles that contain the missing feature
        - non-marketed and draft bundles are not offers
        - without requires data the cheaper price wins
        - requires known (#35): combo bundle with dependency ranks before cheaper single bundle
        - bundle that contains only the dependency (not the feature) is not an offer
        - currency comes from the optional currency token, default EUR
        - priceless bundle (pricing override only) yields priceMonthlyNet null and ranks last
        - empty featureKeys → no offers, no repo access
- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — upsell response (#36)
        - structured 403 body: code, featureKey, featureKeys, offers, message
        - Logical OR: featureKeys carries all required keys, featureKey the first
        - Resolver error degrades to offers: [] instead of 500
        - Resolver is not called for a licensed feature
        - without a resolver: full body with empty offers
    - UPSELL_OFFER_RESOLVER_TOKEN
        - is a Symbol.for token (process-wide registry)

<!-- END proof -->

### SC-ENTL-019 — A platform administrator is not blocked by a tenant's entitlements

🟢 🔒 Support can act on a tenant's behalf without the tenant having bought the feature being used.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — auth paths
        - SUPER_ADMIN bypasses the feature check
        - SUPER_ADMIN via `platformRole` is detected
        - missing user → Forbidden ("Not authenticated")
        - missing tenantId → Forbidden ("No tenant assigned")
        - tenantId from request.tenantId takes precedence over user.tenantId

<!-- END proof -->

### SC-ENTL-020 — Hiding a control is not protection

🟢 🔒 The interface hides what the backend would refuse; the refusal is what protects it. A tenant who
constructs the request by hand gets the same answer.

_Source:_ `docs/guides/build-the-admin-frontend.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — feature set matching
        - blocks with ForbiddenException when the feature is missing

<!-- END proof -->

### SC-ENTL-024 — Negotiated limits are applied, and a stored shape that cannot be read is reported

🟢 A negotiated contract or a pilot can give one tenant limits beside its plan: a quota replaces the
plan's value, a feature is added to the plan's. They are stored in one shape, `{ quotas, features }`.
A stored value in any other shape does not block the tenant — it stays on what its plan allows, as a
limit nothing can count does not block anybody (`SC-ENTL-010`) — and the part that was not applied
is named in the log, once for each subscription, rather than being dropped without a word.

_Source:_ #354

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/negotiated-limits-are-read-one-way.test.js`
    - a stored customLimits value
        - none stored is none
        - the platform shape is read whole
        - a quota value nothing can count is left out, so the plan applies, and is named
        - a key the platform does not read is named, and the rest is still read
        - quotas or features of the wrong kind are named rather than guessed at
        - a value that is not an object is not read at all, and says so
    - reading limits for an adapter
        - reports what went unread once per subscription, naming it
        - hands back what it could read
- `tests/the-api-schema-names-the-limits-the-platform-reads.test.js`
    - the admin API schema for negotiated limits
        - names exactly the keys the platform reads
        - every route that carries them refers to it
        - a value written to the schema is read whole

<!-- END proof -->
