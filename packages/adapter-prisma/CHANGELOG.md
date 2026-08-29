# @saasicat/adapter-prisma

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [1e9b842]
    - @saasicat/core@1.0.0-rc.8

## 1.0.0-rc.7

### Major Changes

- 89eed2b: **`projectKey` leaves the data model.** One installation serves one application,
  so a plan key, a bundle key, a feature key and a quota key are unique for the
  whole installation — and nothing carries a project above them any more.

    The column never had a second value to hold. `config/saas.yaml` named one
    project, the module resolved it once at boot, and there was no per-request
    switch; `subscriptions.tenantId` is unique installation-wide, so a customer of
    two applications in one database could not exist. What it did do was contradict
    the schema beside it: `plan_versions.planId` holds the plan **key** and no
    project, so two plans sharing a key shared one version lineage, and
    `plan_versions_draft_per_plan` then stopped the second one from opening a draft
    at all.

    **Ten tables lose the column** — `plans`, `bundles`,
    `capability_/feature_/quota_catalog_entries`, `marketing_projections`,
    `marketing_settings`, `promotions`, `checkout_offers`,
    `subscription_contracts` — and every `(projectKey, <key>)` unique index becomes
    `(<key>)`. `marketing_settings` becomes a singleton, capped by a constant
    primary key rather than by its project.

    **Run one SQL file against an existing database:**

    ```bash
    psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-remove-project-key.postgres.sql
    ```

    It starts with a guard. Where the catalogue holds rows under more than one
    project key — in one table or spread across several — it stops and names which
    table held which, rather than merging rows that would then collide on the new
    unique index. It is a one-way door, and safe to run again: a table whose column
    has already gone is skipped.

    Each table's changes are made only where that table exists, so an app that
    adopted a subset of the Prisma fragments migrates what it has. The file also
    adds a `CHECK` keeping `marketing_settings` to one row — that was a convention
    resting on a column default, and a default does not apply to a caller that
    supplies the value.

    If your dev setup uses `prisma db push`, run the file **before** it. `db push`
    refuses to drop a column that still holds data, and adding `--accept-data-loss`
    would arm every future change to discard data unasked.

    The codemod reads your `schema.prisma` as well and reports what it finds there:
    a schema you copied the platform's models into still declares the columns, and
    a client generated from it would query them.

    **For your code**, `saasicat codemod v1` gained a third pass —
    `v1-project-key`. It removes the `?projectKey=` query part from a `/catalog/`
    URL and the key from `config/saas.yaml`, and it _reports_ every object member
    by file and line rather than removing it: in TypeScript an object literal and a
    type literal are the same tokens, so a scan that rewrote members would sometimes
    delete one of your own declarations. The upgrade guide's table says what each
    reported shape becomes.

    **What changes at the surface:**

    - `app.name` is **required** in `config/saas.yaml`; it is the one place the
      application names itself, and what the manifest and login page display.
      `dbCatalog` takes `{ app, currency, vatRate }`.
    - `SuperAdminEndpoints`, every catalogue composable and every admin resource
      drop the field; the catalogue endpoints no longer read `?projectKey=`.
    - `PlanRow`, `BundleRow`, `PromotionRow`, the catalog-entry rows,
      `MarketingProjectionRow`, `MarketingSettingsRow`, `CheckoutOfferRow`,
      `SubscriptionContractRecord` and their create/filter DTOs lose it;
      `findByKey`, `retireMissing`, `findFeature`/`findQuota`, the review, i18n and
      base setters, `countActiveByPlanKey` and `loadSnapshot` lose their first
      argument. `PromotionFilter` and `unambiguousPlanKeys` are gone.
    - Four error messages drop the phrase — `Plan 'STANDARD' already exists` — and
      the `params` entry with it. Nothing read that parameter.
    - `saasicat init --project-key` and `pnpm create saasicat-admin --project-key`
      are `--app-key`: the slug of the application, which is what they always were.

    **Three new guards, because a removal leaves no trace.** The persistence
    contract now proves a key is taken once for the installation, and that retiring
    a plan does not free it — a rule `adapter-drizzle` did not follow, and now does.
    `tests/a-key-belongs-to-the-installation.test.js` fails on the identifier coming
    back anywhere in the repository. And the migration refuses ambiguous data rather
    than merging it.

    Migration guide: [`docs/guides/upgrade-to-1.0.md`](https://github.com/uelker70/saasicat/blob/main/docs/guides/upgrade-to-1.0.md).

### Minor Changes

- 2754055: A subscription is billed on a day, and February no longer takes it

    Period boundaries read their day from the previous boundary, and the previous
    boundary had already been clamped to fit a shorter month. So a subscription
    starting on the 31st was billed on the 28th from its first February onwards —
    and on the 28th for the rest of its life. Three days lost once, silently, with
    every later date measured from the wrong one: the renewal window, the notice
    deadline, and the contract end a customer is told about.

    `Subscription.billingAnchorDay` holds the day. It is written when a period
    window opens — at activation and at a plan change that resets the window — and
    never by a renewal, because reading its own previous result is exactly the drift
    it exists to stop.

    The anchor is a **day number**, clamped down where the month is too short and
    not consumed by that clamp. An anchor of 31 gives 28 February and then 31 March.
    An anchor of 30 gives 30 October, not the 31st: it is "the 30th", not "the end
    of the month".

    The cancellation rules read it too. A declaration made after a configured notice
    window lands one period past the term end, and that step used to take its day
    from the term end alone — which, in the month after a short one, has already
    been clamped. An anchor-31 subscription whose term ended 28 February was cut to
    28 March rather than 31 March: three days short of the period the customer had
    just been charged for. `CancellationInput` and `SubscriptionUsageRecord` carry
    `billingAnchorDay` for that.

    `advanceOneCycle`, `periodEndAfter` and `periodEndWithMinLead` take the anchor as
    an optional last argument, and `PeriodRollInput` carries it. Omitted, every one
    of them behaves exactly as before — so the column is additive, and an app that
    does not read it keeps what it has.

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

- 9b5ca2f: Close the last gaps in `@saasicat/adapter-drizzle`: it now serves the plan
  catalogue, the tenant's own subscription writes, and subscription contracts, so
  the persistence contract runs against it with no scenario skipped.

    `drizzlePersistence()` now returns the `catalog` and `tenantBilling` slices, so
    `SaaSiCatModule.forRoot` can discover the plan catalogue, the tenant's billing
    page and the writes behind its buttons without a consumer wiring any of it by
    hand. Four classes are new: `DrizzlePlanRepository`,
    `DrizzleTenantSubscriptionWrite`, `DrizzleSubscriptionContractRepository` and
    `DrizzleSubscriptionUsageAdapter`. The `subscriptions` query map was also
    missing nineteen canonical columns, including `currentPeriodEnd`,
    `billingAnchorDay`, `minimumTermUntil` and `trialEndsAt`; a new derived test
    compares every `pgTable` against the reference schema and fails on an omitted or
    invented column.

    The persistence contract's contract-lifecycle scenario was a placeholder that
    failed if an adapter provided the repository at all. It is now two real
    scenarios — what a contract stores and what ending one does, and how a successor
    takes over — and both adapters plus the in-memory reference implementation pass
    them.

    `@saasicat/core` gains the pieces both adapters were spelling out separately:
    `toPlanRow`, `toPlanVersionRow`, `toSubscriptionContractRecord` and
    `toContractLineItemRecord` map canonical rows to records in one place,
    `previousUtcDay` and `ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES` are the window and
    status rules the adapters share, and
    `CancelSubscriptionInput`/`CancelSubscriptionResult` name a shape that was
    written out three times. `cancelSubscription` keeps the same structural
    signature.

    Two read-then-write windows in the tenant's own writes are closed in **both**
    adapters: an ordinary cancellation no longer restates the status it read a
    moment earlier — a trial going live in between came back as `TRIAL`,
    entitlements and all — and an immediate plan change now locks the row its
    decisions come from.

    One reading changes as a consequence: a `publishedChanges` column holding
    something other than an array now reads as `null` in the plan-catalogue
    projections rather than being cast, which is what the other mappers already did.

### Patch Changes

- a472382: An adapter offers only what it can answer

    `PrismaPlanRepository` declared `findActivePlanVersion` and `terminate`
    unconditionally and threw inside them when the schema could not support them.
    Both are optional in the port, and every caller guards the way an optional
    member invites — `findActivePlanVersion?.(…) ?? findLatestLivePlanVersion?.(…)`
    in three services, `typeof this.repo.terminate !== 'function'` in
    `PlanVersionsService`. Those guards test whether a member is **there**, not
    whether it is willing, so all of them passed and the throw escaped.

    For a consumer whose schema predates the validity-window columns that meant
    HTTP 500 on the tenant bundle preview, the checkout offer and the public
    marketing catalogue, instead of the newest-live fallback the error message
    itself recommended — and a raw 500 on plan-version termination where the
    service had `PLAN_TERMINATE_NOT_IMPLEMENTED` ready.

    Both are now assigned in the constructor only when the schema carries the
    columns, which is what `PrismaBundleRepository.findActiveBundleVersion` has
    always done. No consumer on the current schema is affected.

- Updated dependencies [d492281]
- Updated dependencies [89eed2b]
- Updated dependencies [9b5ca2f]
    - @saasicat/core@1.0.0-rc.7

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
    - @saasicat/core@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- @saasicat/core@1.0.0-rc.5

## 1.0.0-rc.4

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
    - @saasicat/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- @saasicat/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 3ebc363: **`saasicat schema apply` now appends the enums a fragment declares, above the models that use
  them.** It used to copy models only, so a fresh schema ended up with `Subscription.billingCycle`
  and no `BillingCycle` — twenty Prisma validation errors at quickstart step 3 for anyone who had
  not pasted the enums in by hand. An enum the schema already declares is left untouched, as models
  are. Found by installing the 1.0 candidate from npm into an empty project; the example app had
  carried the enums since before the command existed, so nothing in the repository saw the gap.

    **Every package with an exports map now exports `./package.json`.** Seven did not, and a bundler
    plugin, `vue-tsc` or pnpm reading the manifest got `ERR_PACKAGE_PATH_NOT_EXPORTED`.
    **`saasicat init` names two more things the generated wiring needs.** The `forRoot` block now
    carries `imports: [YourPrismaModule, YourAuthModule]` the way it carries `YourAuthGuard` — it does
    not compile until you name them — because `prismaPersistence({ client: PrismaService })` is
    resolved inside the platform module, which sees only what that list holds or what is `@Global`.
    Left out, the generated app compiled and stopped on its first boot with "Nest can't resolve
    dependencies of … (PrismaService)". And `init` now refuses a `tsconfig.json` whose
    `moduleResolution` is `node`: the files it writes import subpath exports, which only `node16`,
    `nodenext` or `bundler` resolve. The quickstart says so too.

    **`create-saasicat-admin` scaffolds an app that type-checks.** Its `platform-loaders.ts` still
    passed `getAuthToken` to `createPlatformLoaders`, an option the 1.0 line no longer has, so every
    fresh admin failed `vue-tsc` on its first run. The scaffolder's tests now type-check a scaffolded
    app against the `@saasicat/ui-vue` it was scaffolded for.
    - @saasicat/core@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies [8aced6f]
    - @saasicat/core@1.0.0-rc.1

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

### Patch Changes

- Updated dependencies [9449492]
    - @saasicat/types@1.0.0-rc.0

## 0.27.0

### Minor Changes

- 0a46f7f: Backend integration: a generator, a boot that refuses a broken licence chain,
  and configuration errors that arrive all at once.

    **`saasicat init`** scaffolds the platform wiring — app config, persistence
    bundle, feature-UI registry, manifest contribution, admin module, one provider
    per `--quota=key:Model`, a password hasher — and adds
    `SaaSiCatModule.forRoot(...)` to an existing `src/app.module.ts`. What was
    thirteen files to create by hand is now none: what stays yours is what each
    quota counts, the hasher if scrypt is not enough, and your auth guard. The
    command prints all three as next steps and refuses to overwrite an existing
    file. A value flag written without `=` is a usage error rather than an internal
    one, `--app-name="My App"` produces `MyAppAdminModule` while the catalogue keeps
    the words, and a root module whose last import spans several lines is no longer
    cut open at its opening brace.

    The generated module does not compile until you name that guard — it writes
    `controller: { guards: [YourAuthGuard] }`, a symbol that does not exist, and
    `tsc` says so once. An empty array would have compiled, and `[]` is this
    platform's word for _deliberately_ unauthenticated: the discovery and manifest
    endpoints would have answered to anyone.

    **`saasicat init` refuses what the platform would refuse, before it writes
    anything.** Everything in `config/saas.yaml` is validated against the catalogue
    schema at boot, so every rule the generator skipped was one the integrator met
    after every file had been written and `app.module.ts` patched. Three of them
    each produced an application that could not start: a project key outside
    `^[a-z][a-z0-9-]{1,30}$`, a quota key with a separator (`active-seats` — the
    plan's `quotas` object forbids additional properties), and no `--quota` at all,
    which wrote `quotas: {}` where the schema requires at least one. `--quota` is
    therefore required now. All three rules are read off the schema rather than
    restated, and the suite loads the generated catalogue with the platform's own
    loader.

    **A broken enforcement chain no longer boots.** `@RequireFeature` and
    `@EnforceQuota` with nothing able to resolve a tenant to a plan used to be
    silent — the routes answered, the quotas read as unlimited, and the first signal
    was a customer using something they never bought. `EnforcementChainCheck` now
    refuses the boot, after bootstrap where the annotated routes are visible, and
    names them. Same for `globalFeatureGuard: false` with a route that has no
    feature guard in front of it. An application with no annotations at all still
    boots: a catalogue without enforcement is a real shape.

    **Breaking:** an application in any of those states will stop starting. Neither
    known consumer is affected: every `@RequireFeature` in both sits in a file that
    also binds a feature guard, and neither has a single `@EnforceQuota` route, so
    the quota branch cannot fire for them. `FeatureGuardCoverageCheck` is renamed to
    `EnforcementChainCheck`.

    Quotas are asked about separately from features, because only the static stack
    registers `EnforceQuotaInterceptor`: an application on the V3 entitlement path
    with no plan resolver enforces `@RequireFeature` correctly and cannot enforce
    `@EnforceQuota` at all. That combination used to boot with every quota reading
    as unlimited.

    Two shapes the check cannot recognise and correctly enforces anyway: a feature
    guard of your own that wraps ours without carrying `FEATURE_GUARD_MARKER`, and
    one bound globally as an `APP_GUARD` rather than per controller. Set
    `enforcementChainCheck: false` if that is you — it turns off this check and
    nothing else.

    **Configuration problems arrive together.** The fifteen checks in `forRoot` are
    a rule table now: a misconfigured application gets the complete numbered list on
    the first boot, each entry with its rule id and a link to
    `docs/reference/options.md` — which is generated from that table. Five missing
    bindings used to cost five restarts.

    **`saasicat schema migrate`** writes the migration with `--create-only`,
    appends the constraints Prisma's DSL cannot express, and then applies it — or
    stops before applying, if appending failed, because the advice it prints then
    (add the SQL by hand first) is only followable while the migration is unapplied
    —
    instead of asking you to paste them in. Only the constraints whose tables that
    migration creates, so a run scoped with `--fragments` is not failed by an index
    on a table it never made.

    And `schema apply`/`schema migrate` take `--tenant-model` / `--user-model` to
    enable the foreign keys from the platform tables to your own models. A name your
    schema does not declare is refused, with the list of names it does; a relation
    whose opposite field your model does not carry stays commented and the command
    prints the exact line to add, because writing it would produce a schema Prisma
    refuses.

    **`PrismaAdminResourcesAdapter` takes a mapping.** `adminResources: { delegates:
{ tenant: 'organization' }, fields: { tenant: { isActive: 'enabled' } } }` — an
    application whose models are named differently no longer has to set
    `adminResources: false` and lose every SuperAdmin endpoint. A mapped delegate
    the client does not have fails at construction and lists the ones it does. The
    shape is still the boundary: an m:n tenant/user relation implements
    `AdminResourcesPort` itself.

    **`@saasicat/ui-vue`** completes the resource descriptors: bundles, bundle
    versions, catalogue entries, discovery, marketing, promo codes, promotions,
    users, subscriptions, and the by-slug tenant operations — 13 descriptors over 54
    operations, each held to the same request as the composable or admin client it
    mirrors.

    Internal: `saas-platform.module.ts` is 244 lines instead of 1,240, with one
    composer file per feature; two redundant port barrels are gone from
    `@saasicat/types`; and ESLint now enforces the nest domain boundaries with no
    exemptions.

- 40e270c: **The license changes from Apache-2.0 to PolyForm Shield 1.0.0.** SaaSiCat is
  source-available from this release on, not OSI open source.

    What stays permitted, and it is nearly everything: reading the code, running it,
    changing it, redistributing it, and building and selling your own SaaS product on
    top of it. What is not permitted is offering a product that competes with
    SaaSiCat itself, or with a product its author provides using it. There is no time
    limit and no reversion to a permissive license.

    **Versions up to and including 0.26.1 remain Apache-2.0.** Rights granted with a
    published version cannot be withdrawn, and npm versions are immutable — if you
    depend on 0.26.1 or earlier, nothing about your terms changes until you upgrade.

    Practically: if you use SaaSiCat to build an application, this changes nothing
    for you. If you were planning to repackage SaaSiCat itself as a product, it does.

    The reasoning, the alternatives that were weighed, and the consequences are in
    [ADR 0001](https://github.com/uelker70/saasicat/blob/main/docs/adr/0001-source-available-licensing.md).

### Patch Changes

- Updated dependencies [0a46f7f]
- Updated dependencies [40e270c]
    - @saasicat/types@0.27.0

## 0.26.1

### Patch Changes

- @saasicat/types@0.26.1

## 0.26.0

### Patch Changes

- @saasicat/types@0.26.0

## 0.25.0

### Patch Changes

- @saasicat/types@0.25.0

## 0.24.2

### Patch Changes

- @saasicat/types@0.24.2

## 0.24.1

### Patch Changes

- @saasicat/types@0.24.1

## 0.24.0

### Patch Changes

- @saasicat/types@0.24.0

## 0.23.0

### Patch Changes

- @saasicat/types@0.23.0

## 0.22.2

### Patch Changes

- @saasicat/types@0.22.2

## 0.22.1

### Patch Changes

- @saasicat/types@0.22.1

## 0.22.0

### Patch Changes

- @saasicat/types@0.22.0

## 0.21.0

### Patch Changes

- @saasicat/types@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [6c0d40d]
    - @saasicat/types@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [0c17a83]
- Updated dependencies [b01eaa0]
- Updated dependencies [edfbdfe]
    - @saasicat/types@0.19.0

## 0.18.1

### Patch Changes

- @saasicat/types@0.18.1

## 0.18.0

### Patch Changes

- @saasicat/types@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [cbd1737]
    - @saasicat/types@0.17.0

## 0.16.0

### Patch Changes

- @saasicat/types@0.16.0

## 0.15.1

### Patch Changes

- @saasicat/types@0.15.1

## 0.15.0

### Patch Changes

- @saasicat/types@0.15.0

## 0.14.0

### Patch Changes

- @saasicat/types@0.14.0

## 0.13.0

### Minor Changes

- 362a1a7: Thread the caller's `TransactionContext` through the entitlement lookup ports.

    `EntitlementService.deriveLimits` used to call
    `SubscriptionContractRepository.findActiveByTenantId`,
    `SubscriptionBundleRepository.listActiveBySubscription` and
    `BundleRepository.findVersionById` without the surrounding transaction. Inside
    `enforceLimit` — which holds the subscription row lock in an interactive
    transaction — every one of those lookups therefore had to draw an **extra**
    pool connection. Once N parallel `enforceLimit` calls occupy N pool slots, the
    lookups starve, nothing ever completes and all transactions expire
    (observed in production-like load: 10 parallel creations at the limit against
    the node-pg default pool of 10 → 0/10 succeed).

    The three port methods now accept an optional trailing `tx?: TransactionContext`
    (backward compatible — existing adapters keep working unchanged), the service
    forwards its transaction, and the Prisma adapters query on the transaction
    connection when it is provided.

### Patch Changes

- Updated dependencies [362a1a7]
    - @saasicat/types@0.13.0

## 0.12.1

### Patch Changes

- @saasicat/types@0.12.1

## 0.12.0

### Patch Changes

- @saasicat/types@0.12.0

## 0.11.0

### Patch Changes

- @saasicat/types@0.11.0

## 0.10.1

### Patch Changes

- 30ec6c6: Make the plan-catalog snapshot deterministic, and close two gaps in the
  shared-CJS-bundle work.

    - `PrismaPlanCatalogReadSink` ordered plans and feature entries by `sortOrder`
      alone — not a total order, so rows sharing a value came back in whatever
      order Postgres picked, and the live plan-version query had no ordering at
      all. The snapshot feeds the admin-manifest hash, so two processes reading
      identical data disagreed on the hash: `GET /admin/manifest` and a CLI
      `manifest hash` could never be compared. All three queries now carry a
      deterministic tiebreaker.
    - The public entry list is derived from `package.json` `exports` instead of
      being repeated in the tsup config, the stub generator and the identity test.
      A new entry that was added to only some of those copies kept its own
      duplicated CJS bundle — silently reintroducing the split class identities the
      shared bundle exists to prevent. The build now fails with an actionable
      message instead.
    - `globalFeatureGuard`'s documentation named the wrong class. The option
      unbinds `StaticFeatureGuard`, not `FeatureGuard` — they are different
      classes backed by different entitlement paths — and neither the JSDoc nor
      the migration guide said that a replacement guard MUST be bound. An app
      following the old wording would have left every `@RequireFeature` route
      serving unlicensed traffic.
    - @saasicat/types@0.10.1

## 0.10.0

### Minor Changes

- 7145f07: Make the CommonJS entry points share one set of objects, and open the seams a
  consumer app needs when its shape does not match the standard stack's defaults.
  Each of these was previously unreachable, so an app that hit one had to abandon
  `SaaSiCatModule` entirely rather than configure around it.

    - **The CJS build now emits one shared bundle** (`dist/_entries.cjs`) with a
      thin re-export per entry, instead of a separate bundle per entry. esbuild
      cannot code-split CommonJS, so every shared module used to be copied into each
      entry — and since Nest resolves providers by class reference, two copies of a
      class are two different providers. Composing `SaaSiCatModule` (from
      `./platform`) with `SetupModule` (from the root entry) failed at boot with
      "MfaService is not available in the SetupModule module". ESM was already
      code-split and unaffected. Consumers no longer need to know which entry a
      class "really" comes from.
    - Exported DI tokens that were still plain `Symbol()` are now `Symbol.for`,
      per the rule in `CONTRIBUTING.md` — 42 of them, including
      `ADMIN_MANIFEST_CONFIG`. The catalog and billing `FEATURE_UI_REGISTRY_TOKEN`
      stay deliberately distinct and are now namespaced apart rather than colliding
      by accident.
    - `@saasicat/nest/platform` additionally re-exports the modules and services an
      app composes alongside `SaaSiCatModule` (`AdminModule`, `AdminManifestModule`,
      `AdminStatsModule`, `SetupModule`, `CheckoutOfferModule`,
      `SubscriptionContractModule` and their services), so the standard stack can be
      assembled from a single import path.
    - New `globalFeatureGuard` option. The module bound `StaticFeatureGuard` as a
      global `APP_GUARD` unconditionally. Nest runs every global guard before every
      controller-local one, so apps that authenticate in a controller-local guard
      got a 403 on all feature-gated routes before authentication had run. Set
      `false` to bind the guard behind your own auth guard instead. The quota
      interceptor stays global either way — interceptors run after all guards.
    - `includeManifestController` is now passed through to `AdminManifestModule`.
      Apps serving `GET /admin/manifest` from their own controller could not
      suppress the platform one, and two controllers on one path abort the boot with
      a duplicate-route error.
    - `prismaPersistence()` accepts a `bundle` option forwarded to both bundle
      repositories it builds. Because the bundle constructs them directly rather
      than through Nest DI, the repository's `@Optional()` options provider never
      applied, leaving `validityWindows` unreachable — bundle publishes then
      silently dropped `validFrom`.

### Patch Changes

- @saasicat/types@0.10.0

## 0.9.0

### Minor Changes

- b30a110: Add a high-level SaaSiCat standard stack that wires catalog, entitlements,
  tenant billing and subscription bundles from one persistence bundle. The
  Prisma bundle now includes the canonical catalog and tenant-billing adapters,
  including a reusable subscription usage mapper and standard Admin resource
  adapter. Tenant, user, audit and subscription controllers plus promo-code CRUD
  can now be enabled with two flags. The Vue client supplies the matching
  resource loaders and actions. Existing fine-grained modules and adapter
  overrides remain available.

### Patch Changes

- Updated dependencies [b30a110]
    - @saasicat/types@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [1003a52]
    - @saasicat/types@0.8.0

## 0.7.0

### Minor Changes

- 05729ce: Add explicit, backwards-compatible Prisma schema profiles for semantic
  plan-key and normalized Plan UUID bindings, configurable catalog and
  entitlement delegates, opt-in PlanVersion and BundleVersion validity windows,
  and atomic tenant plan/PlanVersion writes including onboarding rollback.
  Atomic onboarding is exposed only through an explicit schema opt-in; pending
  PlanVersion acceptance now uses a compare-and-set guard, and active-version
  selection consistently puts legacy null validity dates last.
  Opt-in SubscriptionBundle booking counts let the shared subscription adapter
  preserve BundleVersion editability without requiring the junction table.
  Active subscription counts now derive their authoritative plan identity from
  PlanVersion and Plan, stay scoped to the requested project, and ignore drifted
  denormalized Subscription plan values. The configured
  `tenantSubscription.delegate` is now honored by every subscription ORM
  operation, including transactional reads; locked reads retain the canonical
  physical `subscriptions` table contract.

    Extend the executable persistence contract with semantic identity,
    plan-binding, validity-window, auto-succession, and transactional promo
    redemption rollback scenarios. Catalog lifecycle scenarios now take their
    project identity from the required contract `projectKey` option.

    Run the optional contract freeze after every successful onboarding plan
    change, regardless of whether the adapter uses atomic onboarding or the
    legacy sequential fallback.

### Patch Changes

- Updated dependencies [05729ce]
    - @saasicat/types@0.7.0

## 0.6.0

### Minor Changes

- 98274fe: Ship the catalog-plane Prisma repositories so a consumer can wire the full
  SuperAdmin surface without hand-writing adapters.

    `@saasicat/adapter-prisma` previously covered only the core/entitlement/promo
    slices; every app that wanted the plans/bundles/discovery-review/
    marketing pages had to implement ~2000 lines of catalog repositories itself. The
    package now exports them:

    - `PrismaPlanRepository` (`PlanRepository`)
    - `PrismaBundleRepository` (`BundleRepository`)
    - `PrismaCatalogEntryRepository` (`CatalogEntryRepository`)
    - `PrismaMarketingProjectionRepository` (`MarketingProjectionRepository`)
    - `PrismaMarketingSettingsRepository` (`MarketingSettingsRepository`)
    - `PrismaPromotionRepository` (`PromotionRepository`)
    - `PrismaSubscriptionContractRepository` (`SubscriptionContractRepository`)

    Wire them into `CatalogModule.forRoot({ planRepository: { useFactory: (p) => new
PrismaPlanRepository(p), inject: [PrismaService] }, … })`. Each targets the
    canonical `@saasicat/spec` schema; the generic `PrismaModelDelegateLike<Row>`
    helper is also exported for adapters that need a narrow client view.

    Methods that depend on columns the canonical fragments do not carry
    (`PlanVersion`/`BundleVersion` validity windows, plan `terminate`) throw a
    descriptive error rather than silently misbehaving — the same fail-closed policy
    the shipped `PrismaSubscriptionRepository` already uses.

    **`@saasicat/spec`:** the `QuotaCatalogEntry` fragment (06) gained `replaces
String[]` and `successorKey String?`, aligning it with the
    `QuotaCatalogEntryRow` / `UpsertQuotaEntryData` port contract (features already
    had them) so the discovery sync can persist quota succession. The generated
    `sql/reference-schema.postgres.sql` is regenerated to match.

- 0c08fc3: Remove the BusinessType catalog concept across the public contracts, NestJS
  modules, persistence adapters, UI, OpenAPI specification, and canonical database
  schema. Subscriptions now always reference a plan version; bundles remain the
  only composable catalog add-on.

### Patch Changes

- Updated dependencies [0c08fc3]
    - @saasicat/types@0.6.0

## 0.5.0

### Patch Changes

- @saasicat/types@0.5.0

## 0.4.0

### Patch Changes

- @saasicat/types@0.4.0

## 0.3.0

### Minor Changes

- d758318: PostgreSQL-first, ORM-agnostic persistence: ship the complete Prisma golden path and make its semantics verifiable.

    - **`@saasicat/adapter-prisma`** (renamed from `@saasicat/prisma`, which is now deprecated): ships every previously missing adapter — `PrismaTransactionRunner`, `PrismaSubscriptionRepository` (row-locked `findByTenantIdLocked`), `PrismaPlanVersionRepository`, the three promo repositories with atomic `claimSlot`/`releaseSlot`/`markExhaustedIfFull`, `PrismaAuditAdapter` (now targeting the canonical `audit_logs` table incl. `actorTag`), `PrismaAuditQueryAdapter`, `PrismaAuditStatsAdapter`, `PrismaSuperAdminBootstrapAdapter`, `PrismaPlanCatalogReadSink`/`ImportSink` — plus the new `prismaPersistence({ client })` bundle factory.
    - **`@saasicat/types`**: new persistence bundle contract — `SaasicatPersistenceAdapter` with core/entitlement/promo slices, `PersistenceCapabilities` + `assertPersistenceCapabilities` (fail-fast `PersistenceCapabilityError`), `PersistenceProvider<T>`; `PasswordHasher` moved here from `@saasicat/nest/registration` (re-exported there).
    - **`@saasicat/nest`**: `SaasPlatformModule.forRoot({ persistence })` consumes adapter bundles (individual `adapters` entries still override field by field) and refuses to boot entitlement without transactions + pessimistic locking.
    - **`@saasicat/persistence-testing`** (new): the executable persistence contract — one node:test suite every adapter must pass against a real database (row-lock serialization, transaction rollback, exactly-once promo claims, unique redemption guard, tenant isolation, audit/MFA roundtrips). CI runs it for adapter-prisma against PostgreSQL 16.
    - **`@saasicat/spec`**: the data model is now normatively anchored in `docs/data-model.md` + `sql/constraints.postgres.sql`, with `sql/reference-schema.postgres.sql` generated from the prisma-fragments (drift-guarded in CI). Fragment fixes: `AuditLog.actorTag` column, new fragment `10-super-admin.prisma`, `FeatureCatalogEntry.core/requires/replaces/successorKey`, missing `BusinessTypeVersion↔Subscription` opposite relation.

### Patch Changes

- Updated dependencies [d758318]
    - @saasicat/types@0.3.0

## 0.2.1

### Patch Changes

- @saasicat/types@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [c94b1fe]
    - @saasicat/types@0.2.0
