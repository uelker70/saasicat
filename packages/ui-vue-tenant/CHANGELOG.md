# @saasicat/ui-vue-tenant

## 1.0.0-rc.25

### Minor Changes

- 5a4e6ca: A newer version of a booked add-on is offered beside the booking

    A booking keeps its add-on version, and a newer one of the same add-on is
    offered beside it in the plan section and on the tenant's add-on page
    (`SC-BUN-057`), judged with the price in the rhythm the booking is billed in.
    An improvement and more for more are taken at once, keeping the booking's
    period, terms and minimum term, and the journal charges what a dearer version
    costs for the rest of the booking's period (origin `bundleChange`), nothing
    otherwise (`SC-BUN-058`). One that takes something away is scheduled for the
    end of the booking's term, and the quarter-hour run makes it then
    (`SC-BUN-059`); a plan change asks that version as it asks a retirement's
    replacement, and both where a booking has both (`SC-BUN-061`). With version
    notices on, each booking is told once (`SC-BUN-060`).

    - **Migration:** run `1.0-an-add-on-switch-waits-for-its-term.postgres.sql`
      before `db push`, then `constraints.postgres.sql`. `subscription_bundles`
      gains `pendingBundleVersionId` and `pendingVersionEffectiveAt`; fragments 05
      and 11 name the two relations between `BundleVersion` and
      `SubscriptionBundle`. A second run of the migration changes nothing.
    - **Your port** is handed a new kind, `bundle-version-offered`
      (`BundleVersionOfferedNotice`). A port that switches on `kind` adds it.
    - **A repository of your own** returns the two new fields and gains the
      optional `scheduleVersion`, `unscheduleVersion` and
      `listScheduledVersionsDue`; without them a version that takes something away
      is not offered. A contract harness without them declares `bookingsScheduled`.
    - **Routes:** `POST /billing/subscription-bundles/:id/version-offer/accept`
      with `{ bundleVersionId }`, for the tenant's administrators and audited; a
      version that is no longer offered is refused with
      `BUNDLE_VERSION_OFFER_CHANGED` and the offer as it stands. The booking list
      carries `offer` and `pendingVersion`. The early switch to a
      retirement's replacement is audited too, and like the plan's switches it now
      needs the request to name its user.
    - **Checkout:** `CheckoutOfferService.conclude` refuses a tenant whose contract
      is in force when the offer's would take effect, or begins after it
      (`CHECKOUT_OFFER_CONTRACT_IN_FORCE`, `SC-MKT-028`), and an offer naming
      another version of an add-on the tenant has booked
      (`CHECKOUT_OFFER_ADD_ON_BOOKED_IN_ANOTHER_VERSION`, `SC-MKT-029`).
    - **Beside a told retirement**, a version offer — of a plan or of an add-on —
      leaves the replacement to the early switch, which holds the price, and offers
      nothing that takes something away until the move has been made; a newer
      version that applies at once stands beside the notice (`SC-SUB-040`,
      superseding `SC-SUB-020`). In a trial the replacement waits for the trial
      to end, as the early switch does; an add-on booking that ends by the
      retirement's date is offered as any other.
    - An application with a scheduler of its own calls
      `BundleVersionNoticeService.sendDue` and, after the moves,
      `BundleVersionSwitchRunService.switchDue`.

- b4a961d: A subscriber shows what holds its next contract back

    Where `config/saas.yaml` names a tax adapter, a contract names its subscriber
    only with the whole address an invoice names (`SC-PRIC-069`), and the operator
    and the tenant both see what holds a subscriber's next contract back
    (`SC-PRIC-070`). Without an adapter nothing is refused and nothing is marked.

    - **Every way a contract comes about** — a sign-up, an offer, a plan change,
      an add-on, a full re-freeze — refuses a subscriber without its street and
      number, postal code, city and country with the new code
      `422 SUBSCRIBER_IDENTITY_INCOMPLETE`, the empty fields in `params.missing`,
      before the adapter is asked. A refresh that keeps the parties a running
      contract names is not refused. Fill in the address of every subscriber a
      sign-up did not create through `SubscriberService.changeContactOfTenant`
      before deploying with an adapter. A scheduled run refused this way — a
      retirement's move of a plan or an add-on, an add-on switch taken for the end
      of its term — records `identity-incomplete`, the empty fields in `missing`.
    - **`SubscriberService.readinessFor`** answers a subscriber's standing — the
      empty address fields and the adapter's sentence where it supports no
      treatment — computed from the record and the adapter as they are then; `null`
      without an adapter. An adapter that fails is not read as a refusal.
    - **The operator** sees a tenant's subscriber beside the tenant,
      `GET admin/tenants/:slug/subscriber`, announced as `subscribers.read`: its
      address, whether it acts as a business, its VAT id and whether the check that
      counts found it valid, and its standing. `GET admin/subscribers/attention`
      answers which of up to 200 tenants are held back and why; the manifest
      announces `subscribers.attention` only where an adapter decides. Both are
      mounted wherever `adminResources` is on and a subscriber repository is
      composed, and run inside the RLS bypass. `TenantDetailPage` shows the
      subscriber with a warning naming each reason, and `TenantsPage` and
      `SubscriptionsPage` mark each tenant held back.
    - **The tenant** reads `business` and `readiness` from `GET` and
      `PATCH billing/details`; `TenantBillingSection` shows the customer type and
      what to add, and the notice goes once nothing holds the contract back.
    - **Ports.** `SubscriberRepository.listForTenants(tenantIds, tx?)` is new and
      required — both shipped adapters and the persistence contract have it — and
      `AdminSubscriptionListRow.tenant` carries the tenant's `id`, which
      `PrismaAdminResourcesAdapter` gives. `TenantBillingDetailsShape` gains
      `business` and `readiness`.
    - **A contract is decided for the party it copies.** The subscriber is read
      once per contract, and its rate decided from that read: a change landing in
      between can no longer leave a contract naming one party at a rate decided
      for another. `SubscriberService.contractPartiesFor` is now
      `contractPartyFor(tenantId, { forTaxAdapter }, tx?)`, answering the parties
      and the tax origin of the same read.

- 8683c32: A booking may switch to its retirement's replacement before the date

    Until its date, a booking on an add-on version being retired may move to the
    replacement at once, beside the add-on's notice in the plan section and on
    `MySubscriptionBundlesPage` (`SC-BUN-054`). The switch keeps the booking, its
    period, its terms and its rhythm, and writes the contract the move at the date
    would have written, so nothing is left to move then.

    - **The price is held until the date** (`SC-BUN-055`). Where the replacement
      costs more for the plan the add-on runs beside, in the booking's rhythm, the
      contract records the difference as a generated discount line, and the charge
      journal takes it off each of the booking's periods before the date. The
      difference stays as agreed when the plan changes after the switch. Where the
      replacement costs the same or less, its price applies from the booking's next
      period.
    - **When it is open.** After a trial, for a booking that runs past the date —
      a cancellation landing after it stands — and only while neither the plan nor
      its rhythm changes before the date: a scheduled change, or a told retirement
      onto another plan, refuses it with `BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES`
      (`bundleName`, `date`); one onto another version of the same plan does not.
      Switching ends the cancellation without the minimum term.
    - **The route** is `POST /billing/subscription-bundles/:id/retirement/switch`
      with `{ bundleVersionId }`, behind `TenantAdminGuard`; a page that showed
      another version is refused with `RETIREMENT_SWITCH_CHANGED` and the retirement
      as it stands. The booking list carries `retirementSwitch`
      (`BundleRetirementSwitchTerms`): what switching now costs, and in which
      rhythm.
    - **UI.** `useTenantBilling().switchBundleToReplacement` and
      `useTenantSubscriptionBundles().switchToReplacement`; `BundleRetiredNotice`
      offers the switch with a confirmation that says what it costs until the date
      and after it, and `TenantBundleStore` emits `switch` and takes `switchingId`
      and `note`. New catalogue keys `bundleRetiredSwitch*` and
      `bundleRetiredSwitched`.
    - **The add-on list** no longer shows a retirement beside a booking whose
      subscription ends by the date: like a booking cancelled to end by then, it
      never moves (`SC-BUN-046`).

- cf12963: An operator can retire an add-on version for the bookings on it

    An add-on version no longer on sale can be retired the way a plan version is:
    the bookings on it are told that they continue on the add-on's version on sale,
    each at the first end of its own period at least three calendar months after
    its notice reached an administrator (`SC-BUN-038` to `SC-BUN-048`). It rests on
    the same `tenantBilling.orderlyRetirement.termsConfirmed`.

    - **Wiring.** Adopt `prisma-fragments/19-bundle-version-retirement.prisma` and
      run `sql/1.0-an-add-on-retirement-is-announced.postgres.sql` once, or pass
      `notAdopted: ['BundleVersionRetirement']`, which leaves it off. Both shipped
      bundles provide `persistence.tenantBilling.bundleVersionRetirements`. The
      routes are `GET` and `POST /admin/catalog/bundle-versions/:id/retirement` —
      the announcement behind the second factor — and
      `GET /admin/catalog/bundle-version-retirements`; the manifest announces them
      as `bundleVersions.retire`. With `versionNotices.includeCron: false`, call
      `VersionRetirementService.sendUndelivered` and
      `BundleVersionRetirementService.sendUndelivered` from your scheduler: a
      retirement whose notice is not sent waits for it.
    - **Notices.** One `bundle-version-retired` notice per booking, through the
      same `SubscriptionNoticePort`: the plan the add-on runs beside at the date,
      both versions with their prices for that plan, the booking's rhythm, the date
      and the last day to cancel without the minimum term. A port that narrows on
      `notice.kind` has to handle the new kind.
    - **Twelve months, plan and add-on together.** A retirement of either kind is
      refused for a subscription told of either within twelve months
      (`SC-BUN-041`), counted from delivery — for plan versions too. A notice still
      waiting holds no announcement back; when it can go out at last, it waits
      instead while another was told within the twelve months (`SC-SUB-038`
      supersedes `SC-SUB-036` to say so).
    - **Every plan from the date.** The replacement has to run beside the plan each
      booking runs beside at its date — a scheduled change and a told retirement of
      the plan version included, which the notice's prices follow too — and beside
      every plan the subscription is set to move to after it (`SC-BUN-044`). After
      an announcement, the tenant's own plan change, a plan version's retirement
      onto another plan and its early switch are refused where the version a booking
      continues on could not run beside the plan the subscription moves to: while
      that date is ahead and the booking is not cancelled yet,
      `BUNDLE_REPLACEMENT_DOES_NOT_FIT_TARGET_PLAN` and
      `RETIREMENT_SWITCH_BUNDLE_REPLACEMENT_CANNOT_FOLLOW` name that version and its
      date, since cancelling it then ends it before the date. A notice that waited
      goes out only while what it announces still fits at its date — an add-on's
      replacement beside the plans the booking meets, a plan's replacement with the
      add-ons then held; until then it waits.
    - **Cancelling.** Until its date, a booking it reached is cancelled without its
      minimum term, at the end of the period running; the tenant's route and its
      preview decide that by the server's clock, and
      `CancelBundleFromSubscriptionInput` and `previewCancel` take
      `minimumTermLapses`. A booking it did not reach is not reinstated while it
      runs: `BUNDLE_RETIREMENT_REINSTATE_REFUSED` names the day the replacement can
      be booked from (`bookableFrom`),
      `BUNDLE_RETIREMENT_REINSTATE_SUBSCRIPTION_ENDS` says the subscription ends by
      then too, and `BUNDLE_RETIREMENT_REINSTATE_REPLACEMENT_CANNOT_RUN` that the
      replacement cannot run beside the subscription's plans. A booking cancelled to
      end by its date no longer shows the retirement.
    - **New refusals** in the preview: `BUNDLE_RETIREMENT_VERSION_ON_SALE`,
      `BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE`,
      `BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE`,
      `BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN` and
      `BUNDLE_RETIREMENT_NOTHING_AFFECTED`. An announcement is audited as
      `BUNDLE_VERSION_RETIRE`.
    - **Ports.** `SubscriptionBundleRepository.listOfVersion` and
      `SubscriptionUsagePort.listByIds` are optional and in both shipped adapters; a
      start with confirmed terms is refused without them. The persistence contract
      gains the `bundleVersionRetirements` member and the gaps
      `bundleVersionRetirements`, `bookingsOfVersion` and `subscriptionsById`.
      `PlanAhead` carries an optional `by`: what moves the subscription to that
      plan, a change it scheduled or a retirement it was told of.
    - **Admin UI.** The status of an add-on version no longer on sale offers
      "Retire…", with a dialog that shows the list prices, the dates, the bookings
      not reached and every blocker before anything is sent, and a retired version
      says onto which version and how far that has come. New:
      `useBundleVersionRetirement`, the `bundleVersionRetirements` resource and the
      catalogue keys `bundles.retireDialog.*` and `bundles.statusBanner.retire*`,
      `retired*` and `retirementsUnreadable`. The plan cockpit and the add-on page
      share the dialog and the progress words, which move from
      `planDetail.versions.retiredProgress.*`, where 1.0.0-rc.24 put them, to
      `common.retirementProgress.*`; the progress chip's class moves from
      `pd-retirement-progress` to `sa-retirement-progress`. An application that
      overrides either renames it. A deleted add-on now reads "Deleted"; its keys
      are unchanged.
    - **Tenant UI.** The plan section's add-on list and `MySubscriptionBundlesPage`
      show the retirement beside the booked add-on (`SC-BUN-046`), for which
      `MySubscriptionBundlesPage` takes the optional `formatCurrency`,
      `quotaLabel`, `featureLabel` and `formatQuotaValue`. A refused reinstatement
      is said in the reader's language. The bookings carry `retirement`.

### Patch Changes

- Updated dependencies [5f7a41b]
- Updated dependencies [5a4e6ca]
- Updated dependencies [d34e3e5]
- Updated dependencies [b4a961d]
- Updated dependencies [3258251]
- Updated dependencies [5776198]
- Updated dependencies [8fe675c]
- Updated dependencies [8683c32]
- Updated dependencies [cf12963]
- Updated dependencies [d4830b7]
- Updated dependencies [808cd9f]
- Updated dependencies [3496864]
    - @saasicat/core@1.0.0-rc.25
    - @saasicat/ui-vue@1.0.0-rc.25

## 1.0.0-rc.24

### Major Changes

- f7839c2: Bind a plan change to the version its preview showed, or to nothing

    A plan change is previewed at one moment and submitted at another. When a
    successor's start passed in between, the change bound the version then on sale
    — at a price the customer was never shown. A plan change now names the
    version its preview showed, and the platform reads the preview again when
    it is submitted: it changes only while that version is still the one on sale,
    and binds that version and no other (`SC-CHG-023`). A change scheduled for the
    end of the term is held to the same.

    - `POST billing/plan` takes `planVersionId`, the preview's
      `target.planVersionId`. Naming none where the preview names one is refused
      with 400 `PLAN_CHANGE_VERSION_NOT_NAMED`; naming a version no longer on sale
      is refused with 409 `PLAN_CHANGE_QUOTE_CHANGED`, which carries the current
      `preview`. A change that keeps the plan on a subscription bound to a version
      keeps that version and names none, as does one where nothing reads versions;
      on a subscription bound to none, a change of rhythm names the version on
      sale. The write claims the version the change was decided from, so a change
      made by somebody else in between is refused with 409
      `SUBSCRIPTION_CHANGED` instead of being undone.
    - `@saasicat/core` adds both codes with their messages.
    - `@saasicat/ui-vue`: `useTenantBilling().changePlan` takes the version as its
      third argument, and `PlanChangePreviewShape.target` carries `planVersionId`.
    - `@saasicat/ui-vue-tenant`: `PlanChangeWizard` sends the version of the
      preview on screen, shows the preview a refusal carries, and words a refused
      change in the reader's language; its `changePlan` prop takes the version as
      its third argument.

- f905b7f: Retire the pending version: a newer version is only offered

    A subscription keeps its plan version across every renewal until the
    subscriber takes another (`SC-SUB-024`); a newer version is an offer beside
    the plan (`SC-SUB-020`). The pending version — set by a notice job, accepted by
    the tenant, rolled forward at the end of the term — is gone with everything
    that carried it.

    - `POST billing/subscription/accept-pending-version`,
      `TenantSubscriptionWritePort.acceptPendingPlanVersion`,
      `useTenantBilling().acceptPendingPlanVersion`, `PendingVersionBanner`, the
      seven `pendingVersion*` strings of `TenantPlanSectionI18n`, the error code
      `NO_PENDING_PLAN_VERSION` and its refusal `noPendingPlanVersion` are removed.
      A switch is taken through `POST billing/version-offer/accept`.
    - `decideRenewal` and `clearPendingPlanVersionFields` are removed; a renewal
      keeps the version, and `computeNextPeriod` stays.
    - `SubscriptionUsageRecord`, `GET billing/usage` and `Subscription` carry no
      `pendingPlanVersion*` fields. `prisma-fragments/01-subscription.prisma` and
      `03-plan-versions.prisma` drop the seven columns and their relation, and
      `sql/1.0-a-newer-version-is-only-offered.postgres.sql` drops them from an
      existing database — run it once nothing reads them any more; it discards
      every pending version still recorded, accepted ones included.
    - `countByPlanVersionId` counts the version a scheduled change will bind
      (`pendingChangeVersionId`) beside the version bound, so an operator cannot
      edit a version somebody's switch is waiting for. Both adapters count it, and
      the persistence contract holds a store of your own to it; the harness seed
      writes it as `pendingChangeVersionId`.

### Minor Changes

- d556622: A retired version's subscriptions move to the replacement at their date

    At the date each subscription was told, the platform moves it from the retired
    version onto the replacement, at the replacement's price, keeping its period
    and its term (`SC-SUB-031`). The quarter-hourly run that sends version notices
    does it, and catches up a run that did not happen; with
    `versionNotices.includeCron: false`, call `RetirementMoveService.moveDue`
    yourself. A subscription that has ended by its date, or whose own scheduled
    change takes it off the version by then, is left alone; a change scheduled for
    later survives the move.

    - **What a moved subscription pays.** A plan line of the retired version prices
      no period that starts on or after the date the subscriber was told: the period
      waits for the contract the move writes and is charged at the replacement's
      price, however late that contract comes (`SC-PRIC-062`). A contract a
      retirement writes adds no prorated difference.
    - **Switching early.** Until the date, a subscriber may switch to the
      replacement at once from the plan section — `POST /billing/retirement/switch`,
      for the tenant's administrators, audited as `SWITCH_TO_RETIREMENT_REPLACEMENT`
      (`SC-SUB-032`). The term stays. Where the replacement costs more, the contract
      holds the difference as a discount line until the date, so the subscriber
      pays what they paid until then (`SC-PRIC-063`); where it costs the same or
      less, its price applies from the next period. The switch opens after a trial,
      not while a change is scheduled, and ends the right to cancel without notice.
      New codes: `RETIREMENT_SWITCH_NOT_PENDING`, `RETIREMENT_SWITCH_IN_TRIAL`,
      `RETIREMENT_SWITCH_NOT_OPEN`, `RETIREMENT_SWITCH_CHANGED`.
    - **Ending a replacement.** A version subscriptions still move onto cannot be
      terminated before the day after the last of their dates:
      `PLAN_TERMINATE_BEFORE_RETIREMENT_MOVES` (`SC-PLAN-029`). While a move onto
      it is past its date and not made, it cannot be terminated at all:
      `PLAN_TERMINATE_WHILE_MOVES_OVERDUE`.
    - **Audit.** Each move is recorded as `PLAN_VERSION_RETIREMENT_MOVE`, and a move
      that cannot be made once as `PLAN_VERSION_RETIREMENT_MOVE_FAILED`, by the new
      platform job actor: `AuditActor` is `AdminActor` or `PlatformJobActor`
      (`source: 'job'`, `userId: null`, tag `job:platform:retirement-moves`). An
      `AuditPort` of your own accepts a `null` user; the canonical
      `audit_logs.userId` already is nullable.
    - **`TenantSubscriptionWritePort.changePlanImmediate`** takes
      `keepsPendingChange`: the scheduled change survives the write, and one that
      only moves the rhythm on the plan being left follows the subscription to its
      new plan (`scheduledChangeAfterWrite` in `@saasicat/core`). It also takes
      `restoresQuotedVersion`, which binds the version named whether or not it
      still takes bookings: a move or a switch whose contract cannot be written is
      put back with it, onto the retired version, which is off sale. Both shipped
      adapters honour both and the persistence contract holds them to it; a port of
      your own has to.
    - **The plan cockpit** shows beside a retired version how many of its
      subscriptions moved, wait for their date, are overdue or ended
      (`SC-SUB-033`); `versionRetirements.list` answers `VersionRetirementView`
      with `progress`. The tenant usage carries `retirementSwitch`, and
      `useTenantBilling` gains `switchToReplacement`. New wording keys:
      `planDetail.versions.retiredProgress.*` and `versionRetiredSwitch*`.

- 4f2c108: Offer a newer version of the plan beside it, and switch to it

    `TenantPlanSection` reads `GET billing/version-offer` and, where a newer
    version of the tenant's plan is offered, shows it beside the plan: a card with
    both versions side by side — the net price in each rhythm, each quota, the
    features added and removed — the kind of offer and when a switch would take
    effect. There is nothing to decline and no deadline; the card says the current
    version stays as long as the tenant does not switch.

    - An improvement is taken by one click. More for more and one that takes
      something away ask first, and say what the switch does: charged the prorated
      difference where the rhythm gets dearer, or taking effect at the term end.
    - The page states the outcome — switched now, or scheduled for a date — and
      the plan card names a scheduled switch as a new version rather than as a
      change to the same plan.
    - A refusal is shown in the app's language through `issueMessages`. Where the
      offer moved in the meantime, the card shows the one that now stands.
    - New catalogue keys: `versionOffer*` and `pendingVersionSwitch`, in the
      German and English defaults. An app that passes its own full `i18n` map adds
      them.

- 7cd9d27: Let an operator retire a plan version for the subscriptions on it

    A subscription keeps its version (`SC-SUB-024`). Retiring one is the orderly
    way out: an operator names a replacement on sale, of the same plan or another,
    and every subscription on the version is told that it continues on it at the
    end of one of its terms at least three calendar months after its notice
    reached an administrator (`SC-SUB-035`). Until then it may cancel without
    notice (`SC-CANC-023`). A price increase is a
    retirement whose replacement costs more.

    - **`config/saas.yaml` needs `tenantBilling.orderlyRetirement.termsConfirmed`.**
      It is required, like the notice periods beside it, and a file without it no
      longer loads. `true` states that your terms carry the clause a retirement
      rests on; without it the administration does not offer the action and the
      server refuses it with `RETIREMENT_TERMS_NOT_CONFIRMED` (`SC-SUB-025`).
      The loader names the field it is missing; `saasicat init` writes `false`.
    - Only a version no longer on sale can be retired, for a replacement priced in
      the rhythm each subscription is billed in by then; a retirement that reaches
      nobody is refused, and a subscription is reached at most once in twelve
      months (`SC-SUB-028`) and hears of a version's retirement once. The operator
      sees every subscription it reaches with its date, and every one it does not
      with the reason, before announcing; the announcement names them and is
      refused with `RETIREMENT_PREVIEW_CHANGED` where they changed meanwhile
      (`SC-SUB-026`).
    - Routes: `GET` and `POST /admin/catalog/plan-versions/:id/retirement`, the
      second behind the second factor and audited as `PLAN_VERSION_RETIRE`, and
      `GET /admin/catalog/version-retirements`. The manifest carries
      `planVersions.retire` (`VERSION_RETIREMENT_CAPABILITY`) where they are
      served and the terms are confirmed.
    - Each announcement is kept in the new `version_retirements` table, and each
      subscription it reaches gets a `version-retired` notice in the same
      transaction (`SC-SUB-029`). Adopt
      `prisma-fragments/18-version-retirement.prisma` and run
      `sql/1.0-a-retirement-is-announced.postgres.sql`; both bundles provide
      `tenantBilling.versionRetirements`, which
      `notAdopted: ['VersionRetirement']` leaves out. Confirmed terms with nowhere
      to keep an announcement refuse the start.
    - `SubscriptionNotice` is `version-offered` or `version-retired`. A retirement
      notice carries both versions with their prices (`retired`, `replacement`,
      `changes`), the `billingCycle` it is billed in when the retirement takes
      effect, `effectiveAt` and `lastDayToCancel`. A `SubscriptionNoticePort`
      narrows on `kind`. A notice the port could not send, or the platform could
      not take on, is sent by the quarter-hourly run.
    - `SubscriptionUsagePort.listBoundToVersion` is new and optional; both shipped
      adapters have it, and confirmed terms over a port without it refuse to
      start. A port of your own returns each subscription's
      `pendingChangeVersionId` (new, optional on `SubscriptionUsageRecord`) with
      it, or a subscriber who took a newer version's offer is reached as if they
      stayed.
      `SubscriptionNoticeRepository` gains `record`, `listOfKindSince` and
      `listUndelivered`. The persistence contract holds both; a harness gains the
      `versionRetirements` and `subscriptionUsage` members, or declares
      `gaps: ['versionRetirements', 'boundSubscriptions']`.
    - `versionSale`, `versionOnSale` and `versionOnSaleOrNext` move to
      `@saasicat/core`, where the server decides by them; `@saasicat/ui-vue`
      re-exports them unchanged.
    - `@saasicat/ui-vue`: the plan cockpit offers "Retire…" on a version no
      longer on sale, with a dialog that shows the replacement's prices, the
      dates, the subscriptions not reached and every blocker before anything is
      sent, and marks a retired version with its replacement. New:
      `useVersionRetirement`, the `versionRetirements` resource, and the catalogue
      keys `planDetail.versions.retire*`/`retired*` and `planDetail.retireDialog`.
      The tenant usage carries `retirement`.
    - `@saasicat/ui-vue-tenant`: the plan section shows a retirement beside the
      plan — when the subscription continues on which version, at what price, and
      until when it may cancel without notice — and says the last again in the
      cancellation confirmation (`SC-SUB-030`). New wording keys
      `versionRetired*` and `cancelConfirmRetirement`.

### Patch Changes

- 05b9e78: Keep a booked add-on and the plan it runs beside in step

    A plan change, a retirement and an add-on booking now ask one question the
    same way: can this add-on run beside that plan, allowed there, priced there in
    the rhythm the booking is billed in, and in no longer a rhythm than the plan's.
    A plan change asked only about the rhythm, so an add-on sold for one plan went
    on running after a move to another, at a price nobody had set. And a booking
    made after a change was scheduled could land on the plan that change moves to,
    since a scheduled change lands without looking at add-ons.

    - A plan change is refused while an add-on still booked on the day it lands
      cannot run on the target plan (`SC-CHG-024`): the tenant's own change, the
      plan chosen at onboarding, which is asked about today because it applies at
      once, and the early switch to the replacement of a retirement. The new code
      `BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN` names the add-on, the plan and the
      earliest day the add-on could end; the switch says the same with
      `RETIREMENT_SWITCH_BUNDLE_CANNOT_FOLLOW`. The rhythm part keeps
      `BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE`, which now names the add-on and that
      day too. The day is the one a cancellation would land on, never after the
      subscription ends, and both sentences say what gets past the refusal: the
      add-on cancelled, and a change taking effect on or after that day.
    - A booking, its preview, and the reinstatement of a cancelled booking refuse
      an add-on that cannot run on a plan the subscription is already set to move
      to (`SC-BUN-037`), with the new code `BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN`,
      or `BUNDLE_CANNOT_RUN_ON_UPCOMING_CYCLE` where only the rhythm is in the
      way (both `planKey`, `billingCycle`, `from`): the target of a scheduled
      change from the day it lands, in the rhythm it lands in, and the replacement
      of a retirement the subscription has been told of from its date, for as long
      as the subscription is on the version retired. A reinstatement is refused,
      too, where the add-on cannot run on the plan of today.
    - A retirement is refused while a subscription it reaches still holds, at its
      date, an add-on that cannot run beside the replacement in the rhythm billed
      then (`SC-SUB-037`), with `RETIREMENT_REPLACEMENT_CANNOT_CARRY_BUNDLES`,
      which the plan cockpit words in English and German.
    - The tenant's add-on dialog shows each reason a booking cannot be made in the
      language chosen, through the message catalogue, rather than the English the
      backend sends; two reasons with the same code are shown as two. The shipped
      sentences of `BUNDLE_INCOMPATIBLE_WITH_PLAN` and
      `BUNDLE_NOT_PRICED_FOR_THIS_PLAN` no longer show the version's id or the
      rhythm's raw value.
    - The booking preview names every reason an add-on cannot run beside the plan
      of today at once, as before. `BUNDLE_INCOMPATIBLE_WITH_PLAN` from a booking
      carries `allowedPlanKeys` as one comma-separated string, as the preview's
      always did.

    Breaking where an application wires the modules by hand or calls the booking
    service itself; `SaaSiCatModule` does all of it.

    - `TenantBillingModule.forRoot` takes `bundleRepository` beside
      `subscriptionBundleRepository`, and refuses to start with the one and
      without the other. `SaaSiCatModule` refuses a persistence bundle that has
      the bookings without the add-on versions
      (`tenant-billing.requires-bundle-catalogue`).
    - The add-on route needs `PLANS_AHEAD_TOKEN`, which `TenantBillingModule`
      exports; a module that mounts the route without tenant billing in its scope
      no longer starts.
    - `SubscriptionBundlesService.addBundleToSubscription` and
      `SubscriptionBundlePreviewContext` require `plansAhead`: what the provider
      behind `PLANS_AHEAD_TOKEN` answers for the subscription, or an empty list
      only where nothing is scheduled and no retirement was told.
    - `cancelBundleFromSubscription` requires `subscriptionId`, and
      `reactivateBundle` takes one input naming the subscription, the booking, the
      plan of today and the plans ahead. Both answer a booking of any other
      subscription as not found.

- 7063891: Book an add-on once per subscription, and never one that has been deleted

    A subscription holds an add-on once, whichever version each booking names, as
    `SC-BUN-027` says. A tenant holding version 1 of an add-on could book version
    2 beside it and pay twice for what the two have in common. The booking now
    refuses that with `BUNDLE_ALREADY_SUBSCRIBED` until the first booking has
    ended, and the booking preview says so first. The tenant's add-on store says
    the add-on is booked instead of offering the newer version, and counts a
    booking cancelled for a day still to come as running, as the server does. A
    checkout offer refuses two versions of one add-on as a duplicate, when it is
    made and when it is concluded.

    A version of a deleted add-on can no longer be booked (`SC-BUN-036`). Deleting
    an add-on leaves its versions' dates as they were, and only the tenant's price
    read asked about the add-on itself. So a version still inside its window was
    booked, previewed and put into checkout offers, although the catalogue no
    longer showed it.

    - `@saasicat/core`: a new code, `BUNDLE_DELETED`, with its text in English and
      German.
    - `@saasicat/nest`: the booking and its preview refuse a deleted add-on's
      version with `BUNDLE_DELETED`. A checkout offer refuses it with
      `CHECKOUT_OFFER_BUNDLE_NOT_OFFERED` and the reason `bundle_deleted` when it
      is made, and with `CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE` when it is
      concluded.

    Nothing changes for an application's own repositories. Bookings already
    running are left as they are, and the booking reads the add-on through
    `BundleRepository.findById`, which every repository already implements.

    A test fake of `BundleRepository` does need to answer `findById` for the
    add-on of every version it books. An answer of `null` reads as a deleted
    add-on, a fake without the method fails, and `FakeBundleRepository` from
    `@saasicat/nest/testing` answers only for add-ons given to `seedBundle`.

- c25f062: Show a subscriber the price of the plan version they are bound to

    The plan card read the price off the catalogue, which lists what a new
    customer pays. After a new version of the plan that is not what a subscriber
    on the older one pays, and the card showed them the newer price
    (`SC-SUB-019`).

    - `GET billing/usage` answers with `planPriceNet`: what the plan costs per
      billing cycle, net, at the version the subscription is bound to, priced by
      the rules the contract freeze bills it by. Where the plan repository does not
      read versions (`findVersionById`), or the subscription is bound to none, the
      catalogue's price stands in. It is `null` where the plan has no list price in
      the rhythm, including a version sold under a special contract, and where the
      version bound cannot be read — the plan repository does not find it, or
      finds a version of another plan. The catalogue's price there would be the
      newest one; the rest of the account still answers, and the case is logged.
    - The plan-change preview refuses a change for such a subscription with
      `BOUND_PLAN_VERSION_UNREADABLE` (422) rather than quoting it from the
      catalogue.
    - `PlanChangePreviewService.planPriceNet(subscription)` is where that is read,
      and the preview's current price comes from the same place.
    - `UsageSnapshotShape` in `@saasicat/ui-vue` carries `planPriceNet`, required:
      a fixture typed as that shape adds the field.
    - `TenantPlanSection` shows `planPriceNet` on the plan card rather than the
      catalogue's price.

- Updated dependencies [05b9e78]
- Updated dependencies [f7839c2]
- Updated dependencies [ce7241e]
- Updated dependencies [49e93ab]
- Updated dependencies [109fcce]
- Updated dependencies [f78c15d]
- Updated dependencies [b17333a]
- Updated dependencies [fe07088]
- Updated dependencies [f905b7f]
- Updated dependencies [21ba667]
- Updated dependencies [c69e2af]
- Updated dependencies [381c516]
- Updated dependencies [60e875d]
- Updated dependencies [d556622]
- Updated dependencies [c3b87c8]
- Updated dependencies [4470181]
- Updated dependencies [edb496b]
- Updated dependencies [8a3ee1d]
- Updated dependencies [2cafe45]
- Updated dependencies [b152580]
- Updated dependencies [7063891]
- Updated dependencies [a576414]
- Updated dependencies [e444a9b]
- Updated dependencies [7cd9d27]
- Updated dependencies [e99d6c0]
- Updated dependencies [71937ba]
- Updated dependencies [42b21ab]
- Updated dependencies [22eb81c]
- Updated dependencies [c25f062]
- Updated dependencies [5a6b34a]
- Updated dependencies [536982d]
- Updated dependencies [4eae16a]
    - @saasicat/core@1.0.0-rc.24
    - @saasicat/ui-vue@1.0.0-rc.24

## 1.0.0-rc.23

### Minor Changes

- da4b3b3: An operator announces a maintenance window and locks the application for a
  deploy

    For a migration that transforms data or removes what the running version
    reads, an operator announces a window to the tenants, locks the application
    for the length of the deploy, and unlocks once the new version is healthy
    (`SC-OPS-012` to `SC-OPS-015`). Optional: `maintenance: true` in
    `SaaSiCatModule.forRoot`.

    - While the lock holds, every tenant request is refused with `503`, the code
      `MAINTENANCE`, a `Retry-After` and the announced end, by a global guard
      registered ahead of the feature guard. The administration, the status route
      `GET /public/maintenance`, routes marked `@AllowDuringMaintenance()` and a
      signed-in platform administrator pass; payment callbacks are refused and
      retried by the provider. SaaSiCat's two scheduled jobs skip their run, and
      `MaintenanceService.isLocked()` is what an application's own jobs ask.
    - The lock begins and ends only on command. The announced times are what
      tenants are told; a lock past its end says it is taking longer. Locking what
      is locked and unlocking what is not change nothing and say so.
    - `maintenance_windows` keeps one row per window, at most one open, in both
      shipped adapters (`persistence.core.maintenanceWindows`), with the Prisma
      fragment `16-maintenance-window.prisma` and the migration
      `1.0-maintenance-windows-are-kept.postgres.sql`. The persistence contract
      holds an adapter to it (`maintenanceWindows`).
    - The administration gains a **Maintenance** page, and a strip on every page
      while tenants are locked out. Locking and unlocking there need a
      confirmation and the second factor (`SC-ADM-029`, `SC-ADM-030`).
    - `@saasicat/cli` adds `maintenance status|announce|reschedule|cancel|on|off`
      — `on` returns once every process has had time to see the lock — and a
      `doctor` check that reports a lock and a lapsed announcement.
    - `@saasicat/ui-vue-tenant` adds `MaintenanceGate`: the announcement above the
      application and its sign-in page, one maintenance page while the lock holds,
      and the application again once it is lifted (`SC-UI-026`).
      `reportMaintenanceRefusal` switches it at once from an HTTP interceptor.
    - An optional `MaintenanceNotificationPort` hears of a window announced, moved
      or cancelled, so the application can mail its users.

### Patch Changes

- Updated dependencies [a748f74]
- Updated dependencies [da4b3b3]
    - @saasicat/core@1.0.0-rc.23
    - @saasicat/ui-vue@1.0.0-rc.23

## 1.0.0-rc.22

### Minor Changes

- 89ee3f4: An immediate upgrade runs inside the period already paid, or starts a longer
  one today less the unused rest

    An immediate upgrade opened a new period from the day of the change, which
    moved the day the customer is billed on, while the preview charged the
    difference over the old period — two answers for one change. For a move into a
    longer rhythm the preview took the difference between a year's price and a
    month's over what was left of the month: Standard at 49 a month to Pro at 990 a
    year on day 15 of 30 was quoted at 470.50.

    - In the same rhythm the period and the billing day stay, and the difference is
      charged for what is left of it (`SC-CHG-020`, superseding `SC-CHG-003`).
    - Into a longer rhythm the new period starts today, charged in full less the
      unused rest of the old one at the price paid for it: 990 − 24.50 = 965.50
      in the example (`SC-CHG-021`). The rest is never paid out.
    - What was already paid is priced from the plan line of the contract in force,
      not from today's catalogue, so a customer bought at 19 a month is credited at
      19 after the plan went to 29. Without contracts the catalogue price stands.
    - A subscription with no period yet is charged its first period in full, and
      the preview says so.
    - `ProrationDto` gains `basis` (`difference` or `newPeriod`) and `remainderNet`;
      `computeNewPeriodCharge` is new beside `computeProration`. The plan change
      wizard shows the full price and the rest it is reduced by, with three new
      catalogue keys (`wizardNewPeriodLine`, `wizardRemainderLine`,
      `wizardConfirmDueNow`).

### Patch Changes

- Updated dependencies [82c5ab6]
- Updated dependencies [3663719]
- Updated dependencies [37899b2]
- Updated dependencies [89ee3f4]
- Updated dependencies [123ea4d]
    - @saasicat/core@1.0.0-rc.22
    - @saasicat/ui-vue@1.0.0-rc.22

## 1.0.0-rc.21

### Minor Changes

- abbd6ec: A tenant finds its billing under billing

    The payment method sat at the foot of the plan page, where a tenant looking for
    its billing under billing did not find it. `TenantBillingSection` in
    `@saasicat/ui-vue-tenant` holds the payment method and the billing details in
    one section an application mounts where it keeps billing (`SC-UI-025`); the
    invoices and the account arrive in it later, with nothing to change for a page
    that mounts it now.

    - `GET` and `PATCH /billing/details`, mounted with the tenant's payment method
      routes behind the same guards and the billing permission. A tenant changes
      the address and the invoice email; the street, postal code, city, country and
      invoice email can be replaced but not cleared (`SC-SUB-018`), and the legal
      name and tax identifiers are refused by name — the operator corrects them.
      `SubscriberService.changeContactOfTenant` is the rule behind the route.
    - `useTenantBillingDetails` in `@saasicat/ui-vue` reads and changes them, and
      hides itself on a 403 or 404 as the payment method does.
    - `TenantPlanSection` takes `showPaymentMethod` (default `true`); set it to
      `false` where `TenantBillingSection` is mounted, so the payment method is in
      one place.
    - `TenantPaymentMethodCard` moved to the top level:
      `@saasicat/ui-vue-tenant/TenantPaymentMethodCard.vue`. Its old path under
      `tenant-plan-section/` is gone. It styles its own text now instead of
      borrowing the plan section's, so it reads right wherever it is mounted.
    - `TenantPlanSectionI18n` gains the `billingDetails*` texts, in English and
      German.

### Patch Changes

- Updated dependencies [07c30c6]
- Updated dependencies [877faa4]
- Updated dependencies [4264bfd]
- Updated dependencies [6a83734]
- Updated dependencies [d64bf82]
- Updated dependencies [abbd6ec]
    - @saasicat/core@1.0.0-rc.21
    - @saasicat/ui-vue@1.0.0-rc.21

## 1.0.0-rc.20

### Patch Changes

- @saasicat/core@1.0.0-rc.20
- @saasicat/ui-vue@1.0.0-rc.20

## 1.0.0-rc.19

### Patch Changes

- Updated dependencies [99cbb89]
    - @saasicat/core@1.0.0-rc.19
    - @saasicat/ui-vue@1.0.0-rc.19

## 1.0.0-rc.18

### Patch Changes

- @saasicat/core@1.0.0-rc.18
- @saasicat/ui-vue@1.0.0-rc.18

## 1.0.0-rc.17

### Minor Changes

- 79ec7c4: Take a subscriber's payment method through a payment gateway

    A payment method is entered in the gateway's own form, and SaaSiCat keeps the
    gateway's reference to it for the subscriber, with masked details only.
    Self-registration asks for the billing address and the payment method in step
    4, and activates once the gateway confirms the payment method: the account,
    subscriber, tenant, subscription and payment method are written on the
    transaction the confirmation is claimed on, so a failure rolls all of it back
    and the gateway's retry activates.

    - New `payments` block in `config/saas.yaml` naming the gateway accounts and the
      `returnUrlOrigins` a success or cancel URL has to be at, and
      `SaaSiCatModule.forRoot({ payments: { gateways } })` binding one
      `PaymentGateway` per account. `PaymentsModule` in `@saasicat/nest/payments`
      mounts `POST /webhooks/payment/:account`, which needs the application created
      with `rawBody: true` and a global auth guard that lets
      `isSaaSiCatPublicRoute` through. `DevPaymentGateway` confirms on the spot for
      development and refuses `NODE_ENV=production`.
    - A start refuses gateways that do not match the accounts in the file, and a
      payment method in use or a waiting sign-up at an account no longer named.
    - `GET` and `POST /billing/payment-method` behind the new billing permission,
      held by the tenant's administrator unless `billingPermissionGuards` says
      otherwise. `TenantPlanSection` shows the payment method to whoever holds it,
      through the new `useTenantPaymentMethod`.
    - Breaking: `PaymentProvider`, `PaymentWebhookDto` and
      `PendingRegistrationService.handlePaymentEvent` are removed, and
      `RegistrationModule.forRoot` no longer takes `paymentProvider` or
      `paymentEventLog`. `ActivationOrchestrator.activate` receives `{ tx }` and
      writes on it; `CheckoutOfferService.conclude` takes `tx`.
      `PendingRegistrationRepository.findByCheckoutSession` takes the gateway
      account, `delete` takes `tx`, and `findOpenCheckoutAccounts` is new. A
      duplicate callback is logged, no longer audited as
      `PAYMENT_DUPLICATE_IGNORED`. `startCheckout` requires
      `billingDetails`. `PaymentEventLog.tryClaim` becomes `claim(claim, tx)`.
    - A tenant's change records the setup it opened, and a confirmation is recorded
      only for the account, session and subscriber of an open setup. A gateway
      session is confirmed once, however many events report it: a partial unique
      index in `sql/constraints.postgres.sql` makes the second confirmation a
      duplicate rather than a second payment method. A confirmation that changed
      nothing gives the session back through `PaymentEventLog.releaseSession`, so
      the event that does belong to it is still handled.
    - Breaking: the `SubscriptionPaymentMethod` fragment is removed.
      `SubscriberPaymentMethod`, `SubscriberPaymentMethodSetup` and
      `PaymentEventLog` are in `14-payments.prisma`;
      run `sql/1.0-a-payment-method-is-a-gateway-reference.postgres.sql` before
      `db push`, and drop `subscription_payment_methods` once nothing writes there.
    - Fixed: a fresh database no longer stops at the settings migrations — the
      order-number migration leaves a database without `settings_changes` alone,
      and the table is created with its `seq`.

    See `docs/guides/upgrade-to-1.0.md`.

### Patch Changes

- Updated dependencies [79ec7c4]
    - @saasicat/core@1.0.0-rc.17
    - @saasicat/ui-vue@1.0.0-rc.17

## 1.0.0-rc.16

### Patch Changes

- Updated dependencies [6009a93]
    - @saasicat/core@1.0.0-rc.16
    - @saasicat/ui-vue@1.0.0-rc.16

## 1.0.0-rc.15

### Patch Changes

- Updated dependencies [b328b35]
    - @saasicat/core@1.0.0-rc.15
    - @saasicat/ui-vue@1.0.0-rc.15

## 1.0.0-rc.14

### Major Changes

- a87cc4e: A plan is sold only in a rhythm it carries a price for

    A plan without a yearly price was shown at ten monthly prices a year, accepted
    by the plan change, and recorded in the contract with a plan line of 0.00.

    - `PLAN_NOT_SOLD_IN_CYCLE` is a new plan-change blocker. The plan change and
      the onboarding choice refuse such a plan, and the contract freeze refuses it
      before the contract in force is closed. A plan that is not marketed is sold
      under a special contract and is not affected.
    - `DEFAULT_YEARLY_FACTOR` and `useSubscriptionDraft`'s `yearlyFactor` are
      removed; `DraftPricing.planPriced` says whether the plan carries a price for
      the cycle, and a bundle without one is neither charged nor sent.
    - `PlanGrid`, `PublicBundleGrid` and `OnboardingConfigurator` take
      `notSoldInCycle` in their `i18n`, and `TenantPlanSectionI18n` gains
      `wizardNotSoldInCycle`. Such a card says so and cannot be chosen.
    - The promo discount the configurator shows is the server's:
      `PromoPreviewValidResponse.price.discountNet`, taken off the plan and not off
      its bundles. Changing the plan or the cycle asks the preview again.
    - The catalogue importer skips a plan without `yearlyNet` with a warning instead
      of storing ten monthly prices as its yearly price.

### Patch Changes

- Updated dependencies [a87cc4e]
- Updated dependencies [cd89334]
- Updated dependencies [a87cc4e]
    - @saasicat/core@1.0.0-rc.14
    - @saasicat/ui-vue@1.0.0-rc.14

## 1.0.0-rc.13

### Patch Changes

- Updated dependencies [f582840]
    - @saasicat/core@1.0.0-rc.13
    - @saasicat/ui-vue@1.0.0-rc.13

## 1.0.0-rc.12

### Patch Changes

- Updated dependencies [d8721ab]
    - @saasicat/ui-vue@1.0.0-rc.12
    - @saasicat/core@1.0.0-rc.12

## 1.0.0-rc.11

### Patch Changes

- @saasicat/core@1.0.0-rc.11
- @saasicat/ui-vue@1.0.0-rc.11

## 1.0.0-rc.10

### Patch Changes

- Updated dependencies [7c7b06c]
- Updated dependencies [d4b294e]
- Updated dependencies [e95b629]
- Updated dependencies [5936288]
- Updated dependencies [c351b6b]
- Updated dependencies [ed7cee4]
- Updated dependencies [3a700a4]
    - @saasicat/core@1.0.0-rc.10
    - @saasicat/ui-vue@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [16a8542]
    - @saasicat/core@1.0.0-rc.9
    - @saasicat/ui-vue@1.0.0-rc.9

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
