# @saasicat/types

## 0.26.0

## 0.25.0

## 0.24.2

## 0.24.1

## 0.24.0

## 0.23.0

## 0.22.2

## 0.22.1

## 0.22.0

## 0.21.0

## 0.20.0

### Minor Changes

- 6c0d40d: Make the error contract hold what it promises

    Breaking. A review of the error-code release found the contract stated more
    than the wire delivered.

    **`message` is now always present.** `PlatformErrorBody` declared it required,
    but 36 throw sites passed only `{ code }` — most of the registration funnel,
    every OTP failure. NestJS hands an object argument through verbatim, so those
    responses shipped without a message: a consumer typing the body read
    `undefined`, and `body.message.includes(...)` threw. A new `codedError(code,
params?)` derives the message from the shipped English catalogue, which also
    makes the fallback text identical to the shipped default by construction.

    **One params shape per code.** The same code carried different keys depending
    on which service threw it — `versionId` here, `bundleVersionId` there. Since a
    consumer's translation interpolates by key name, half the throw sites left the
    placeholder unfilled. `error-params-contract.test.js` now fails if a throw site
    omits a placeholder its template names, or if two sites disagree on a key.

    **`FEATURE_NOT_LICENSED` has one shape.** Both feature guards always emit the
    full `FeatureNotLicensedBody`; without a resolver `offers` is `[]` rather than
    absent, so a consumer can rely on the declared type. The code is now part of
    `PLATFORM_ERROR_CODES`, so an exhaustive switch covers it.

    **Renamed / split codes** — update any consumer that matches these strings:

    | before                                 | after                                                    |
    | -------------------------------------- | -------------------------------------------------------- |
    | `PLAN_VERSION_NOT_LIVE`                | `PLAN_VERSION_NOT_PUBLISHED` / `PLAN_VERSION_SUPERSEDED` |
    | `SUBSCRIPTION_BUNDLE_ALREADY_CANCELED` | `SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED`                  |
    | `SUBSCRIPTION_BUNDLE_NOT_CANCELED`     | `SUBSCRIPTION_BUNDLE_NOT_CANCELLED`                      |

    The split matters: one code covered both "was never published" and "already
    superseded", which a consumer could not tell apart.

    Also: `QUOTA_DIMENSION_UNKNOWN` is emitted instead of a bare `Error` (still
    500 — the dimension comes from the calling code, not from user input), the
    promo rate limiter sends the `retryAfterSeconds` its catalogue entry promises,
    and `requireSubscriptionPk` gained `SUBSCRIPTION_PK_MISSING` so a wiring error
    is distinguishable from a missing subscription.

    `reason` remains alongside `code` everywhere it existed.

## 0.19.0

### Minor Changes

- 0c17a83: Translate all user-facing strings to English

    Exception messages, log output, validation messages and CLI output were partly
    German. For an open-source package the shipped language has to be English, so
    consuming apps can localise on their own terms.

    Both feature guards keep `Feature` as the leading word of their 403 message
    (`Feature X is not included in the current plan.`). Consumers that classify the
    403 by matching the message text — autohauspro does — keep working. That text
    match is a fragile contract, and the follow-up is to give every exception a
    stable `code` so consumers can resolve their own i18n by code instead of by
    message.

    No API, no behaviour and no error-code change; only message text.

- b01eaa0: Give every exception a stable error code

    Consumers had to classify errors by matching the message text — autohauspro
    still does, with `data.message.includes('Feature')`. While the message is the
    contract, no message can be reworded safely, and a package that ships English
    text cannot be localised by its consumers.

    `@saasicat/types` now exports a catalogue of 127 codes grouped by domain, plus
    `PlatformErrorCode` and `PlatformErrorBody`. Every exception in
    `@saasicat/nest` carries `{ code, message, params }`: the code is the
    contract, `message` is an English developer-facing fallback, and `params`
    holds the values previously only interpolated into the text, so a consumer can
    render a translated sentence without scraping ids back out of the message.

    Guards that reported through a `reason` field (MFA, promo rate limit,
    IP rate limit, the limit-exceeded filter) now send `code` **and** `reason`.
    `reason` is deprecated but retained, so nothing breaks.

    Wire-shape note: NestJS turns a string argument into
    `{ message, error, statusCode }` but passes an object argument through
    verbatim. Coded errors therefore carry no `error`/`statusCode` in the body —
    the HTTP status is on the response itself. No consumer in this workspace reads
    those fields from the body.

    Two known defects are documented in the catalogue and deliberately left for a
    separate release, because fixing either changes the wire format:
    `PLAN_VERSION_NOT_LIVE` covers two distinct causes, and
    `SUBSCRIPTION_BUNDLE_ALREADY_CANCELED` spells "cancel" with one L beside a
    sibling that uses two.

    Also repairs 28 strings that the previous translation left half-German
    ("is notehr buchbar", "not foundefunden") or untranslated.

- edfbdfe: Ship default error texts in English and German

    An error body carries a code and an English developer message. That leaves a
    consumer two bad options: show English to end users, or translate 128 strings
    before showing anything. For the 21 codes thrown as a bare `{ code }` —
    most of the registration funnel, including every OTP failure — there is no
    message at all, so the code itself was the only thing to display.

    `ERROR_MESSAGES_EN` and `ERROR_MESSAGES_DE` now ship a text per code, and
    `resolveErrorMessage` renders one: consumer override first, then the shipped
    default, then the `message` from the body, and only then the bare code. Since
    every coded exception carries a message, that last step is unreachable in
    practice — a consumer that has not yet translated a new code shows English
    prose, never `PLAN_VERSION_NOT_LIVE`.

    The English texts are derived from the messages the backend actually sends, so
    the shipped default cannot drift from the real one. Placeholders read `params`
    first and the remaining body fields second, so a value already on the wire is
    not duplicated into `params` just to be interpolated.

    `error-messages.test.js` fails if any code lacks a text in any shipped locale,
    or if two locales interpolate different values for the same code.

    `formatMessage` in `@saasicat/ui-vue` now delegates to the same implementation
    instead of keeping a byte-identical copy.

## 0.18.1

## 0.18.0

## 0.17.0

### Patch Changes

- cbd1737: Remove consumer domain vocabulary from the platform.

    `slugify()` fell back to the literal `'verein'` when a tenant name reduced to
    nothing, and that value reaches the tenant slug during registration — so a car
    dealership or a notes app could end up on a slug from someone else's business.
    The fallback is now `'tenant'`, the platform's own term. This changes observable
    output for degenerate input (empty, whitespace-only, or a name with no ASCII
    letters).

    Two placeholder texts in the shared catalogs carried club vocabulary as their
    example — the bundle description ("for active clubs") and the marketing feature
    label ("Membership management"). Both are now domain-neutral; apps that want
    their own wording set it via `i18n.overrides`.

    Doc comments that illustrate how an app supplies its _own_ vocabulary are kept
    deliberately: they document the extension point rather than leak a domain into
    the platform.

## 0.16.0

## 0.15.1

## 0.15.0

## 0.14.0

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

## 0.12.1

## 0.12.0

## 0.11.0

## 0.10.1

## 0.10.0

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

## 0.8.0

### Minor Changes

- 1003a52: Remove the obsolete `PlanVersionsPage`, its standard navigation manifest key,
  and the synthetic client-side catalog snapshot projection. Plan lifecycle and
  per-plan version history remain in `PlansPage`; `MarketingCatalogPage` remains
  the separate marketing projection.

    Retain the reusable catalog timeline and diff components behind a presentation
    contract that can consume immutable Publication Archive / Catalog History
    snapshots from issues #30 and #35.

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

## 0.6.0

### Minor Changes

- 0c08fc3: Remove the BusinessType catalog concept across the public contracts, NestJS
  modules, persistence adapters, UI, OpenAPI specification, and canonical database
  schema. Subscriptions now always reference a plan version; bundles remain the
  only composable catalog add-on.

## 0.5.0

## 0.4.0

## 0.3.0

### Minor Changes

- d758318: PostgreSQL-first, ORM-agnostic persistence: ship the complete Prisma golden path and make its semantics verifiable.

    - **`@saasicat/adapter-prisma`** (renamed from `@saasicat/prisma`, which is now deprecated): ships every previously missing adapter — `PrismaTransactionRunner`, `PrismaSubscriptionRepository` (row-locked `findByTenantIdLocked`), `PrismaPlanVersionRepository`, the three promo repositories with atomic `claimSlot`/`releaseSlot`/`markExhaustedIfFull`, `PrismaAuditAdapter` (now targeting the canonical `audit_logs` table incl. `actorTag`), `PrismaAuditQueryAdapter`, `PrismaAuditStatsAdapter`, `PrismaSuperAdminBootstrapAdapter`, `PrismaPlanCatalogReadSink`/`ImportSink` — plus the new `prismaPersistence({ client })` bundle factory.
    - **`@saasicat/types`**: new persistence bundle contract — `SaasicatPersistenceAdapter` with core/entitlement/promo slices, `PersistenceCapabilities` + `assertPersistenceCapabilities` (fail-fast `PersistenceCapabilityError`), `PersistenceProvider<T>`; `PasswordHasher` moved here from `@saasicat/nest/registration` (re-exported there).
    - **`@saasicat/nest`**: `SaasPlatformModule.forRoot({ persistence })` consumes adapter bundles (individual `adapters` entries still override field by field) and refuses to boot entitlement without transactions + pessimistic locking.
    - **`@saasicat/persistence-testing`** (new): the executable persistence contract — one node:test suite every adapter must pass against a real database (row-lock serialization, transaction rollback, exactly-once promo claims, unique redemption guard, tenant isolation, audit/MFA roundtrips). CI runs it for adapter-prisma against PostgreSQL 16.
    - **`@saasicat/spec`**: the data model is now normatively anchored in `docs/data-model.md` + `sql/constraints.postgres.sql`, with `sql/reference-schema.postgres.sql` generated from the prisma-fragments (drift-guarded in CI). Fragment fixes: `AuditLog.actorTag` column, new fragment `10-super-admin.prisma`, `FeatureCatalogEntry.core/requires/replaces/successorKey`, missing `BusinessTypeVersion↔Subscription` opposite relation.

## 0.2.1

## 0.2.0

### Minor Changes

- c94b1fe: Remove `quotaKeys` from `saas.yaml` — quota keys now have a single source of truth: the `@DefinesQuota` decorator in code, validated against the discovery snapshot.

    **Breaking:** `saas.yaml` files containing a `quotaKeys:` block fail schema validation (`additionalProperties: false`). Delete the block — the platform derives all quota dimensions from the registered `QuotaProvider` classes.

    - `plan-catalog.schema.json` / `admin-manifest.schema.json` / OpenAPI: `quotaKeys` removed from schema and `planCatalogSnapshot`.
    - `PlanCatalog.quotaKeys`, `PlanCatalogModule.forRoot({ quotaKeys })` and `buildPlanCatalogFromSnapshot` settings field removed.
    - `PlanChangePreviewService.limitsCheck` and `GET /billing/usage` iterate the union of quota keys from entitlement, target plan and usage snapshot instead of the catalog list.
    - `TenantBillingController` no longer injects the plan catalog.
    - `TenantPlanSection` derives the displayed quota keys as an ordered union across all plans and the tenant's effective limits (previously only the first plan's keys), so higher-tier-only quotas stay visible.
