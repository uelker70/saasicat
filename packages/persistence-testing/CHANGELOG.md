# @saasicat/persistence-testing

## 1.0.0-rc.26

### Patch Changes

- @saasicat/core@1.0.0-rc.26

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

- d34e3e5: A subscriber has a tax origin, and a contract records its tax treatment

    The first part of the tax adapter (ADR 0013): what an adapter decides a
    subscriber's tax from, and where its answers are kept. Nothing asks an
    adapter yet, so no amount changes; `@saasicat/tax-de` and the refusal of a
    case it cannot treat follow.

    - **The tax port** in `@saasicat/core`: `TaxAdapter` decides a
      `TaxTreatment` — its kind, rate and note, with the adapter's name and
      version — from the issuer, the period and the subscriber's
      `SubscriberTaxOrigin`, or answers that the case is not supported, and
      checks a VAT id (`VatIdCheckOutcome`). A check that cannot complete is no
      result. `taxOriginOf(subscriber, check)` counts a VAT id as validated only
      when the check that counts for it is of that very number and found it
      valid.
    - **Whether a subscriber is a business** is recorded, never derived from a
      tax identifier: `business` — `true`, `false`, or `null` for not stated —
      taken at creation and changed by `SubscriberService.changeBusinessStatus`.
      A contact change naming it is refused
      (`SUBSCRIBER_BUSINESS_STATUS_NOT_A_CONTACT`).
    - **Every check of a VAT id is kept as it was answered** and never
      rewritten (`SubscriberVatIdCheck`, `recordVatIdCheck`, `listVatIdChecks`):
      it is the evidence a reverse charge rests on. The one that counts is the
      latest completed check of the number the subscriber holds, completed since
      it holds it (`vatIdSince`), never an older one written later, and none once
      the number is corrected (`findCurrentVatIdCheck`, `keepsVatIdCheck`).
    - **Every change of the tax origin is recorded with who made it**
      (`SubscriberTaxOriginChange`, `listTaxOriginChanges`), whichever way it
      arrives — a contact change of the country, a correction of the VAT id, a
      change of the business status — in the transaction that makes it, dated
      while the write holds the subscriber's row lock and listed in the order
      the database numbered it, which the dates follow on one clock.
    - **A change of the contact details names who makes it**:
      `changeContact` and `changeContactOfTenant` take `changedBy`
      (`SUBSCRIBER_CHANGE_ACTOR_REQUIRED` without), and the tenant's
      `PATCH billing/details` passes the user behind the request.
    - **A VAT id is stored in one form**, upper case and without spaces, dots
      or hyphens, so the same number in another spelling moves nothing.
    - **A correction of the legal identity is dated by the write that makes
      it**, while it holds the row lock, numbered by the database (`seq` on
      `SubscriberCorrection`) and listed by that number. `SubscriberCorrectionData`
      no longer carries `correctedAt`; a correction that moves the VAT id and
      the change it records share one date.
    - **A contract records its tax treatment** (`taxTreatment`), null where no
      adapter was asked.
    - **`saasicat schema check` reports a fragment taken halfway** — one model
      of it adopted, another left out that the bundle cannot do without — as
      drift, rather than as a fragment not adopted.
    - The Prisma fragments `13-subscriber.prisma` and
      `08-subscription-contract.prisma`, both shipped adapters, the persistence
      contract, and two migrations:
      `1.0-a-subscriber-has-a-tax-origin.postgres.sql`, which backfills nothing,
      and `1.0-a-correction-carries-its-order.postgres.sql`, which numbers the
      corrections already recorded in the order they were listed.

    What an application does: adopt the fragment changes — both new models are
    required wherever the shipped subscriber repositories are used — run both
    migrations once, before `db push`, and give the two new tables the row-level
    policy its subscriber tables carry. Code that calls `changeContact` or
    `changeContactOfTenant` passes who it acts for. A hand-written
    `SubscriberRepository` takes `changedBy` in `updateContact`, dates a
    correction itself and lists corrections by `seq`, and adds
    `changeBusinessStatus`, `recordVatIdCheck`, `findCurrentVatIdCheck`,
    `listVatIdChecks` and `listTaxOriginChanges`; a hand-written
    `SubscriptionContractRepository` writes and reads `taxTreatment`; and code
    that builds a `SubscriberRecord`, `SubscriptionContractRecord` or
    `CreateSubscriberData` by hand adds `business` or `taxTreatment`. The
    upgrade guide has the steps.

    `SC-PRIC-038`, `SC-PRIC-040` and `SC-PRIC-043` stay decided, not yet
    delivered: this is where their answers are kept, and they are delivered once
    sign-up and the conclusion of a contract ask the adapter.

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

- 8fe675c: An add-on booking moves at its retirement's date

    A booking an add-on retirement told continues on the replacement at its date
    (`SC-BUN-049`): a run every quarter of an hour moves it, keeping its period,
    its terms and its rhythm, and writes the contract that charges it.

    - **The move and its contract are one** (`SC-BUN-050`). The contract's line
      for the booking names the replacement, marked with the retirement. Where the
      contract cannot be written — `ContractFreezeSourcePort.loadBookedBundles`
      handing no line for the replacement included — the booking goes back onto
      the version retired, and the next run makes both. Each move is audited as
      `BUNDLE_VERSION_RETIREMENT_MOVE`, and one that cannot be made, once per
      process, as `BUNDLE_VERSION_RETIREMENT_MOVE_FAILED`, by the actor
      `job:platform:add-on-retirement-moves`.
    - **Charges wait for the move.** The charge journal charges a booking's
      periods from its date at the replacement's price, from the line the move
      writes, however late it came, and a period before the date at the version
      retired. A booking that ended, or whose subscription did, before any move
      came is not moved: its periods from the date are charged at the version it
      ran on.
    - **The promise holds** (`SC-BUN-051`). The move binds the replacement whatever
      its sale by then, and the add-on cannot be deleted while bookings still move
      onto one of its versions: `BUNDLE_DELETE_WHILE_RETIREMENT_MOVES_PENDING`,
      with `count` and `bundleKey`.
    - **The operator sees why a notice waits** (`SC-BUN-052`, `SC-SUB-039`).
      Beside each retired version, plan and add-on alike, the ones not told yet
      are counted by what holds their notice back:
      `RetirementProgress.notToldReasons`, worded by the catalogue keys
      `common.retirementProgress.notToldBecause.*`. A booking that ended past its
      date before anything moved it counts as ended rather than overdue
      (`SC-BUN-053` supersedes `SC-BUN-047`).
    - **Ports.** `SubscriptionBundleRepository.moveToVersion(id, from, to)` is
      optional and in both shipped adapters: it writes `to` only while the booking
      is on `from`, and answers `null` otherwise. A start with confirmed terms is
      refused without it, and the persistence contract gains the gap
      `bookingsMoved`. With `versionNotices.includeCron: false`, call
      `BundleRetirementMoveService.moveDue(new Date())` from your scheduler.
    - **A booking's end** is read as `canceledEffectiveAt ?? canceledAt` by the
      charge journal too, as by every other reader: a booking on a row from before
      the two dates separated is no longer charged past its `canceledAt`.

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

- 3496864: The operator corrects a subscriber's tax identity

    The operator corrects a subscriber's legal name, VAT identification number and
    tax number, and whether it acts as a business, beside the tenant — each with a
    written reason and behind the second factor (`SC-SUB-041`). A VAT number a
    correction gives, or the number held when the operator asks, is checked with
    the tax adapter's service and the check kept whatever it found
    (`SC-PRIC-071`), and the operator reads the subscriber's history: who changed
    what, when and why, and every check (`SC-ADM-032`). A takeover by another legal
    entity stays refused.

    - **The change log of the tax origin keeps a `reason`.**
      `1.0-a-subscriber-has-a-tax-origin.postgres.sql`, new in this release, creates
      `subscriber_tax_origin_changes` with it, and `SubscriberTaxOriginChange` in
      `prisma-fragments/13-subscriber.prisma` declares it — no further file to run.
    - **A change of the business status needs a reason.**
      `SubscriberService.changeBusinessStatus` takes `reason` beside `business`
      and `changedBy`, and refuses a blank one with the new code
      `422 SUBSCRIBER_BUSINESS_STATUS_REASON_REQUIRED`, and every change of the tax
      origin keeps its reason — the correction's, the business status's, `null`
      for a change of the country with the contact details. Your own
      `SubscriberRepository` writes and reads `reason`.
    - **A corrected VAT number is checked.**
      `SubscriberService.checkCorrectedVatId(correction)` checks the number a
      correction gave, where a tax adapter decides, and keeps the check — valid,
      invalid or not completed alike; the correction stands whatever it found, and
      the next contract stays held back until a valid check counts. It reaches an
      outside service, so it runs after the correction and outside any
      transaction; `correctIdentity` itself still only writes.
    - **`SubscriberService.checkVatIdOf`** checks the number a subscriber holds
      again, named by `tenantId` or `subscriberId`, and keeps the check — refused
      with `409 TAX_VAT_ID_CHECK_NOT_AVAILABLE` without an adapter and with
      `422 SUBSCRIBER_VAT_ID_MISSING` without a number.
    - **The operator's routes**, announced as `subscribers.correct` wherever the
      subscriber view is served, inside the RLS bypass and recorded in the audit
      log: `POST admin/tenants/:slug/subscriber/identity` and
      `…/business-status` behind the second factor, `…/vat-id-check` without it,
      and `GET …/history`, the latest first.
    - **`canonicalVatId`** in `@saasicat/core` gives a VAT number in the one form
      the platform stores, compares and checks it in — `atu 123.456-78` is
      `ATU12345678`. The platform settles every number with it, and a form asking
      whether a number changed compares with it too.
    - **`@saasicat/ui-vue`.** `TenantDetailPage` offers both corrections in a
      dialog that asks for the reason and then for the second factor, the check
      where an adapter decides and a number is held, and the subscriber's history.
      `useSubscriberCorrections` carries the sequences for your own pages.
      `AdminFormDialog` keeps a form open, without an error and without its
      `successMessage`, when its `submit` resolves `null` — a `submit` of yours
      that resolves `null` after a successful write resolves something else
      now, or the dialog stays open after it. A `successMessage` function given
      to `useAsyncAction` is passed what the call resolved, and an empty text
      announces nothing. `useAsyncData` takes a `subject` — a tenant's slug —
      whose change drops what was loaded at once: moving from one tenant to the
      next, the tenant page no longer shows the first one's subscriber, history or
      account while the next one's are read.

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
- Updated dependencies [808cd9f]
- Updated dependencies [3496864]
    - @saasicat/core@1.0.0-rc.25

## 1.0.0-rc.24

### Major Changes

- ce7241e: Keep the plan version a subscriber bought when a scheduled change only moves
  the rhythm

    A change of rhythm is scheduled for the period end, and when it came due both
    adapters bound the subscription to the newest version of the plan — a new
    price and new features the subscriber had not accepted, held by the contract
    frozen after it. Moving a subscriber to a newer version is theirs to decide
    (`SC-SUB-024`).

    - `ImmediatePlanChangeInput` carries `keepsBoundVersion`, which the platform
      sets: `true` where a scheduled change comes due, `false` for a change of
      plan and for onboarding, which sell at the version in effect. A store keeps
      the version the subscription is bound to where the flag is set and the plan
      does not change; another plan is bound to its version in effect either way.
      A store of your own reads the flag; code that builds the input passes it.
    - The plan-change preview quotes a change of rhythm at the version kept, and
      shows the price of the version bound as the current one, where the plan
      repository reads versions (`findVersionById`); a subscriber on an older
      version was quoted the catalogue's newest price, which the write no longer
      bills. It prices that version by the rules the contract freeze bills it by,
      and refuses a rhythm the version kept is not sold in with
      `PLAN_NOT_SOLD_IN_CYCLE` — rather than a free year.
    - The Prisma write claims the row only while it is bound to the version it
      read, so a switch landing between its read and its write is not written
      over; the caller is told the subscription changed. The Drizzle
      write already decides under a row lock.
    - The persistence contract checks all three: a change of rhythm keeps the
      version, a sale binds the version in effect, and another plan is bound to
      its own whatever the flag says.

- 49e93ab: Name the tenant when a contract is superseded or ended, so a wrong id cannot
  reach another tenant's contract

    `SubscriptionContractRepository.supersede` and `terminate` identified the
    contract by id alone. On an installation with a row policy on
    `subscription_contracts`, the policy was then the only thing keeping a wrong
    id from ending another tenant's contract.

    - `SupersedeSubscriptionContractData` and `TerminateSubscriptionContractData`
      carry `tenantId`, and both shipped adapters match it in the statement.
    - `terminate` of a contract that no contract of that tenant carries is refused
      with `SUBSCRIPTION_CONTRACT_NOT_FOUND`, where Prisma failed with its own
      error and Drizzle with a plain one.
    - `SubscriptionContractService.terminate` now requires `tenantId` in its
      input: the tenant the caller acts for. A contract of another tenant is
      answered as one that does not exist, also where it is closed already, so a
      call that leaves `tenantId` out is answered 404. `writeSuccessor` refuses a
      successor for one tenant in place of another tenant's contract.
    - The persistence contract supersedes and terminates under another tenant's
      id and expects nothing to change. A store of your own matches the tenant,
      and code that calls `supersede` or `terminate` on the port passes it.

- 109fcce: A deleted promo code keeps its name, and a taken name answers 400

    Creating a code under the name of a deleted one passed the platform's
    duplicate check, because `findByCode` hid deleted codes, and then ran into the
    unique index: a 500 where the platform meant to say the code exists. The name
    stays taken now, since contracts, offers and redemptions name a code by its
    text; `findByCode` returns deleted codes too, and every caller that redeems or
    previews already checks `deletedAt`. Two creates of one name that race past the
    check are answered the same way: the adapters insert with
    `ON CONFLICT DO NOTHING` and refuse with `promoCodeTaken`, and the service
    turns that into `400 PROMO_CODE_ALREADY_EXISTS`.

    The message for `PROMO_CODE_ALREADY_EXISTS` now says that a deleted code may
    carry the name, since the admin list does not show deleted codes, and the
    refusal from the duplicate check carries `params.deleted` so an interface can
    tell the two cases apart.

    The nightly expiry no longer writes to deleted codes.

    - `promoCodeTaken` is new in `@saasicat/core`.
    - A promo code repository of your own returns deleted codes from `findByCode`,
      refuses a taken name with `promoCodeTaken`, and leaves deleted codes out of
      `expireDueCodes`; the persistence contract checks all three.

- f78c15d: Keep a promo code's amounts as entered, and save every field of a change

    Both adapters rounded a promo code's discount and minimum amount with
    `toFixed(2)` before storing them, which rounds the binary double rather than
    the decimal the operator typed: 1.005 was stored as 1.00, 10.005 as 10.01. The
    decimal that was entered now goes to the column, and the admin API refuses an
    amount with more than two decimal places, or larger than its column holds
    (999,999.99 for a discount, 99,999,999.99 for a minimum), with a 400 instead of
    rounding it or failing in the database. Exponent notation such as `1e-7` is
    counted too.

    `@saasicat/adapter-drizzle` also dropped most of a change to a code: an edit of
    the discount, its type, the minimum, the plans and cycle it applies to, the
    duration, the start date and the accounting fields reported success and kept
    the old values. It now writes every field the change names.

    - `toDecimalString` is new in `@saasicat/core`: the decimal a number was
      written as, for a `numeric` column.
    - The persistence contract creates a code with amounts that binary rounding
      would send the wrong way and changes every field of one. A promo code
      repository of your own that runs the contract has to pass both.

- b17333a: Publish a draft once, and tell the second publisher so by code

    Two operators, or one double click, could publish the same plan draft with
    `@saasicat/adapter-prisma`: both requests passed the check, and the second
    overwrote when, by whom and from when the version was published, and closed its
    predecessor a second time. The same held for add-on drafts outside validity
    mode, where the two writes did not even share a transaction. Discarding a plan
    draft that was published in between reported success. Both adapters now claim
    the draft while it still is one, close the predecessor in the same
    transaction, and refuse otherwise.

    The refusal reaches the operator as the platform's own check would answer:
    `422 PLAN_VERSION_ALREADY_PUBLISHED` or `BUNDLE_VERSION_ALREADY_PUBLISHED`, and
    `404` for a version that is gone — not a 500. The English and German texts of
    the two `…_ALREADY_PUBLISHED` codes no longer say "cannot be discarded" to
    somebody who was publishing: they say the version is neither published again
    nor discarded.

    - `PersistenceRefusal` is new in `@saasicat/core`: an error an adapter throws
      when a row is no longer what its caller read, carrying the platform's code.
      `catalogVersionGone` and `catalogVersionAlreadyPublished` build the two
      catalogue cases, with the parameters each code's message interpolates.
    - `FakePlanRepository` and `FakeBundleRepository` from `@saasicat/nest/testing`
      refuse the same way: a version published once is not published again, and
      the refusal carries the code. A test of yours that published one draft twice
      through them now sees the refusal.
    - The persistence contract publishes a plan draft twice, one after the other
      and at the same moment, discards one published meanwhile, and publishes a
      version that is not there. A plan repository of your own throws
      `PersistenceRefusal` for these, or its harness declares the new gaps
      `planDraftPublish` and `planDraftDiscard`.

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

- 21ba667: Answer a request that loses a race the way the check answers it, not with a 500

    The platform checks before it writes, and where two requests pass that check
    together — two operators creating one key, a double click asking for a second
    draft, a cancellation arriving after another — the store decides. Both
    adapters then threw a plain `Error` or let the database's unique violation
    through, and the loser read a 500 that looked like a crash in the log. It now
    reads the status, code and parameters the check gives a request arriving a
    moment later.

    - `@saasicat/core` builds the refusals: `planKeyTaken`, `bundleKeyTaken`,
      `marketingProjectionTaken`, `catalogDraftExists`, `subscriptionBundleGone`,
      `subscriptionBundleAlreadyCancelled`, `subscriptionGone`,
      `noActivePlanVersion` and `planNotInCatalog`, each worded by the shipped
      English catalogue.
    - Both adapters create catalogue keys, drafts and marketing projections with
      `ON CONFLICT DO NOTHING`, so a refused create leaves a caller's transaction
      usable. `PrismaModelDelegateLike` declares `createManyAndReturn`, which
      Prisma has had since 5.14. A conflict on a unique index of your own is not
      reported as a key taken: Drizzle aims the conflict at the key, and Prisma,
      which cannot, looks the key up and otherwise fails with an error of its own.
    - The Prisma and Drizzle subscription writes refuse a missing subscription and
      a plan with no version in effect by code; a booking cancellation tells a
      booking that is gone from one cancelled first. The three configuration
      checks the Prisma write makes when it is constructed stay plain errors.
    - Onboarding answers a refusal of the store the same way on both of its
      paths; the atomic one reported it as `ONBOARDING_CREATE_FAILED` before.
    - `FakePlanRepository`, `FakeBundleRepository`,
      `FakeMarketingProjectionRepository` and `FakeSubscriptionBundleRepository`
      from `@saasicat/nest/testing` refuse the same way, and the plan fake refuses
      a second draft as the stores do.
    - The persistence contract checks these refusals by code: a taken plan or
      bundle key, a second plan or bundle draft — also two asked for at once — a
      booking that is not there or already cancelled, and a plan change for a
      tenant without a subscription or to a plan with no version in effect. A
      store of your own throws `PersistenceRefusal` for these, built with the
      functions above.

- c69e2af: Reverse any redemption not reversed yet, and give its slot back once

    `PromoCodesService.reverse` reversed a redemption only while its status read
    `ACTIVE`, so for one whose term had ended the answer depended on whether the
    nightly sweep had marked it `EXPIRED` yet: before the sweep its slot came back,
    after it not. And two reversals at the same moment both gave the slot back.

    - `reverse` rolls back any redemption not reversed yet, an expired one
      included, and gives its slot to the code again (`SC-PROMO-001`). It is what
      a withdrawal or a rollback calls; an ordinary end never calls it.
    - `PromoCodeRedemptionRepository.setReversed` claims: it reverses the
      redemption only while it is not reversed, in one conditional statement, and
      answers `null` where it already was. Only the reversal that wins gives the
      slot back. Both shipped adapters do; a repository of your own does the same,
      and the persistence contract runs two reversals at once against it.

- c3b87c8: Bind a scheduled change to another plan at the version it was quoted at

    A change scheduled for the end of the term bound whichever version of the
    target plan was in effect the day it came due. A version published in between
    reached the customer through a change they had confirmed at another price
    (`SC-CHG-022`).

    - The plan-change preview prices another plan at its version live now, read as
      a row, and names it as `target.planVersionId`; a change that keeps the plan
      names the version it keeps.
    - `schedulePlanChange` takes `pendingChangeVersionId` and stores it; the
      subscriptions table gains the column, with a foreign key to `plan_versions`.
      `1.0-a-scheduled-change-keeps-its-quoted-version.postgres.sql` adds it to an
      existing installation and gives a change already scheduled to another plan
      the version live and in effect when it runs. It finds that plan by its key
      in `plan_versions."planId"`, or — under the Prisma adapter's
      `normalized-plan-id` binding — through the row of `plans` carrying the key.
    - `ImmediatePlanChangeInput` takes `quotedPlanVersionId`: where set, and no
      version is kept by `keepsBoundVersion`, the write binds it rather than the
      version in effect — while it can still be booked for that plan on the day
      the change lands: a version of another plan, one that has ended
      (`SC-PLAN-016`), or one published ahead of a date that has not come yet is
      not bound, and the version in effect is. Materialisation passes the recorded
      version; a sale and onboarding pass `null`.
    - `DuePendingPlanChange` requires `pendingChangeVersionId`. A
      `PendingPlanQueryPort` of your own returns it, and a
      `TenantSubscriptionWritePort` of your own stores, clears and binds it; the
      persistence contract checks the binding against PostgreSQL.

- edb496b: Tell a subscriber once that a newer version of their plan is offered to them

    A subscription keeps its version, and a newer one is an offer beside the plan
    (`SC-SUB-020`). With `tenantBilling.versionNotices: { port }` the tenant's
    administrators now hear of it once, in the application's words
    (`SC-SUB-022`): when the offer appears — not when the version is published —
    so a version whose window opens later is told when it opens, and a
    subscription with a change still to land is told once it has landed. Each
    newer version is told once per subscription; there is no reminder.

    - `SubscriptionNoticePort` in `@saasicat/core` is the application's: it finds
      the tenant's administrators, words and sends the message, and answers to
      whom and through which channel. A throw is tried again by the next run; an
      answer with no recipients is recorded as told to nobody.
    - The platform keeps a record of every notice (`SC-SUB-023`) in the new
      `subscription_notices` table: the subscription, what it said, when it went
      out, to whom and how, one per subscription and subject. Adopt
      `prisma-fragments/17-subscription-notice.prisma` and run
      `sql/1.0-a-subscriber-is-told-once.postgres.sql`. Both bundles provide the
      record as `tenantBilling.subscriptionNotices`, which
      `notAdopted: ['SubscriptionNotice']` leaves out.
    - `VersionNoticeService.sendDue` sends what is due, across tenants inside the
      RLS bypass. `VersionNoticeCron` runs it every quarter of an hour where
      `ScheduleModule` is registered, and pauses under a maintenance lock;
      `includeCron: false` leaves it to a scheduler of the application's own.
    - `SubscriptionUsagePort.listBoundToEarlierVersions` is new and optional; both
      shipped adapters have it. Version notices over a port without it, or over a
      plan repository without `findVersionById`, refuse to start, and so does a
      start with no record (`version-notices.requires-notice-record`).
    - The persistence contract holds a notice record to one claim at a time. A
      harness gains the `subscriptionNotices` member, or declares
      `gaps: ['subscriptionNotices']`.

- 8a3ee1d: Sell a plan version by its dates, everywhere

    Which version of a plan is on sale is now decided once, by its dates —
    published, begun, not past its last day, not ended — and the tenant's plan
    list, the plan-change preview, the public catalogue, checkout, the add-on
    preview, every booking, the offer to existing subscribers and the entitlement
    fallback all ask that question (`SC-PLAN-027`). Switches used to decide whether
    the dates were kept at all; off by default, a version published with a later
    start was sold at once, and with them on, the plan list and the preview showed
    the newest version while a booking bound its predecessor. The dates now always
    apply.

    - `@saasicat/adapter-prisma`: `schema.planVersionFields` (with `catalog` and
      `entitlement`), `tenantSubscription.activeVersionSelection`,
      `tenantSubscription.withEndsAt` and the types
      `PrismaPlanVersionFieldOptions` and `PrismaPlanVersionFieldCapabilities` are
      removed. Every plan-version model carries `validFrom`, `validUntil` and
      `endsAt`; `findActivePlanVersion`, `terminate` and `findActive` are always
      there.
    - `@saasicat/adapter-drizzle`: the `plan: { validityWindows }` option of
      `drizzlePersistence()`, the options argument of `DrizzlePlanRepository` and
      `DrizzlePlanRepositoryOptions` are removed; the entitlement read gains
      `findActive`.
    - `@saasicat/core`: `PlanVersionRepository.findLatestLive` is removed and
      `findActive` is required; `PlanCatalogReadSink.loadSnapshot(asOf)` takes the
      moment and answers `versionsOnSale` instead of `livePlanVersions`;
      `toPlanVersionRow` takes no field flags and `PlanVersionMappingFields` is
      removed; `PlanVersionRow.endsAt` is always present.
    - `@saasicat/nest`: the plan editor and checkout refuse to start over a plan
      repository without `findActivePlanVersion`. `FakePlanVersionRepository`
      drops `findLatestLive`.
    - `@saasicat/persistence-testing`: a new part, `planCatalogRead`, holds the
      catalogue read to the version a booking binds; a harness wires
      `planCatalogReadSink` or names the part in `gaps`.

    Nothing to migrate: a version without dates counts as on sale since it was
    published, and the next one published with a start date closes it on the day
    before. A superseded version is on sale only within a last day it carries, so
    ending the successor of an undated one leaves nothing on sale rather than
    bringing back the old price.

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

- 42b21ab: Give negotiated limits one shape, and report a stored value in any other

    The subscription fragment documented `customLimits` as
    `{ maxUsers?, maxVehicles?, maxStorageGb?, features? }`, while the
    platform reads `{ quotas?: { <quotaKey>: number }, features?: string[] }`
    — and `@saasicat/core` itself declared both. A consumer that followed the
    fragment stored limits the entitlement read nothing from, without an error.

    - `CustomLimits` in `@saasicat/core` is the one type, used by `Subscription`
      and `SubscriptionRecord`. `CustomLimitsShape` is gone from
      `@saasicat/nest/entitlement`; use `CustomLimits`. `Subscription.customLimits`
      was declared flat, which nothing ever read; it now has the shape that is
      applied.
    - Both adapters read the stored JSON through `readCustomLimits`. A key the
      platform does not read, and a quota value nothing can count, are left out
      and named in a warning, once per subscription: the tenant stays on its
      plan's limits rather than being blocked or handed an unlimited quota, and
      the operator sees what was not applied.
    - The fragment, `examples/notesapp` and the normative admin API schema document
      the shape that is read: `customLimits` in the application's subscription
      `PATCH` route and in `SubscriptionDetail` was a flat map of integers, and now
      refers to a `CustomLimits` schema. A repository test holds that schema to
      `CUSTOM_LIMITS_KEYS`, the keys the platform reads.
    - The persistence contract reads negotiated limits back, in the platform's
      shape and in one it does not read. Its `createSubscription` seed writer
      takes `customLimits`; a harness of your own writes it to the column.

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

- 2cafe45: Take a version offer: switch a subscription to a newer version of its plan

    `POST billing/version-offer/accept` takes the offer `GET billing/version-offer`
    shows (`SC-SUB-021`). The body names the version the page showed; the offer is
    read again, and the switch goes ahead only while that version is still the one
    offered — otherwise `409 VERSION_OFFER_CHANGED` with the offer as it now
    stands. The route asks for the tenant's administrator and writes an audit
    entry (`SWITCH_PLAN_VERSION`, or `SCHEDULE_PLAN_VERSION_SWITCH`).

    - **An improvement and more for more** switch at once, on the plan and in the
      rhythm the subscription has. The term and the period stay. What it costs is
      what the account charges for any contract taking effect inside a paid
      period: the difference for the rest of the period where the price in the
      subscriber's own rhythm is higher, nothing where it is not — so an
      improvement is free, and so is a version dearer only in the other rhythm.
      Where contracts are frozen, the successor contract is written at once.
    - **One that takes something away** is scheduled for the end of the term,
      bound to the version offered, and written when it comes due. It is refused
      with `400 PLAN_CHANGE_BLOCKED` (`QUOTA_OVER_TARGET`) while today's usage
      exceeds a quota it lowers, with `409 VERSION_SWITCH_AFTER_CANCELLATION`
      where a cancellation lands before it would take effect, and with
      `409 VERSION_ENDS_BEFORE_SWITCH` where the version stops being sold — its
      window closes, or an operator ended it — before then. Each side of the offer
      now carries `validUntil` and `endsAt` for that.
    - A change that names a version of the plan it keeps, and finds that version
      no longer taking bookings when it lands, keeps the version bound rather than
      binding one nobody was offered — in both adapters, held by the contract.
    - `PendingPlanMaterializationService` binds the version a due change names,
      also where the plan stays; a change that names none keeps the version bound,
      as before.
    - `useTenantBilling().acceptVersionOffer(planVersionId)` in `@saasicat/ui-vue`
      takes it and reloads; the result type is `VersionSwitchResult` from
      `@saasicat/core`.
    - The switch is written only while the subscription is as it was read. Three
      optional fields on `TenantSubscriptionWritePort` carry that:
      `expectedPlanVersionId` (on both writes) claims the row only while it is
      still bound to that version, `expectedPendingPlan` (on `schedulePlanChange`)
      only while that change — `null` for none — is still what is scheduled, and
      `quotedVersionOnly` (on `changePlanImmediate`) binds `quotedPlanVersionId`
      or nothing, instead of the version in effect. A write
      that finds any of them moved answers `claimed: false`, and the route answers
      `VERSION_OFFER_CHANGED` with the offer as it stands, or
      `SUBSCRIPTION_CHANGED`. A plan change a second administrator makes at the
      same moment is therefore refused rather than written back over.
    - Both adapters implement the three, and the persistence contract holds them
      to it: a newer version of the same plan a change was quoted at is bound; a
      binding that moved, a required version that stopped taking bookings, and a
      schedule or binding that moved under a scheduled change each claim nothing.

    **If you implement `TenantSubscriptionWritePort` yourself**, honour the three
    fields — the contract suite in `@saasicat/persistence-testing` now asks for
    them. A write that ignores them lets a version switch overwrite a plan change
    made at the same moment.

    **If your `PendingPlanQueryPort` does not return `pendingChangeVersionId`**, a
    switch taken at the end of the term comes due as a change that keeps the
    version bound — return the column, as a scheduled change to another plan
    already needs.

- e99d6c0: Find a person's audit entries by their e-mail, through both adapters

    `<app> audit tail --actor <email>` passed the address on as an actor tag, and
    every tag the platform writes reads `<source>:<email>:<context>`, so the filter
    never matched anything. And the two shipped adapters read a pattern
    differently: Prisma took a star at either end, Drizzle only at the end and with
    case (`SC-AUD-018`).

    - `AuditQuery.actorTag` states its grammar: a tag, matched exactly, or a
      pattern with a star at its start, its end or both, matched without regard to
      case, everything between the stars literal. The Drizzle adapter reads it as
      the Prisma adapter already did.
    - `audit tail --actor` turns an address into `*:<email>:*`, so it lists that
      person's entries from the web and the command line alike. A value with a
      colon or a star is passed on as the tag or pattern it already is.
    - **If you implement `AuditQueryPort` yourself**, it now receives that
      pattern: read the grammar on `AuditQuery.actorTag`, or `--actor` answers
      with an empty list — no error, since nothing matched. An adapter that
      searched the address as a substring, or knew only a trailing star, finds
      nothing for `*:<email>:*`. The shipped adapters read it, and the persistence
      contract now holds any adapter to it.
    - The Prisma adapter matches `%` and `_` in a searched value literally. Prisma
      hands `contains`, `startsWith` and `endsWith` to `LIKE` as they are, so an
      underscore stood for any character: a search for the promo code `BLACK_25`
      also found `BLACKX25`, and the tenant, user and audit searches likewise. The
      Drizzle adapter already escaped them.
    - The persistence contract searches a promo code with an underscore and an
      audit log by a pattern, for any adapter.
    - The flow no longer promises a cap of 500 on `--limit`: the adapter sets it,
      and the shipped ones cap at 200.

### Patch Changes

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
- Updated dependencies [c25f062]
- Updated dependencies [5a6b34a]
- Updated dependencies [536982d]
    - @saasicat/core@1.0.0-rc.24

## 1.0.0-rc.23

### Minor Changes

- a748f74: An operator can carry a changed feature vocabulary into running contracts

    A contract keeps the feature keys it was frozen with, so a key renamed, added
    or dropped in a plan version afterwards does not reach it. `<app> doctor` now
    names each contract in force whose frozen features hold a key neither the code
    nor the catalogue knows, or lack one the versions it covers grant today and no
    `replaces` declaration carries it to (`SC-ENTL-022`). It changes nothing.

    `<app> contracts refresh --all` (or `--contract <id>`) shows, per contract,
    what carrying the vocabulary over would change — features, quotas, price, tax
    rate, currency — and writes only with `--apply` (`SC-ENTL-023`). By default it
    replaces the frozen features alone and copies the lines, prices, terms and the
    parties agreed. `--full` re-freezes the contract the way a plan change does,
    which also leaves out an add-on whose cancellation is declared, and refuses
    every contract whose price, tax rate or currency would change. Either way the
    contract in force is kept, superseded, beside its successor, and the audit log
    records it. Guide: "Change the feature vocabulary".

    - `ContractRefreshService` (tenant billing, where `contractFreeze` is on) and,
      in `@saasicat/cli`, `ContractRefreshCliFlow`, `ContractsCommands`,
      `ContractsRefreshCommand` and `ContractFeaturesDoctorCheck`, which joins
      `PLATFORM_DOCTOR_CHECK_PROVIDERS` and passes where contracts are not frozen.
    - `SubscriptionContractRepository.supersede` ends a contract only while it is
      still as the caller read it — its status and its `effectiveUntil` — in one
      conditional statement, on the caller's transaction where it passes one. A
      repository of your own adds it; both shipped adapters have it, and the
      persistence contract holds it to two concurrent writers. `create` writes
      `partiesMigrated`.
    - A plan change now writes its successor and the end of the contract it
      replaces on one transaction, and refuses with `SUBSCRIPTION_CONTRACT_CHANGED`
      rather than leave two contracts in force: where the contract moved twice in
      between, or where, with none in force at its moment, a contract of the tenant
      begins after it. `SaaSiCatModule.forRoot` passes its transaction runner;
      `contractFreeze.transactionRunner` and the `SubscriptionContractModule`
      option of the same name take one where the modules are wired by hand —
      without one the two writes are separate, and that guarantee does not hold.
    - `EntitlementService.computeContractLimits` no longer reads the contract in
      force: it answers what a contract frozen now records.

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

## 1.0.0-rc.22

### Major Changes

- 82c5ab6: A bundle booking's rhythm is `MONTHLY` or `YEARLY`

    The platform writes a booking's `billingCycle` only as `MONTHLY` or `YEARLY`,
    and prices a booking by asking whether it is `YEARLY` — yet the record typed it
    as any string, so an implementation could hand back `'yearly'` and have the
    booking priced monthly without a word.

    - Breaking: `SubscriptionBundleRecord.billingCycle` and
      `CreateSubscriptionBundleData.billingCycle` are `BillingCycle | null`.
      `resolveBundlePriceNet`, `SubscriptionBundlesService.listForSubscription` and
      `SubscriptionBundlePreviewContext.billingCycle` take a `BillingCycle`.
    - Both shipped adapters read a booking through `toSubscriptionBundleRecord`,
      new in `@saasicat/core`, which refuses a stored rhythm other than the two,
      naming the row. A `SubscriptionBundleRepository` of your own can map its rows
      with it. Every read of a booking is checked, the entitlement service's
      included, so run the query in the upgrade guide before deploying: a row it
      lists stops that tenant's feature and quota checks until it is corrected.
    - Breaking: the persistence contract checks that refusal. A harness gives it
      the `setBookingCycle` seed writer, or names `foreignBookingCycleSeed` in
      `gaps`.

### Minor Changes

- 37899b2: A subscriber's account records the charges its contracts give rise to

    A journal of what each subscriber owes (`SubscriberLedgerEntry`, optional):
    one charge per contract line and period — the plan, each add-on booking, a
    discount — derived from the contract in force, the billing windows and the
    bookings, net, with its currency and period, and written once however often
    and however concurrently it is derived (`SC-PRIC-053`). Every period is
    charged at the price in force when it starts, a skipped one too
    (`SC-PRIC-054`); nothing in a trial, without a contract, before a period
    starts or from a cancellation's effective date (`SC-PRIC-055`). A charge
    carries no tax; the invoice decides it (`SC-PRIC-056`). A discount is charged
    for the periods it was concluded for (`SC-PRIC-057`). A charge is rounded
    once and never edited (`SC-PRIC-018`, `SC-PRIC-020`). An account with no
    charge yet begins with the window its subscription is in, and nothing before
    it is guessed; an add-on is charged from its booking, but not from before the
    account begins (`SC-PRIC-058`).

    - `tenantBilling.chargeJournal: { ledgerRepository }` enables it beside
      `contractFreeze`, and `SubscriberChargeService.recordDueCharges(tenantId)`
      is what an application calls at activation and from its renewal job, before
      it moves a window and after. The platform calls it after onboarding and
      after an add-on booking, and where writing the contract after a booking
      failed, the call writes it again.
    - Onboarding writes the contract after the add-ons it books, so the contract
      names them.
    - `SubscriberLedgerRepository` in `@saasicat/core`, with both shipped adapters
      (`persistence.entitlement.subscriberLedgerRepository`), the Prisma fragment
      `15-subscriber-ledger.prisma` and the migration
      `1.0-a-subscriber-account-records-its-charges.postgres.sql`.
    - The persistence contract holds an adapter to it (`subscriberLedgerRepository`,
      gap `subscriberLedger`).
    - `@saasicat/spec` exports `subscriberLedgerSchema` in place of
      `tenantLedgerSchema`, which nothing read.

### Patch Changes

- Updated dependencies [82c5ab6]
- Updated dependencies [3663719]
- Updated dependencies [37899b2]
- Updated dependencies [123ea4d]
    - @saasicat/core@1.0.0-rc.22

## 1.0.0-rc.21

### Major Changes

- 4264bfd: Hold a promo code for a checkout until the payment is confirmed

    A sign-up concluded its checkout offer when the gateway confirmed the payment
    method, and redeemed the offer's promo code there. When the code's last
    redemption went to somebody else in between, the redemption refused, the
    conclusion was undone, and the customer had entered a payment method for
    nothing.

    - `startCheckout` takes `checkoutOfferId`, the offer the sign-up concludes.
      The offer's promo code is held from that step, before the gateway's form
      opens, until a confirmation of that form can no longer arrive — at Stripe
      the form's 24 hours plus the three days Stripe retries a webhook — so an
      abandoned form gives its slot back once nobody can pay on it. A code that
      cannot be held refuses the step with `PROMO_CODE_NOT_REDEEMABLE` and its
      `reason`, and no form is opened. A start that fails gives back at once the
      slot it took; a slot a form opened before holds stays with that form, and
      starting step 4 again never shortens it.
      `CheckoutOfferService.holdPromoCode` takes a hold directly.
    - Breaking: `PaymentMethodSetupSession` carries `confirmableUntil`, the last
      moment a confirmation of the session can arrive, or `null` for a gateway
      that states none, which holds the slot for the checkout's lifetime.
      `StripePaymentGateway` reports the session's `expires_at` plus Stripe's
      three days of webhook retries; a gateway adapter of your own has to state
      it.
    - The conclusion redeems the code on the held slot, as the application's
      `redeemInTransaction` in `within` runs today — also when the code was paused
      or ran past its validity since the checkout started. A slot the conclusion
      does not redeem is given back before it commits, and a conclusion that fails
      keeps the slot for its retry.
    - A held slot counts against `maxRedemptions` beside the redemptions. A code
      whose remaining slots are held refuses new checkouts with `EXHAUSTED` and
      stays `ACTIVE`, and gets its slots back as checkouts conclude, change their
      code or their holds run out. The admin list shows the held slots beside the
      redemptions, the statistics carry `held`, and a code a checkout holds a slot
      of is not deleted.
    - Breaking: `PromoCodeRecord` carries `heldCount`; a `PromoCodeRepository` of
      your own reports 0 when it keeps no holds. Holds are the new
      `PromoCodeHoldRepository`, which both shipped adapters provide as
      `promo.holdRepository`, and which the persistence contract holds against
      PostgreSQL — declare `gaps: ['promoCodeHolds']` in a harness without it.
    - Run `sql/1.0-a-promo-slot-is-held-through-checkout.postgres.sql` before
      `db push`: it adds `promo_codes.heldCount` and the `promo_code_holds` table,
      and does nothing on a second run.

    Changing a promo code is held to the rules creating one is: a percentage
    between 0 and 100, an amount above 0 and below the lowest price it can apply to
    unless an invoice of zero is allowed. Redeeming refuses where the preview
    refuses, with `WOULD_PRODUCE_ZERO_INVOICE`, and records at most the price it is
    redeemed against. A change that only pauses a code is always accepted.

- d64bf82: Say whose payment method a gateway reference is

    A payment method is kept under the gateway's reference, and that reference is
    unique within the gateway account rather than per subscriber. One read could
    not say whose it was: `findByReference` was given the account and the reference
    alone, so on the gateway's callback — which arrives without a session, where an
    installation lifts the policy that keeps its tenants apart — it answered with
    whichever subscriber's row held the reference. That the case does not arise
    today is a property of the provider, not a promise of this platform's;
    `SC-SEC-014` is the promise it makes instead.

    - Breaking: `SubscriberPaymentMethodRepository.findByReference` takes the new
      `SubscriberPaymentMethodReference`, which carries `subscriberId`,
      `gatewayAccount` and `paymentMethodRef` together, and answers `null`
      wherever that subscriber holds nothing under the reference — another
      subscriber's payment method included.
      One argument rather than a subscriber added in front of the two strings,
      because `TransactionContext` is `unknown` and accepts a string: the
      positional form let an implementation written against the older shape
      compile untouched and read the account out of the subscriber's place. An
      object fails that implementation at the type level, which is where this
      break belongs.
    - `recordConfirmed` refuses a reference another subscriber holds, rather than
      answering `already-recorded` with that subscriber's payment method. The
      refusal is the new `ForeignPaymentMethodReferenceError` from
      `@saasicat/core`, with `isForeignPaymentMethodReferenceError` beside it; it
      carries the account and the reference and names no subscriber the caller is
      not acting for.
    - Two subscribers can reach one reference at the same time, because the lock is
      on the subscriber — so reading is not enough to decide it. An implementation
      **claims the reference with its first write**, conflict-free on that key, and
      refuses when the claim takes no row. That is now part of the port's contract:
      because the claim comes first, a refusal leaves the caller's transaction as it
      found it.
    - The two adapters differ in one stated way. `@saasicat/adapter-drizzle` names
      the reference's key as the conflict target, so a claim it skips is certainly
      that key. Prisma's `skipDuplicates` names no target, so a skipped claim is
      attributed to the reference: sound in the canonical schema, where no other
      unique key can contain the claimed row, and wrong only for a consumer that
      adds one to that table. It is not read back to confirm, because a read is
      bound by a policy on the table while the unique index is not — an
      installation that does not lift its policy for the callback would then be
      told the reference is free.
    - `@saasicat/adapter-prisma` now needs **Prisma ORM 5.14 or newer**, and says so
      as an optional `@prisma/client` peer range. The claim uses
      `createManyAndReturn`, which arrived in 5.14; the client reaches the adapter
      through a token and is typed structurally, so without the range an older one
      would typecheck, boot, and fail on the first confirmed payment method.
    - A gateway callback refused that way is logged at error level, naming the
      account, the reference and the subject the event was about. It still rolls the
      transaction back, so nothing durable would otherwise say why: by then the
      handler has marked a setup complete, or activated a whole sign-up.
    - Both shipped adapters put the subscriber into the statement rather than
      checking what came back, so a policy on the table and the query bound the
      read the same way. The persistence contract comes at the boundary from the
      wrong side — two subscribers, one reference — for the read and the write
      alike.

### Minor Changes

- 6a83734: Read the plans when an operation asks for them, not when the application starts

    On the database path the plan catalogue was read once, at start, and every
    service kept that reading. A plan the operator published afterwards was unknown
    until the next restart: a promo code for it was refused with `PLAN_MISMATCH`, a
    plan change to it with `PLAN_NOT_IN_CATALOG`, and a contract frozen after a
    price change named the new version while recording the old one's price,
    features and quotas. `SC-PLAN-026` is the promise that replaces it.

    - Breaking: `PLAN_CATALOG_TOKEN` is gone. `PLAN_CATALOG_SETTINGS_TOKEN` carries
      the settings of `config/saas.yaml`, which are fixed while the process runs.
      `PLAN_CATALOG_SOURCE_TOKEN` carries a `PlanCatalogSource`, whose `current()`
      reads the plans and features as they stand. Read it once per operation and
      hand the value on. The token was removed rather than narrowed, because Nest
      does not type an injection: a token that kept its name and lost its plans
      would have compiled and answered every `catalog.plans ?? []` with an empty
      list.
    - Every platform service that reads plans reads them per operation: promo code
      preview, creation and redemption, the plan change preview, the contract
      freeze, the entitlement computation (for `plannedOnly`), the static
      entitlements, the public plan list and the admin manifest. `enforceLimit`
      reads before it opens its transaction, so the lock it holds on the
      subscription row does not wait for a second connection.
    - Breaking: `AdminManifestConfig` has no `planCatalogSnapshot`. The service
      fills it on every request, with a hash over what it carries, so the ETag
      moves when a plan is published. `AdminManifestService.getManifest()` and
      `rebuild()` return a `Promise`, and the service needs a `PlanCatalogModule`
      in scope — `SaaSiCatModule.forRoot` provides one globally; an
      `AdminManifestModule` wired by hand imports one beside it.
    - Breaking: `ManifestAccessPort.getManifest()` and `rebuild()` return a
      `Promise`, and `ManifestCliFlow.dump()`, `hash()`, `validate()` and `diff()`
      are asynchronous. A `manifestAccessPort` that delegates to
      `AdminManifestService` needs no change: the flow awaits it.
    - Breaking: `PlanCatalogDoctorCheck` takes a `PlanCatalogSource` and reports
      a catalogue that cannot be read as an error.
    - Plans and features that share a `sortOrder` are ordered by their key. The
      catalogue is read for every operation now, and a tie the database breaks
      differently from one read to the next would reorder the plans between a
      preview and the change it describes. Where two of yours share a value, the
      order you see may change once.
    - Breaking: a contract records the plan version its subscription is bound to.
      The freeze priced the plan line from the version on sale, so a tenant on v1
      who booked an add-on after v2 was published got a contract at v2's price
      with v1's entitlements (`SC-SUB-012`). `ContractFreezeSourcePort` replaces
      `findLivePlanVersionId(planId)` with `findBoundPlanVersion(tenantId)`, and
      the freeze refuses a plan the subscription is not bound to before it closes
      the contract in force. That relies on the write binding `planVersionId` on a
      plan change: `TenantSubscriptionWritePort.bindsPlanVersion` says whether it
      does, and a freeze beside a write that says `false` stops the start.
    - Breaking: `@saasicat/adapter-prisma` binds the plan version on a plan change
      by default — `tenantSubscription.synchronizePlanVersion` defaults to `true`,
      as the Drizzle adapter has always behaved, and `false` opts out. A
      subscription's `planVersionId` then follows the plan it was changed to, so
      an upgraded tenant's entitlements come from the version they bought rather
      than the one they left. The default needs a schema that carries it: a
      `planVersionId` column on the subscription model, the plan-version model,
      and a live version for every plan a tenant can change to. The adapter checks
      the model when it is constructed, so a schema without one stops the start,
      and a plan change that cannot write the column says which option to set.
      `false` opts out, but then a contract freeze refuses to start beside it — an
      installation whose schema cannot bind the version cannot freeze contracts.
      The persistence contract holds each adapter's `bindsPlanVersion` to what
      both of its plan-changing writes do.
    - `EntitlementService.computeLimits` takes an optional catalogue. With it, the
      answer is computed from that reading and kept out of the cache both ways;
      the freeze passes its reading. A tenant's cached entitlements may otherwise
      be up to a minute old, which is the one lag `SC-PLAN-026` allows.
    - `listPriceNet(plan, cycle)` states the list-price rule `getPlanPriceNet`
      applies, for a plan already in hand. A price a version row does not carry —
      a nullable column in an installation's own schema — reads as no price rather
      than `NaN`.
    - The promo preview reads the catalogue only once the code itself has passed,
      so trying codes that do not exist costs no read of the plan tables.
    - `settingsSubtreeOf` accepts `PlanCatalogSettings` as well as a whole
      catalogue.
    - `givenPlanCatalogSource(catalog)` builds a source over a fixed catalogue, for
      a test that constructs a service by hand. `forRootWithCatalog` uses it.

    What it costs: one read of the three catalogue tables for each operation that
    needs plans. The start still reads once, so a sink that cannot read stops the
    boot rather than the first customer. The catalogue is now read inside tenant
    requests: a row-level security policy on `plans`, `plan_versions` or
    `feature_catalog_entries` — none ships — would shrink it there.

    `docs/guides/upgrade-to-1.0.md` has the migration, with a before and after.

### Patch Changes

- Updated dependencies [07c30c6]
- Updated dependencies [877faa4]
- Updated dependencies [4264bfd]
- Updated dependencies [6a83734]
- Updated dependencies [d64bf82]
    - @saasicat/core@1.0.0-rc.21

## 1.0.0-rc.20

### Patch Changes

- @saasicat/core@1.0.0-rc.20

## 1.0.0-rc.19

### Major Changes

- 99cbb89: An operator corrects its own details, and the running contracts follow

    `config/saas.yaml#issuer` names the legal entity on the operator's side of every
    contract, and a contract copies it the day it is concluded. Its address and
    contact details move freely and take effect at the next start, for contracts
    already running too. Its `legalName`, `vatId` and `taxNumber` are the party a
    contract names, so a start that finds one of them different from the one the
    installation recorded refuses — unless the file declares the change a correction
    of that same legal entity.

    - `issuer.correctionOf` is new: it names, for each identity field that moves, the
      value the installation recorded before it — `null` where it recorded none,
      which is how a tax number assigned later is declared — plus a `reason`. It
      carries no date of its own: the settings record dates the start that applied
      it. It is needed only for the start that carries the change, and a later deploy
      may drop it; left in, it changes nothing and does not cover the next change.
    - Taking the `issuer` block away once an identity is recorded is refused the same
      way, and it is the one shape a declaration cannot rescue: `correctionOf` lives
      inside the block. That refusal prints the issuer as the installation recorded
      it, address included, to write back.
    - The refusal names the contracts still running and what each was concluded
      under, and prints the declaration to paste. It applies whichever way the
      identity moves, so during a rolling deploy an old replica restarting on the
      previous file is refused too: two replicas concluding contracts under two
      different legal entities is what this prevents. Moving a contract to another
      legal entity is a transfer, not an edit of a setting.
    - `<app> doctor` gains `platform.issuer-identity`, which asks the same question
      without acting on it, and says what changing the identity would cost while
      nothing has moved.
    - **`SubscriptionContractRepository` gains `listRunningIssuers(limit, asOf?)`**:
      how many contracts are concluded and not yet over, and the first `limit` of
      them, oldest first, each with the legal name on its issuer copy or `null` where
      it names none. Running means `active` or `scheduled` and not ended at `asOf`;
      status alone would not do, because an ordinary cancellation writes only
      `effectiveUntil`. Both shipped adapters implement it and the persistence
      contract covers it; an implementation of your own adds it.
    - `issuer.legalName`, `issuer.vatId`, `issuer.taxNumber` and
      `issuer.correctionOf.reason` are compared with the surrounding whitespace taken
      off, and the schema now refuses a value that is only whitespace: `vatId: "   "`
      validated before and now fails at schema validation. Both sides are settled the
      same way, so a stray space cannot make a value differ from itself — and a
      contract's issuer copy stores the address settled like the identity beside it,
      so party rows written from the next start carry trimmed values.
    - **The boot checks read platform-wide through `RlsBypassPort`.** They always
      should have: without the frame, an installation with a policy on
      `subscription_contracts` was told "No contract is running." where hundreds do,
      and — the one that matters — `StoredPaymentReferencesCheck` read
      `subscriber_payment_methods` as empty and **passed**, so a start went ahead with
      payment methods held at an account the file no longer names. That check now
      sees those rows and refuses such a start at the first restart after this
      upgrade, on an installation where neither the file nor the database changed:
      list the account again with its gateway bound, until its subscribers have a
      payment method at another one. The port's contract says so too — it is now
      called outside a request pipeline, so an implementation that reaches for a
      request-scoped connection fails at start rather than where it is called.
    - **`SUBSCRIBER_IDENTITY_FIELDS` is now `LEGAL_IDENTITY_FIELDS`, and
      `SubscriberIdentityField` is `LegalIdentityField`** — the same three fields,
      named for what they are: both parties to a contract have a legal identity, and
      the issuer is not a subscriber.
    - `IssuerIdentityInspector` and `IssuerIdentityCheck` are exported from
      `@saasicat/nest` and `@saasicat/nest/platform` and registered for every
      configuration. The inspector answers the question and acts on nothing —
      `inspect()` is what `<app> doctor` and a health endpoint of your own call; the
      check is the module hook that turns a refusing answer into a boot that does not
      happen. A CLI that mounts the platform is refused by that hook like any other
      start, so `doctor` reports the state a start would accept rather than printing
      a refusal.

    One consequence to know before it bites: every start records what it applied, and
    a CLI process is a start. Booting your application against the production
    database with a _newer_ `config/saas.yaml` applies that file to the record, a
    declared correction included — and the replicas still on the previous file are
    then the undeclared change, refused at the next restart. Run one-off commands
    with the file the installation is running.

    Three limits, stated rather than left to be found. The comparison needs the
    `core.appliedSettings` port, which both shipped persistence bundles provide;
    without it the boot log says once that the issuer is compared with nothing. A
    contract whose party copy the subscriber migration made names no issuer at all —
    those neither block a change nor are blocked by one, and are confirmed against
    the contract before they are invoiced. And "a later deploy may drop the
    declaration" holds once the start that carried it has recorded it: that write is
    best-effort, so check `GET /admin/settings` before dropping the block.

### Patch Changes

- Updated dependencies [99cbb89]
    - @saasicat/core@1.0.0-rc.19

## 1.0.0-rc.18

### Patch Changes

- @saasicat/core@1.0.0-rc.18

## 1.0.0-rc.17

### Major Changes

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

## 1.0.0-rc.16

### Major Changes

- 6009a93: Conclude every contract with its subscriber, and copy both parties onto it

    A tenant holds the application's data; the subscriber is the party a contract
    is concluded with: a customer number and the master data a contract names.
    Every contract names its subscriber and copies the subscriber and the issuer
    from `config/saas.yaml` when it is concluded, and a later change to either
    leaves the copy alone. A contract belongs to its subscriber, and its `tenantId`
    is kept as a trace without a relation to the tenant.

    - New `Subscriber`, `SubscriberTenant` and `SubscriberCorrection` fragments,
      and `subscriberId`, `subscriberSnapshot`, `issuerSnapshot` and
      `partiesMigrated` on `SubscriptionContract`. Remove the relation from
      `SubscriptionContract` to your `Tenant` model: `saasicat schema check` fails
      while it cascades.
    - Run `sql/1.0-a-contract-names-its-subscriber.postgres.sql` before `db push`.
      It gives every tenant with a subscription or a contract a subscriber named
      from your tenant table's `name`, attaches its contracts with copies marked
      `partiesMigrated`, and makes the link required; it stops, naming the tenants,
      where it cannot name one or row-level security hides their rows. Once the
      link is required, a later run by a role that owns the tables does nothing,
      under row-level security too.
    - `SubscriberService` in the new `@saasicat/nest/subscriber` entry creates the
      subscriber where your application creates a tenant, on the same transaction,
      with only the legal name required. Customer numbers count from 10001 behind
      `subscribers.customerNumberPrefix`. Contact details change at any time; the
      legal name and tax identifiers change only as a declared correction of the
      same legal entity, recorded with the values replaced, the reason and who made
      it.
    - `SubscriptionContractService.create`, `replaceActiveContract`, the contract
      freeze and `CheckoutOfferService.conclude` refuse a tenant without a
      subscriber with `SUBSCRIBER_REQUIRED`, and so do a plan change and booking an
      add-on where contracts are frozen, before anything is written. `conclude`
      takes `subscriber` to create a sign-up's subscriber on its transaction, and
      `FinalActivationResult` carries `subscriberId`.
    - `SubscriptionContractModule`, the `conclusion` of `CheckoutOfferModule` and
      `tenantBilling.contractFreeze` require `subscriberRepository`; both shipped
      persistence bundles supply it. `SubscriberService` reads the plan catalogue,
      so `SubscriptionContractModule` wired by hand needs `PlanCatalogModule` in
      scope, as `SaaSiCatModule` provides it.
    - `ContractFreezePort` gains `assertPartyFor(tenantId)`; an implementation of
      your own adds it.
    - `config/saas.yaml` takes an optional `issuer`. A database catalogue now
      carries every settings block of the file, this one included.
    - `persistenceAdapterContract` checks the subscriber port under the new gap
      `subscribers`, and the contract scenarios need the seed writer
      `createSubscriber`.

### Patch Changes

- Updated dependencies [6009a93]
    - @saasicat/core@1.0.0-rc.16

## 1.0.0-rc.15

### Major Changes

- b328b35: Conclude a checkout offer with its contract in one transaction

    `CheckoutOfferService.conclude(offerId, options, within)` consumes the offer,
    writes its contract and runs the application's own writes, such as starting the
    subscription and redeeming the promo code, on one transaction. Everything that
    can refuse is checked first; a failure after that undoes all of it and leaves
    the offer open. An offer concluded already for the same tenant answers with its
    contract; for another tenant it is refused as consumed, and an offer changed
    after its checks is refused with the new `CHECKOUT_OFFER_CHANGED`.
    `SaaSiCatModule.forRoot` wires it where the persistence bundle has a contract
    repository and a transaction runner; `CheckoutOfferModule.forRoot` takes
    `conclusion` for wiring by hand.

    - `CheckoutOfferRepository.consume(id, tx?)` writes on `tx` and only while the
      offer is open, refusing it otherwise.
    - `SubscriptionContractRepository.create(data, tx?)` writes on `tx`, and
      `findByOriginalOfferId(offerId, tx?)` is new; both shipped adapters implement
      them.
    - `persistenceAdapterContract` checks both, and gains the gap
      `checkoutOffers` for a harness without a `CheckoutOfferRepository`, which
      both shipped adapters declare.

### Patch Changes

- Updated dependencies [b328b35]
    - @saasicat/core@1.0.0-rc.15

## 1.0.0-rc.14

### Major Changes

- 82410a0: A port the harness leaves out fails the persistence contract unless it is
  declared

    A scenario group whose port or seed writer the harness does not provide used to
    report as skipped, and a suite could pass with a whole group unchecked. It now
    fails, naming the part. An adapter that deliberately does not provide a part
    lists it in the new `gaps` option of `persistenceAdapterContract`, and its
    scenarios report as skipped as before; a gap listed there that the harness does
    provide fails the suite. Groups ruled out by the adapter's `capabilities`, such
    as the lock scenarios, still skip.

    - A harness that wires every port its adapter ships changes nothing.
    - A harness that relied on skips either wires the missing ports or declares
      them: `gaps: ['appliedSettings']`. `ContractGap` lists the names, and a name
      that is not one fails the suite as unknown.
    - Which parts a port provides can follow its options: `@saasicat/adapter-prisma`
      adds `findActivePlanVersion`, `findActiveBundleVersion` and
      `applyOnboardingSelection` only with `validityWindows` and
      `atomicOnboardingSelection`. Derive `gaps` from the same options.

- bf2728c: Reading a plan's versions by a key no plan has answers empty

    With `planBinding: { mode: 'normalized-plan-id' }`, `PrismaPlanRepository`'s
    `listVersions`, `findCurrentDraft`, `findLatestLivePlanVersion` and
    `findActivePlanVersion`, and `PrismaPlanVersionRepository`'s `findLatestLive`
    and `findActive`, threw `Plan '…' not found.` for a key no live plan had. A
    plan removed between listing the catalogue and reading its versions turned
    publishing a bundle version into a server error, and the versions of a retired
    plan could not be listed at all.

    - A key no plan row has now reads as an empty list or `null`.
    - A retired plan's versions stay readable, as they already were in the legacy
      binding and in `@saasicat/adapter-drizzle`: the guard that decides whether a
      plan may be deleted counts them.
    - Writes to a plan that is not live still refuse. `PlanVersionsService`
      refuses to create a draft for a retired plan, or to publish one left over
      from before it was retired, with `PLAN_NOT_FOUND`: `POST /plans/:planId/versions`
      and publishing a plan version answer 404 for a retired plan, on every
      adapter.
    - The exported `PrismaPlanBindingResolver` interface gains the member
      `findStoragePlanId`; a hand-written implementation of it adds one.
    - The persistence contract checks both, so an adapter that throws for an
      unknown key, or hides a retired plan's versions, now fails it.

### Patch Changes

- Updated dependencies [a87cc4e]
- Updated dependencies [cd89334]
- Updated dependencies [a87cc4e]
    - @saasicat/core@1.0.0-rc.14

## 1.0.0-rc.13

### Patch Changes

- Updated dependencies [f582840]
    - @saasicat/core@1.0.0-rc.13

## 1.0.0-rc.12

### Patch Changes

- @saasicat/core@1.0.0-rc.12

## 1.0.0-rc.11

### Patch Changes

- @saasicat/core@1.0.0-rc.11

## 1.0.0-rc.10

### Major Changes

- d4b294e: A contract line records the currency and the tax it was booked with

    `ContractLineItem` gains three required columns — `currency`, `taxRate` and
    `taxAmount` — and `ContractLineItemRecord`, `NewContractLineItemData` and
    `InvoiceLineItemSnapshot` gain the matching fields. An installation configures
    one currency and one rate at a time, so a line never chooses them; what the
    column is for is that a row keeps meaning what it meant after either is
    changed, which is why changing a currency once contracts exist is a migration
    rather than an edit.

    `taxRate` is stored even though net and gross both are, because the ratio
    between them is not the rate: it cannot be reproduced for a gross that was
    rounded, it cannot express an exempt or a reverse-charge line, and it does not
    survive a rate change. `taxAmount` is the gap between the line's own net and
    gross, so the row cannot disagree with itself and no reader rounds a second
    time.

    **Run `sql/1.0-line-items-record-their-money.postgres.sql` before `db push`.**
    The columns are NOT NULL, which `db push` cannot add to a table that already
    holds rows. The migration adds them, fills them from each line's own contract —
    `priceSnapshot` already records the currency and the VAT rate that were agreed
    — and only then makes them required. It refuses, naming the contract, where a
    snapshot states no currency or a rate that is not a number between 0 and 100,
    rather than inventing one; and it does nothing at all on a second run.

    **If you implement the persistence ports, your build breaks here.** A
    repository adapter has to read and write the three fields.
    `ContractFreezeSourcePort.loadBookedBundles` deliberately does not: its
    `lineItems` are now `PricedContractLineItem`, the same shape without them,
    because a source prices what it sells and the platform records the
    installation's currency and rate. An adapter that annotates its result as
    `NewContractLineItemData[]` needs that annotation dropped or changed.

    **The rate is recorded in per cent on both paths, which the checkout path did
    not do before.** A checkout offer prices its lines as `net * (1 + vatRate)` and
    so states the rate as a fraction, while the catalogue states per cent; recorded
    as they stand, one column would hold both. Which unit an offer's breakdown
    carries is now read off that breakdown's own totals rather than assumed.
    `SubscriptionContractPriceSnapshot.vatRate` is unchanged and still carries
    whichever unit the contract was concluded with — it now says so — and
    `ContractLineItemRecord.taxRate` is the one that is always per cent.

    **`SubscriptionContractService.create` refuses a line that disagrees with its
    contract.** `SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH` where `taxAmount` is
    not exactly `priceGross - priceNet`, and
    `SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH` where the line's currency is
    not the one the contract was priced in. Both platform paths satisfy them, so
    these only reach a caller supplying its own line items — but a contract is
    append-only, and an invoice stating one currency in its total and another on
    every line is a record nobody can correct afterwards.

    `@saasicat/spec` also ships `schemas/tenant-ledger.schema.json`, naming the
    shapes of a per-tenant account — a charge, a payment, the origins a charge can
    have, and the account read model — with the generated types in `@saasicat/core`. A
    payment carries no tax split: the net, the rate and the tax belong to the
    charges it settles, and asking a payment for them would make an integrator
    write a number nobody knows. Nothing reads the shapes yet; the persistence and
    the service that writes charges follow.

### Minor Changes

- ed7cee4: One edit is recorded once, however many replicas start on it

    Several replicas of one installation starting together after one edit of
    `config/saas.yaml` each read the same record, each found the same difference,
    and each wrote a change row and mailed every address under
    `notifications.settingsChanged` — three replicas and two addresses made six
    mails for one edit, and three changes for an operator to acknowledge one by
    one. Now only the start that replaces the record writes the change and tells
    people; the others read again, find the record already saying what they run,
    and say nothing. A replica running a different file than the one that won has
    a difference of its own and records it.

    **The port's two writes are guarded.** `AppliedSettingsPort`, new in the 1.0
    line, changes shape for that:

    - `writeApplied(record, expectedFingerprint)` replaces the record only while it
      still carries the fingerprint the caller read — `null` where it read no
      record — and answers whether it did.
    - `recordChange(change, record, expectedFingerprint)` appends the change and
      replaces the record it supersedes in one transaction, both or neither, under
      the same guard; it answers the stored change, or `null` where another start
      got there first.

    `prismaPersistence()` and `drizzlePersistence()` implement both, and the
    executable contract in `@saasicat/persistence-testing` holds every adapter to
    them, concurrently and against a real database.

    **The list of changes reads in the order the record moved.** `settings_changes`
    gains `seq`, numbered by the database at the write that records each change,
    and `listChanges` orders by it instead of by `noticedAt`. That moment is the
    recording start's own clock — the recorder now reads it right before writing
    rather than when the start began — but a start delayed between its clock and
    its write could still land after another's move and be listed before it. The
    number is assigned inside the write, under the row lock the guard takes, so it
    cannot. Run `sql/1.0-a-settings-change-carries-its-order.postgres.sql` once,
    the same way as the other files; it is safe to run again, numbers rows recorded
    before it in the order they were listed until now, and does nothing on a
    database created from the reference schema. On the Prisma path, `SettingsChange`
    gains `seq Int @unique @default(autoincrement())` — copy it from
    `prisma-fragments/12-applied-settings.prisma`. An `AppliedSettingsPort` you
    wrote yourself against an earlier candidate needs the two signatures; nothing
    else moves, and no migration is involved — the guard uses the columns the
    tables already have.

- 3a700a4: The platform records the configuration it applied

    `config/saas.yaml` says what should be true. Until now nothing said what IS
    true, and somebody who edited the file an hour ago had no way to tell whether
    it had landed. At every start the platform now records the settings it applied
    — everything in the file but the plans and the features, with the environment
    references resolved — together with a `sha256-…` fingerprint over them, the
    moment they took effect and the file they came from.

    Three states, and almost every start is the middle one: no record → written;
    same fingerprint → nothing happens, and `appliedAt` keeps saying when these
    values took effect; different → the record is replaced and the difference is
    written down, leaf by leaf with both values, in `settings_changes`. The
    fingerprint covers the settings and not the catalogue, so a plan added to the
    file is not a configuration change — and it covers the resolved values, so a
    production variable that moved the notice period is one.

    **The record is a mirror, never a source.** Nothing reads a setting out of it;
    a record that disagrees with the file changes nothing about what runs, and a
    test holds the port to the module that writes it and the endpoint that shows
    it. `GET /admin/settings` is that endpoint: the running settings, their
    fingerprint and source, `appliedAt` where the record matches what is running,
    and the recent changes with what moved. It sits behind `controller.guards`
    like the manifest and discovery, and `includeSettingsController: false` leaves
    it out for an app that serves the path itself — the record is kept either way.

    **Two tables, one migration.** `applied_settings` holds one row — the
    installation's, held to one by a `CHECK` rather than by convention — and
    `settings_changes` one row per start that noticed a change. Run
    `sql/1.0-the-applied-settings-are-recorded.postgres.sql` once, before
    `db push` where you use one; it is safe to run again and does nothing on a
    database created from the reference schema. On the Prisma path, copy the two
    models from `prisma-fragments/12-applied-settings.prisma`.

    `AppliedSettingsPort` is a new port in `@saasicat/core`, served by both
    `prismaPersistence()` and `drizzlePersistence()` as `core.appliedSettings` and
    held to the same executable contract. It is optional in the bundle: a
    persistence adapter written before it existed still starts, and the platform
    says once, at boot, that it is not recording. `SaaSiCatAdapters.appliedSettings`
    overrides the bundle's slice like the other core ports.

    `loadPlanCatalogFromFile` now remembers the absolute path it read a catalogue
    from — `catalogSource(catalog)` returns it — which is what the record names as
    the source. A catalogue handed in as an object, or through `dbCatalog`, is
    recorded as coming from code, not from a path the platform did not read.

    `@saasicat/core` also gains `settingsSubtreeOf`, `canonicalJson` and
    `diffSettings`, the pure functions behind the fingerprint and the difference.

### Patch Changes

- Updated dependencies [7c7b06c]
- Updated dependencies [d4b294e]
- Updated dependencies [e95b629]
- Updated dependencies [5936288]
- Updated dependencies [c351b6b]
- Updated dependencies [ed7cee4]
- Updated dependencies [3a700a4]
    - @saasicat/core@1.0.0-rc.10

## 1.0.0-rc.9

### Patch Changes

- Updated dependencies [16a8542]
    - @saasicat/core@1.0.0-rc.9

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

- Updated dependencies [d492281]
- Updated dependencies [89eed2b]
- Updated dependencies [9b5ca2f]
    - @saasicat/core@1.0.0-rc.7

## 1.0.0-rc.6

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

- @saasicat/types@0.10.1

## 0.10.0

### Patch Changes

- @saasicat/types@0.10.0

## 0.9.0

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
