# @saasicat/persistence-testing

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
