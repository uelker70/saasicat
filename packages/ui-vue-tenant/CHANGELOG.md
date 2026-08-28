# @saasicat/ui-vue-tenant

## 1.0.0-rc.8

### Minor Changes

- 1e9b842: Plan change preview issues are now translatable

    The blockers and warnings a plan change preview returns used to be English
    sentences with their numbers already baked in — "Current usage 11 exceeds the
    target limit 5 (vehicles)". They travel in a 200 response, so no error handling
    could reach them, and a tenant read them in English whatever language they had
    chosen. No client could rebuild the sentence, because the values existed only
    inside it.

    Every issue now carries a code from `BILLING_ERROR_CODES` and the values it
    talks about in `params`, and both catalogues carry the text. Three codes that
    were constructed per case collapsed into one each with a parameter:
    `QUOTA_OVER_TARGET` takes the quota key, `PLAN_LOCKED` and
    `PLAN_NOT_SELF_SERVICE` needed none. `PlanChangePreviewIssue` gained the
    optional `params` field, and `@saasicat/ui-vue` exports
    `PlanChangePreviewIssueShape` for consumers rendering the list themselves.

    `resolveErrorMessage` accepts a body whose `code` is any string, so a consumer
    can pass an issue through the same ladder as every other coded failure without
    casting: their own catalogue, the shipped one for the active locale, then the
    English message the backend sent, then the bare code. Interpolation reads
    `params` first and the top-level body second.

    Rendering an issue's `message` directly still works and still returns English.
    Consumers who want the tenant's language read `code` and `params` instead —
    `examples/notesapp` shows the seam.

    Once an issue is said in the tenant's language, the shipped sentence has to say
    as much as the English prose it replaces. Two of them did not.

    `PLAN_NOT_SELF_SERVICE` read "{planKey} is not activated via self-service." —
    an installation's internal key, and no hint of what to do next. Its text now
    names the plan and gives the instruction the preview's prose gave, and every
    site raising it carries `planName`: the catalogue name where a catalogue is
    loaded, the key where the refusal is decided before one is read.

    The plan-change preview's booked-bundle blocker has its own code,
    `BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE`. It shared `BUNDLE_CYCLE_EXCEEDS_PLAN`
    with the booking route, whose sentence states the rule for a booking nobody has
    made yet — so the shared text could name neither the day the booking runs to
    nor the one action that clears it. A consumer switching on
    `BUNDLE_CYCLE_EXCEEDS_PLAN` in a **plan-change** preview reads the new code
    instead; the booking and bundle-preview routes are unchanged.

    And the language itself was the wizard's own choice rather than the app's.
    `TenantPlanSectionI18n` and `PlanChangeWizardI18n` gained `issueMessages`, the
    per-code texts the plan-change wizard renders its blockers and warnings from.
    The wizard used to choose between the two shipped catalogues itself, so an app
    adding a language through `additionalLocales` — or passing its own `i18n` map —
    got its wording on the controls and German or English underneath them, with
    nowhere to say otherwise. Blockers now come out of the same object as every
    other string. Apps that pass a partial `i18n` need no change; one that builds a
    whole map by hand adds the field, and an untranslated code still falls back
    through the shipped English text to the `message` the backend sent.

### Patch Changes

- 1e9b842: Two tenant notice boxes get their corners back

    `TenantPlanSection`'s late-notice warning and `PlanChangeWizard`'s deferral
    block both read `var(--sa-radius-md)`. The theme's radius ladder is named by
    role rather than by size and has no `-md` step, and an undefined custom
    property makes CSS drop the declaration around it — so both elements rendered
    with square corners beside five sibling notice boxes that were rounded. They
    read `--sa-radius-badge` now, the step every other tone-surface block in the
    package already used.

    Nothing in this repository resolved those variables: the package ships its
    source, so the declarations are compiled by the consumer's bundler against the
    roles their copy of `@saasicat/ui-vue/theme.css` defines. A repository test now
    compares the roles the package reads against the roles that theme entry
    declares, and fails on a read with neither a definition nor a fallback.

- Updated dependencies [1e9b842]
    - @saasicat/core@1.0.0-rc.8
    - @saasicat/ui-vue@1.0.0-rc.8

## 1.0.0-rc.7

### Minor Changes

- d492281: A bundle runs in step with the plan that pays for it

    A booked bundle had no period of its own. It was billed alongside the plan by
    convention, which held only for as long as every bundle was billed in the plan's
    rhythm. `subscription_bundles` now carries `billingCycle`, `currentPeriodStart`
    and `currentPeriodEnd`, and one rule governs them: a bundle's periods end on the
    day the plan's do. The first is short, from the booking to the next occurrence of
    that day, and is charged pro rata for exactly that stretch; every one after it
    runs anchor to anchor, and the last lands on the day the plan ends. Aligning at
    booking means a bundle never has to be trimmed at the end, which is the case
    where somebody was committed to more than they received.

    A bundle may run in a shorter rhythm than its plan and never a longer one, so a
    yearly bundle beside a monthly plan is refused with `BUNDLE_CYCLE_EXCEEDS_PLAN`
    rather than modelled. The tenant preview now accepts the same `billingCycle` the
    booking has always accepted — without it, asking for a monthly bundle beside a
    yearly plan was quoted the yearly price, prorated across the plan's year, and
    then charged the monthly one. It also prorates against the bundle's own cycle
    rather than the plan's, and states what the booking commits to before it is
    confirmed: the first period's end, the plan's end where there is one, and that a
    period cut short by the plan ending is not refunded.

    A bundle version can no longer be published without a price, and the gate asks
    two questions rather than one. `BUNDLE_VERSION_NO_PRICE` refuses a version from
    which nothing resolves at all. `BUNDLE_VERSION_NOT_PRICED_FOR_PLAN` refuses one
    that a plan it is offered to could not buy — the plans come from the version's
    own compatibility, the cycles from the prices each plan version carries, so a
    bundle priced monthly only and offered to a plan sold yearly is caught at the
    operator's desk instead of a tenant's checkout. A booking whose plan and rhythm
    resolve no price is blocked with `BUNDLE_NOT_PRICED_FOR_THIS_PLAN`, in the
    preview and in the route, instead of handing the features over for nothing.

    `computeNextBundlePeriod` is the decision half a renewal job calls, mirroring
    `computeNextPeriod` for the plan. It both rolls a period that is over and opens
    the first one for a bundle booked while its plan had no period — during a trial,
    or before sales finished — which would otherwise keep granting its features
    without ever acquiring a window to bill them in. It declines for a booking
    billed with the plan, one whose plan has no paid period yet, one still running,
    one whose cancellation has landed, and one whose plan has ended.

    The window it returns stops at whichever ends the booking first — the plan's end
    or the booking's own declared cancellation — and advances to the first boundary
    after `now` rather than by one cycle, so a job that missed several months
    catches up in a single write.

    A plan change is blocked with `BUNDLE_CYCLE_EXCEEDS_PLAN` while an active
    booking's rhythm would not fit the target cycle. The rule was previously
    enforced only where a bundle is booked, so a yearly add-on survived a move from
    a yearly plan to a monthly one and sat in a state the model calls impossible.

    Cancelling a booking now takes effect at the end of the booking's own period
    rather than the plan's. For a monthly bundle beside a yearly plan those are up
    to eleven months apart, and reading the plan's boundary kept a cancelled booking
    committed and billed until the annual renewal.

    `addBundle` and `previewAddBundle` now take `{ minimumTermMonths?, billingCycle? }`
    where they took a bare `minimumTermMonths`, and `useTenantSubscriptionBundles().add()`
    accepts the same rhythm. Until they did, no shipped client sent one, so a bundle
    priced monthly only read as unpriced to every tenant on a yearly plan and the
    case this alignment exists for could not be completed at all.

    Existing bookings need a backfill; `docs/guides/upgrade-to-1.0.md` carries the
    statement, the one call to add to the renewal job, and says which rows to leave
    alone.

- 855f023: Let a tenant on a yearly plan choose whether an add-on is billed monthly or
  yearly, and stop quoting a price that is not the one being charged.

    A bundle's term may not outlast the plan it hangs on, so a yearly add-on beside
    a monthly plan is refused — which leaves a real choice only on a yearly plan.
    There the tenant used to get the plan's rhythm silently, with no way to ask for
    the other one, while every card read "net/month". On a yearly plan that figure
    was the monthly price and the booking was created yearly, so the number the
    tenant compared bundles by was not the number they were charged. The
    confirmation dialog did show the real amount before anyone agreed, so nobody was
    billed unannounced.

    `TenantBundleStore` now offers the rhythm above the cards, preselected to the
    plan's — a tenant who touches nothing gets exactly what they got before. The
    card's price and unit follow the selection, the booking carries it, and a bundle
    that carries no price in the selected rhythm is shown as unavailable in it
    rather than as a button the server would refuse. A booked bundle states the
    rhythm it was actually booked in, and the price it is actually billed at.

    Two prices were wrong before, and both are fixed at the source rather than in
    the view. `GET /billing/subscription-bundles` answered with the bundle's base
    **monthly** price whatever the booking was, so a bundle at 9.90 monthly and
    99.00 yearly reported 9.90 once booked yearly; it now returns `priceNet`,
    resolved for the booking's own rhythm with the plan's `BundlePricingOverride`
    applied. And the public catalogue has no tenant and therefore no plan, so it
    serves base prices and reads a bundle priced only through an override as having
    no price at all — a new `POST /billing/subscription-bundles/prices` resolves
    them for the tenant's plan, and the store prices from that.

    `SubscriptionBundleView.monthlyNet` is therefore now `priceNet: number | null`,
    and `SubscriptionBundleShape` gains `priceNet` and `billingCycle`. A consumer
    without the new prices endpoint keeps the catalogue's own figures, which is what
    every consumer had before.

    Mixed rhythms in one contract are new, and the contract snapshot accounts for
    them: each line keeps the rhythm it is billed in, and the total states one
    period of the contract's own rhythm, so a monthly add-on beside a yearly plan
    counts as often as it falls due rather than once. `ContractFreezeSourcePort`
    now says what its `cycle` argument means — the plan's, not the bookings'.

    The price lookup answers only about versions a tenant could have been shown:
    published and not superseded. A caller naming an unpublished id would otherwise
    be told its plan-specific pricing.

    A booking no longer commits the tenant to anything by default. It used to write
    a twelve-month minimum term on every add-on without an operator doing anything,
    which made the cancellation rule impossible to keep: a cancellation lands at
    `max(currentPeriodEnd, minimumTermEndsAt)`, so a monthly add-on could not be
    cancelled to its next period, and on a yearly plan the term outlasted the
    bundle's own last period. An add-on can now be cancelled at any time up to the
    moment its next period begins, effective at the end of the period it is in — so
    nothing ever has to be refunded. `defaultMinimumTermMonths` still configures a
    commitment for an operator who wants one, and it is still capped at the plan's
    end.

    On a monthly plan nothing changes and no control appears: a question with one
    answer is not a question.

### Patch Changes

- Updated dependencies [d492281]
- Updated dependencies [89eed2b]
- Updated dependencies [855f023]
- Updated dependencies [9b5ca2f]
    - @saasicat/core@1.0.0-rc.7
    - @saasicat/ui-vue@1.0.0-rc.7

## 1.0.0-rc.6

### Minor Changes

- a56af36: A term is a term: minimum term, notice period, and when a change lands

    The rules a subscription runs by were partly implicit and partly in the wrong
    layer. This makes them explicit and puts each one where it can be read.

    **An immediate change may improve the service; it may not shorten the
    commitment.** `changeType` collapsed "a better plan" and "a shorter period" into
    one word, so moving from a yearly STARTER to a monthly PRO classified as
    `UPGRADE`, applied immediately, and ended the yearly commitment early. Plan
    direction and cycle direction are two answers now (`planDirection`,
    `cycleDirection` on the preview), and only an upgrade that does not shorten the
    cycle takes effect today. A trial is the exception, because it commits to
    nothing: its cycle says how it will be billed once it converts, not a period the
    customer is inside, so an upgrade during a trial takes effect at once whichever
    cycle it picks.

    **A cancellation is a declaration; when it lands is decided, not asked for.**
    `POST /billing/cancel` no longer accepts `immediately` — a tenant could use it to
    end a term they were inside. The date comes from the minimum term and the
    configured notice period. `useTenantBilling().cancelSubscription()` therefore
    takes no argument and returns the dates instead.

    **`canceledAt` and `canceledEffectiveAt` are two fields.** They were one, which
    made a subscription cancelled in month three of a year look finished — it runs,
    is billed and keeps every entitlement until the term ends. `Subscription` gains
    `minimumTermUntil` and `canceledEffectiveAt`; the renewal reads the second, so a
    declared cancellation no longer stops a period from rolling and a landed one
    does.

    **A notice period is configurable and zero by default.** `cancellationNoticeDays`
    on the billing module. With no window there is no door to be shut out of; where
    one is configured the cut is hard, and a declaration made after it lands at the
    end of the _following_ period.

    **A trial has an end, not a term.** A trial carries a period end like any other
    subscription, and reading it as a commitment made the two rules a customer meets
    disagree: a plan change during a trial applies at once because there is nothing
    to protect, while a cancellation was measured against a term that does not
    exist. With a notice period configured that was not a difference of weeks — a
    trial ending inside the window is already past its deadline, so cancelling a
    yearly-cycle trial bought a year. A trial's cancellation now lands when the
    trial does, and no notice window applies to it.

    **A prorated upgrade never asks for less than nothing.** The formula is
    unchanged — `(target − current) × remaining ÷ period` — and its result is now
    floored at zero, with `rawDeltaNet` and `isFree` beside it so a page can say
    "free upgrade" rather than showing a credit this platform does not pay. `isFree`
    is strictly negative: a change that costs exactly zero, because the two plans
    are priced the same, is not a free upgrade but a change with no price
    difference, and those are two different sentences to somebody deciding.

    **The tenant sees what happens and when.** Three changes arrive later than a
    reader expects — an upgrade with a shortened cycle, a downgrade, a cycle change
    — and each is acknowledged rather than announced: the consequence is the
    heading, the date is in bold, and the confirmation stays locked until it is
    ticked. A downgrade lists the features it costs. A cancelled subscription shows
    its end date instead of the word "cancelled".

    **The timing never travels from the client.** `POST /billing/plan` no longer
    accepts `effectiveImmediately`, and `useTenantBilling().changePlan()` no longer
    takes it: the route derives the timing from the same preview the wizard renders.
    It used to branch on the flag under a comment promising the server-side check
    "prevents bypass via a direct API call" — it checked the blockers and left the
    one decision that carries money to the caller.

    **A period boundary on a month end stays on a month end.** `advanceOneCycle`
    overflowed: 31 January plus a month was 3 March, and 29 February plus a year was
    1 March. Pre-existing, invisible while the result was only a period boundary,
    and reported to a customer as a contract end date now.

    **Cancelling twice does not move the date.** A repeat returns the existing
    cancellation and writes nothing. With a notice period configured, recomputing it
    against a later `now` could land it a whole period further out — an on-time
    declaration landing January 2027, retried after the deadline, became January 2028.

    **The date the page showed is the date that applies.** `POST /billing/cancel`
    accepts an optional `expectedEffectiveAt` and refuses with
    `CANCELLATION_TERMS_CHANGED` when its own answer differs, so a dialog opened
    before a notice deadline and confirmed after it cannot deliver a date the
    customer never saw. Where the answer _is_ the moment of asking — a subscription
    with nothing left to run — the check accepts any reading of the clock up to now
    and refuses only a date still in the future; comparing those two readings for
    equality would refuse every confirmation, including each retry.

    **A cancellation written before the fields split is still a cancellation.**
    `GET /billing/usage` applies the same fallback the renewal and the cancel route
    apply, so a row whose effective date sits in `canceledAt` reports it. Read
    strictly, it told the page nothing had been cancelled — which hid the end date
    and went on offering to cancel it again.

    **Both enforcement paths see the end, and a cached answer does not outlive
    it.** Entitlements are enforced along two paths, and a rule written in one is
    enforced in half the applications: `StaticFeatureGuard` and
    `EnforceQuotaInterceptor` — what an app gets without registering tenant billing
    — reach their plan through `SubscriptionPlanResolver`, which asked only whether
    the status was `ACTIVE` or `TRIAL`. It reads the cancellation too now, and takes
    the same `canceledEntitlementPlan` floor, because two paths that disagree about
    what a cancelled subscription keeps would be worse than either answer alone. And
    a cached limits entry is capped at the cancellation's effective moment: every
    other thing that changes those limits is a mutation and invalidates the cache,
    while a date arriving is not, so the old features were served for up to a minute
    past the end of the contract.

    **A cancellation that has taken effect ends the entitlements.** It did not.
    Nothing on the entitlement path read a cancellation, so a subscription that
    ended last January was granted exactly what it was granted while active — same
    plan, same features, same quotas, and `FeatureGuard` let it through. The root
    was that `SubscriptionRecord`, the record that path reads, carried neither date;
    it now requires both, so an adapter cannot omit them silently. A landed
    cancellation grants nothing by default, and `canceledEntitlementPlan` on
    `EntitlementResolutionConfig` names a floor for installations that want one — a
    read-only tier to export from, a free plan to fall back to. A cancellation that
    is merely declared still changes nothing, which is the same rule as before.
    `@saasicat/adapter-drizzle` gained the two columns in its query map to supply
    them. **This removes access from tenants whose cancellation has already landed**;
    [the upgrade guide](https://github.com/uelker70/saasicat/blob/main/docs/guides/upgrade-to-1.0.md)
    carries the query that lists
    them.

    **Nothing rolls onto a subscription whose term is over.** A plan _version_
    published before the customer cancelled still comes due afterwards, and the
    renewal decision read only the version's own dates — so it rewrote the plan of a
    subscription that had ended. `decideRenewal` reads the cancellation now, the way
    `computeNextPeriod` beside it already did, and `RenewalSubInput` carries the two
    dates for it. The tenant route that accepts a pending version refuses the same
    case, and the page stops offering the banner that leads to it.

    **The page tells an ended subscription from a cancelled one.** Nothing
    transitions the status column when a cancellation lands, so a subscription that
    ended last month still reads `ACTIVE` there. The tenant plan card believed it: a
    positive badge, a next billing date, and a sentence promising nothing would
    change before a date already in the past — beside a "change plan" button whose
    route now refuses. It reads the date instead, shows the subscription as ended,
    and offers neither act. A cancellation still to come is unaffected and says so:
    that subscription runs, is billed and keeps everything until the date.

    **A repeated cancellation no longer explains itself with a date it cannot
    know.** The repeat reports what is stored — that it was already cancelled, and
    when it lands. `termEndsAt`, `noticeDeadline` and `afterNoticeDeadline` are null
    there, because the decision behind them was taken once against a `now` that has
    passed; deriving them from the effective date reported a declaration that landed
    a period late as an on-time one. `CancellationResultShape.afterNoticeDeadline`
    is therefore `boolean | null`.

    **The till closes with the subscription, and the ledger stays open.** A bundle
    is bought, priced and given a minimum term of its own, and it grants its
    features through the parent — which grants nothing once its cancellation has
    landed. Booking, pricing a purchase and reactivating are refused there;
    listing, cancelling and pricing a cancellation stay open, because a tenant who
    has left still has bookings to recognise and invoices to explain.

    **A bundle cannot commit past the subscription that pays for it.** A twelve-month
    default term on a subscription ending in three weeks binds a customer to
    something with three weeks left to give, and once the parent ends the booking
    grants nothing. The term is clamped to the parent's end rather than the purchase
    refused: somebody who cancelled for the end of the month may still want a bundle
    for this month, and a bundle is priced per period rather than per term, so a
    shorter commitment cannot overcharge them. `addBundleToSubscription` takes
    `parentEndsAt`.

    **A frozen contract ends when the subscription does.** Left active, it outlived
    the agreement it froze: entitlement resolution granted nothing while
    `getActiveInvoiceSnapshotForTenant()` went on reporting a live contract — two
    answers to "is this customer under contract", and the one that bills said yes.
    Every later freeze carries the ending too: a plan change on a cancelled
    subscription is allowed, and each one supersedes the contract with a fresh one —
    uncapped, that successor lost the ending and the repair held exactly until the
    next change. `freezeOnPlanChange` takes `endsAt`. And a cancellation that was
    already recorded repairs its contract on the next attempt, because only the
    request that wins the cancellation write reaches the hook: a row written before
    this existed, or a retry after the non-fatal contract call failed, would
    otherwise never be capped at all.

    `ContractFreezePort` gains `endOnCancellation`, and the cancel route calls it
    with the same effective date, non-fatally as every other use of that port. It
    ends the contract _by date_: `TerminateSubscriptionContractData.status` accepts
    null, and the active lookup is already a window, so a cancellation declared
    months ahead leaves the agreement findable until it lands. Writing a terminal
    status there would be the opposite mistake and the worse one — the customer is
    still under contract, still paying, and it would have vanished from every lookup
    the moment they declared.

    **Onboarding is a first activation, and a contract that is over is not one.**
    The route refuses a subscription whose cancellation has landed, and its write —
    the atomic one, which is the path a real adapter takes — claims the row against
    the cancellation the route read, exactly as the plan change does. Both halves
    were missing: the guard lived on the plan route only, and the claim had been
    added to the sequential fallback while the preferred path updated
    unconditionally. `ApplyOnboardingSelectionInput` carries `expectedCanceledAt`
    and the result answers `claimed`.

    **A plan change decided against one state is not written into another.** The
    route reads the subscription, computes a preview and decides three things from
    the cancellation — whether the change is refused, whether the cycle may move,
    whether a fresh period is opened — and only then writes. A cancellation arriving
    in that window made all three answers about a state that no longer existed, and
    the write went ahead: a plan term recorded past the date the subscription ends.
    `ImmediatePlanChangeInput` and `ScheduledPlanChangeInput` carry
    `expectedCanceledAt`, both writes claim the row only while that still holds, and
    a lost claim answers `SUBSCRIPTION_CHANGED` instead of overwriting. The boundary
    itself is re-read immediately before the write: the claim compares `canceledAt`,
    which a passing minute does not change, so a cancellation recorded earlier and
    landing while the preview was computed would have satisfied it.

    **The preview says what the write will refuse.** A cancelled subscription
    cannot change its billing cycle, and until now only the write said so — a reader
    picked the cycle, read the consequence, ticked the acknowledgement and met a 409
    on confirm. The preview carries the restriction as a blocker, which is what the
    wizard reads before it lets anyone past the first step.

    **A subscription that has ended is not an active tenant.** Both adapters counted
    by status alone, and a landed cancellation leaves the status at `ACTIVE` — so a
    plan's tenant count in the SuperAdmin UI carried every customer who had ever
    left, and grew for ever.

    **A cancellation is declared once, even when it is declared twice at once.**
    The route checks whether one exists and then writes, and those are two moments:
    two requests could pass the check before either wrote. Either side of a notice
    deadline that costs a billing cycle, the second write replaced an on-time date
    with one a period later. The write is a conditional claim now — one statement,
    `canceledAt` and `canceledEffectiveAt` both still empty — and a declaration that
    loses it reads back what the winner wrote. `TenantSubscriptionWritePort` answers
    `alreadyCanceled` for that.

    **A cancelled subscription cannot change its billing cycle.** The cancellation
    was measured against the term of the cycle it was declared under. A monthly
    subscription ending on the 1st, upgraded to a yearly plan, is an immediate
    change — the plan goes up, the cycle gets longer — and it produced a contract
    that contradicted itself: `YEARLY` beside the monthly period the cancellation
    closes, with a year's price prorated across the days left in it. The route
    answers `CANCELLATION_LOCKS_THE_CYCLE`; the plan may still move on the cycle it
    was sold in.

    **The tenant page follows the boundary instead of the last render.** Whether a
    subscription has ended is a question about the clock, and a clock read inside a
    computed is not a dependency of it — a card left open across the effective
    moment kept saying "runs unchanged" and kept offering a plan change the route
    refuses. The moment is scheduled now, in hops below the platform's timer limit,
    and the timer is cleared with the component.

    **A cancellation is a boundary, and two writes used to cross it.** A plan change
    and a cancellation are two decisions about one subscription, and neither could
    see the other. A subscription that had already ended still accepted an
    upgrade — applied, prorated and charged — while entitlement resolution granted
    nothing, because it reads the cancellation and the route did not; that route now
    answers `SUBSCRIPTION_ENDED`. An immediate change on a subscription that is
    cancelled but still running no longer opens a fresh billing period, which would
    have sold a term the cancellation cuts short. And a change scheduled before the
    customer cancelled is declined once the cancellation has landed, instead of
    restarting the period and running the follow-up hooks on a term that is over —
    `DuePendingPlanChange` carries the two dates for that decision. A cancellation
    that has _not_ landed declines nothing: a customer who bought a further period
    by cancelling late may still choose the plan they spend it on.

    **A cancellation writes what it decided, not only when it lands.** Two things
    follow from the date and neither is asked for. A subscription with nothing left
    to run — a trial, or one still waiting for sales, with no period end and no
    committed term — is now recorded as ended rather than left `ACTIVE` for good:
    nothing downstream would ever have transitioned it. What entitlements a
    cancelled subscription grants is unchanged and still under review. And a
    declaration made after the notice window closed
    extends the stored commitment to the period it bought, because every other
    reader of the term end looks at `minimumTermUntil` — a downgrade scheduled
    meanwhile would otherwise have landed at the old term end, inside the period the
    customer had just paid for.

    **Breaking for anyone implementing the ports.** `changePlanImmediate` and
    `schedulePlanChange` take `expectedCanceledAt` and answer `claimed`; both must
    claim conditionally rather than update, or the race above stays open in that
    adapter. `SubscriptionRecord`, `SubscriptionUsageRecord`, `DuePendingPlanChange`
    and `RenewalSubInput` require `canceledAt` and `canceledEffectiveAt` — required rather than optional because
    an adapter that omits them cannot tell a subscription that ends next January
    from one that ended last January, and the silent answer is the wrong one.
    `TenantSubscriptionWritePort.cancelSubscription` now takes
    `{ canceledAt, effectiveAt, terminateNow, minimumTermUntil? }` and returns
    `canceledEffectiveAt`;
    it used to compute the effective date itself from a boolean, which put a
    commercial decision in a persistence adapter where neither the term nor the
    notice period is visible. `SubscriptionUsageRecord` gains three optional fields,
    and `GET /billing/usage` answers with `cancellation` — what cancelling right now
    would do, so a page can state the date before the customer confirms.

### Patch Changes

- Updated dependencies [a56af36]
- Updated dependencies [dbed2a9]
- Updated dependencies [b3f00dd]
    - @saasicat/core@1.0.0-rc.6
    - @saasicat/ui-vue@1.0.0-rc.6

## 1.0.0-rc.5

### Minor Changes

- 5eec494: The tenant components no longer need a UI framework

    `@saasicat/ui-vue-tenant` renders inside your application, so it stopped deciding
    what your application is built from. `quasar` is gone from its peer
    dependencies; the plan section, the plan-change wizard, the bundle store and the
    package snapshot are plain elements on the theme's CSS custom properties. If you
    installed Quasar only to embed a plan section, it can go — with
    `@quasar/vite-plugin` and the Sass setup beside it.

    Breaking for anyone who styled around the old markup or rendered the inner
    components directly: the `q-*` class names are gone, `TenantPlanCardHeader` takes
    `statusTone` instead of `statusColor`, and the feature matrix hands the
    registry's icon to a `#feature-icon` slot rather than drawing a Quasar icon name
    that needed Quasar's icon font. `docs/guides/upgrade-to-1.0.md` has the details.

    Two composables are new in `@saasicat/ui-vue`, both framework-free and both
    usable outside the tenant package: `useDialog` (focus trap, focus return,
    escape, `aria-modal`, `aria-labelledby`, scroll lock, settable teleport target)
    and `useSteps` (a linear wizard's position, its guard, and moving focus to the
    new step's heading). `bindSaThemeAttribute` joins them: it writes the one
    attribute the role tokens key off, so an app can follow the OS theme without
    installing Quasar for it.

### Patch Changes

- Updated dependencies [f9f19d0]
- Updated dependencies [5eec494]
    - @saasicat/ui-vue@1.0.0-rc.5
    - @saasicat/core@1.0.0-rc.5

## 1.0.0-rc.4

### Minor Changes

- ed230d3: Spacing, radii and tracking in the shipped components now read the design
  tokens instead of pixel literals — 1,165 declarations across both packages.

    **What moves.** Values that sat between two rungs snap to the nearer one, and
    ties round down: `gap: 6px` becomes `var(--sa-space-2)` (4px), `padding: 14px`
    becomes `var(--sa-space-4)` (12px), `border-radius: 6px` becomes
    `var(--sa-radius-control)` (7px). Nothing moves by more than 2px, and the visual
    suite confirms no page overflows at any breakpoint.

    **Why it matters to you.** These are the subpaths that ship source, so your
    build compiles them — and from here, overriding `--sa-space-*` or
    `--sa-radius-*` changes the whole surface at once rather than the one component
    that happened to read a token already. See
    [design tokens](https://github.com/uelker70/saasicat/blob/main/docs/reference/design-tokens.md).

    If you override individual component paddings in your own stylesheet, check
    them once: the value they sit next to may have shifted by a rung.

### Patch Changes

- ed230d3: Every package README now answers the same three questions in the same order:
  what this is, what this is **not**, and where to go next.

    The middle one is the addition. `@saasicat/core` is not a types-only package,
    `@saasicat/spec` does not run your migrations, `@saasicat/cli` has no binary of
    its own for the flows it ships, and `@saasicat/ui-vue-tenant` renders in your
    application rather than in the admin — each of those was a question rather than
    a sentence.

    `@saasicat/nest` and `@saasicat/ui-vue` list all twelve and thirteen of their
    entry points with what is in each and when to take it; the previous tables
    covered one and four. A repository test checks those tables against the export
    map in both directions.

- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
    - @saasicat/ui-vue@1.0.0-rc.4
    - @saasicat/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- Updated dependencies [08d1f52]
- Updated dependencies [b1aa10e]
    - @saasicat/ui-vue@1.0.0-rc.3
    - @saasicat/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- Updated dependencies [3ebc363]
    - @saasicat/ui-vue@1.0.0-rc.2
    - @saasicat/core@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies [8aced6f]
    - @saasicat/core@1.0.0-rc.1
    - @saasicat/ui-vue@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 9449492: **One name for everything — and a codemod that applies it.** Phase 5 of the 1.0 cut.

    `npx @saasicat/cli@latest codemod v1 --dir=.` does the surface cut from the previous
    candidates and everything below in one run. `docs/migrating-to-1.0.md` is the written
    form, with before/after for each change.

    **`SaasPlatformModule` is gone; `SaaSiCatModule` is the class**, not an alias of it.
    The thirteen `SaasPlatform*` option types are `SaaSiCat*` — `SaaSiCatModuleOptions`,
    `SaaSiCatAdapters`, `SaaSiCatCatalogOptions` and so on. `createSaasPlatformTestModule`
    is `createSaaSiCatTestModule`; `SaasicatPersistenceAdapter` and its six slice types are
    `SaaSiCatPersistenceAdapter` and `SaaSiCatPersistence*`. There is one spelling of the
    product name left: `SaaSiCat` in types and prose, `saasicat` in packages and files,
    `SAASICAT_` in constants.

    **Every registry key is `saasicat/<package>/<Name>`.** Four prefixes —
    `saas-platform/`, `saas-platform-nest/`, `saas-platform-cli/`, and `@saasicat/ui-vue/` for
    the Vue injection keys — became one. This matters only if your code calls `Symbol.for`
    with one of those strings itself; the exported token constants are unchanged in name and
    resolve as before. The keys will not be renamed again: the rule in `CONTRIBUTING.md` says
    why, and a repository test refuses any other prefix.

    **`FEATURE_UI_REGISTRY_TOKEN` has two names now**, because it meant two registries:
    `BILLING_FEATURE_UI_REGISTRY_TOKEN` from `@saasicat/nest/billing` and
    `CATALOG_FEATURE_UI_REGISTRY_TOKEN` from `@saasicat/nest/catalog`. The codemod picks by
    the entry you imported from and reports an import it cannot decide.

    **`@saasicat/ui-vue/testing-e2e/*` is `@saasicat/ui-vue/testing/*`** — the Playwright
    helper consumers run their admin pages through. Nothing else about it changed.

    Inside the repository, for anyone who reads it: the package directories are the package
    names (`packages/nest`, not `packages/saas-platform-nest`), Nest files follow
    `<area>/<name>.module.ts`, adapter files end in `.repository.ts` or `.adapter.ts`, and test
    directories are `tests/{integration,component,e2e}`. None of that reaches a consumer's
    imports.

- 9449492: **Every standard page reads its own data.** Twelve pages took sixty-one callback
  props between them — `loadTenants`, `submitCreate`, `reviewFeature`,
  `classifyDiff` — and every consumer app wrote them all again. They now ask the
  platform's resource registry by name. Function props in pages: **64 → 2**, and
  `tests/pages-take-no-callbacks.test.js` now holds that number: it resolves each
  prop's type through the compiler, so a callback reached through a type alias
  fails the build the same way an inline one does.

    An app that mounted a standard page with the standard wiring can delete that
    wiring. An app that needs one call diverted passes `:resources` to that page,
    or `resourceOverrides` to `createSuperAdminApp()`, and keeps the rest — the
    property
    a prop-based page cannot offer, because its props are all or nothing.

    The example's glue shows the size of it: `AdminBundlesPage` went from 145 lines
    to 16, `AdminDiscoveryPage` from 72 to 16.

    The two remaining function props are on `AdminManifestErrorPage`, deliberately:
    that page renders when the manifest failed to load, so pointing it at the
    registry would point it at the thing whose absence put it on screen. Each says
    so in its own JSDoc, which is what the guard reads — an exception is declared
    where the prop is, not collected in a list somewhere else.

    **`DashboardPage` joins them.** It kept `loadManifest`, `http` and `formatKpi`
    after the other twelve moved. The manifest comes from the shell's guard, the
    client from the registry, and the third is now a resource:

    ```diff
    -<DashboardPage :manifest="m" :load-manifest="load" :http="client"
    -                :format-kpi="myFormat" :distributions="rows" />
    +<DashboardPage :options="{ distributions: rows }" />
    ```

    An app whose KPI endpoints answer in a shape the default reader does not
    recognise overrides `dashboard.kpi` once, instead of threading a formatter to
    the one page that took it. `subtitle`, `distributions`, `shortcuts` and
    `shortcutDescriptions` moved into `options`.

    **Pages no longer take `adminEndpoint`, `projectKey`, `http` or
    `getAuthToken`.** They come from the shell, which already knew them.
    `BundlesPage` in particular
    took a `projectKey` prop while its resources read a different one from the
    context — two answers to one question.

    **Four resources are new**, and none of them invents an endpoint. The platform
    ships pages for pilots, SMTP providers and the send log but serves no route for
    any of them: those belong to your backend. The descriptors record the paths
    every consumer already calls, so the pages need no callbacks and you override
    an operation instead of supplying one.

    **Fixed: five defects the route split left behind.** The plan editor and the
    review became child routes, and the page that hosts them kept state and
    operations written for the modes they used to be:

    - Publishing from the review wrote nothing. The operation read the page's copy
      of the draft, which only a _save_ had ever written, so a publish before a save
      returned at its first guard while the step cleared the form and navigated
      away. `publishDraft` now takes the draft — and the checklist's force flags,
      which were dropped on the way out.
    - A rejected save looked exactly like a successful one: the error was recorded,
      but the step had already cleared the form and left. `saveDraft` and
      `publishDraft` answer `boolean`; a step leaves only on `true`.
    - The plans page drew its own hero and body underneath the step, putting two
      complete plan views on one screen. It reads the route now.
    - `PromoCodeDetailPage` read `route.params.id` while its route declares
      `promo-codes/:code`, so every navigation asked for `/promo-codes/` — the list.
    - `UsersPage`'s one-time-password dialog sat in a row slot and opened once per
      rendered user, stacking overlays and focus traps.

    **Fixed: three defaults that grouping the props into `options` dropped.**
    `withDefaults` carried them; `props.options?.x` reads `undefined` as "off", and
    an optional boolean makes that a legal value rather than a type error. Every app
    that had never named the option lost the surface:

    | Page               | Option           | What went missing                |
    | ------------------ | ---------------- | -------------------------------- |
    | `TenantsPage`      | `showPlanColumn` | the plan column                  |
    | `TenantDetailPage` | `showUsers`      | the users section                |
    | `PromoCodesPage`   | `statusOptions`  | the status filter's four choices |

    **Fixed: the status pill had lost its shape.** Promoting `StatusPill` onto the
    roster moved its tones into the theme and left the base rule behind, so
    `.sa-pill` had no radius, no padding and no weight — every status marker in the
    admin rendered as plain body text while its colours stayed correct. Its vertical
    padding now sits on the spacing scale (2px, from 3px) and its radius has a token
    of its own, so a pill is one pixel shorter than it was in 0.27.

    **Fixed: two standard pages crashed while mounting in an assembled app.**
    `PromoCodeDetailPage` threw on a code that does not exist — its title read
    `data?.promo.code`, and a response without a `promo` is still truthy — and
    `EmailHistoryPage` handed its table `rows=undefined` when the body was not the
    paginated envelope. Both render their empty state now.

    **Fixed: the shell header overflowed on a phone.** Eleven pixels, and the same
    eleven at 320px, 390px and 600px: Quasar pads the toolbar title 12px per side
    and padding does not shrink, so the title was already down to nothing while
    those 24px pushed a `position: fixed` row past its box. The locale and theme
    switchers also drop their labels one breakpoint earlier — at the `sm` lower edge
    the badge, both labels and the identity block all came back at once.

    **Fixed: `auditResource` sent parameters the endpoint ignores.** It spoke
    `AuditQuery` (`actorTag`, `from`, `to`, paginated) at `GET /admin/audit`, which
    accepts `actor`, `action`, `entity`, `since`, `limit` and answers with a bare
    array. Filtering the audit list by actor would have returned an unfiltered list
    that looked filtered. `AuditListFilter` is now `AdminAuditListFilter`, and
    `useResourceList('audit')` no longer compiles — call
    `useResource('audit').list(filter)`.

    **A fully redeemed promo code no longer renders red.** Both copies of the page's
    status-to-colour function fell through to `negative` for `EXHAUSTED`, so the
    campaign that worked best looked like a fault.

    ***

    **The plan editor and review are their own routes.**
    `/admin/plans/version/edit` and `/admin/plans/version/review` — deep-linkable,
    and children of the plans route so the unsaved draft survives moving between
    them. Nothing is written to the server until you publish or save, which is the
    point of the review step.

    ***

    **`pages-tenant/*` moved to `@saasicat/ui-vue-tenant`.**

    ```diff
    -import TenantPlanSection from '@saasicat/ui-vue/pages-tenant/TenantPlanSection.vue';
    +import TenantPlanSection from '@saasicat/ui-vue-tenant/TenantPlanSection.vue';
    ```

    `saasicat codemod v1-imports` rewrites these for you along with the rest of the
    1.0 import moves.

    **Fixed while splitting it: the package's export map answered no `.ts` file.**
    It read `"./*": "./src/*"`, and the package ships source, so
    `import { … } from '@saasicat/ui-vue-tenant/tenant-i18n.js'` resolved to a
    `.js` that is not there. `./*.js` now maps to `./src/*.ts`, `./*.vue` to
    `./src/*.vue`.

    Why: different audience, different release schedule. Those components render
    inside your customers' product under their branding and in their language, and
    folding them into the admin package meant every breaking change in the admin
    forced a migration in the middle of a customer-facing product. It also shipped
    4,300 lines to every admin consumer who never renders a tenant page.

    Add the package alongside the platform one:

    ```bash
    pnpm add @saasicat/ui-vue-tenant
    ```

    It takes `@saasicat/ui-vue` as a peer and reads the same design tokens, so
    `import '@saasicat/ui-vue/theme.css'` still covers both.

    ***

    **Breaking: the default UI locale is English.** `DEFAULT_SA_LOCALE` was `'de'`.
    It is also the fallback for `Intl`, so an app that names no locale now formats
    dates and currency the English way. German remains a complete catalog — pass
    `createSuperAdminApp({ i18n: { locale: 'de' } })`.

### Patch Changes

- Updated dependencies [9449492]
- Updated dependencies [9449492]
- Updated dependencies [9449492]
- Updated dependencies [9449492]
    - @saasicat/types@1.0.0-rc.0
    - @saasicat/ui-vue@1.0.0-rc.0
