---
title: The public catalogue, checkout and contracts
---

What a prospective customer sees before they buy, and what happens between choosing and owning.
The single idea running through it: the offer is frozen before money is involved, so what somebody
saw is what they get, and a catalogue edit in between cannot change it.

### SC-MKT-001 — A pricing page reads the published catalogue rather than computing prices

🟢 There is one place prices are decided, and the page is not it.

_Source:_ `docs/explanation/architecture.md`

### SC-MKT-002 — Only plans an operator marked as marketed appear in self-service

🟢 A negotiated plan is not something a stranger can select for themselves.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/configurator-catalog-builder.test.js`
    - ConfiguratorCatalogBuilder
        - maps marketed live PlanVersions onto models (incl. quota normalization)
        - plan without a marketing entry is hidden

<!-- END proof -->

### SC-MKT-003 — A plan or add-on with no marketing entry, or one marked hidden, is not shown

🟢 Publishing a version and advertising it are two acts.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/configurator-catalog-builder.test.js`
    - ConfiguratorCatalogBuilder
        - maps marketed live PlanVersions onto models (incl. quota normalization)
        - plan without a marketing entry is hidden
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Bundles
        - getCatalog returns empty bundles[] without a BundleRepository
        - getCatalog returns published live bundles with compatiblePlanKeys
        - requiresFeatures (#35): uncovered requires of the bundle features from the
          FeatureCatalogEntries
        - requiresFeatures without a CatalogEntryRepository: empty (graceful)
        - getCatalog filters out non-marketed bundles
        - getCatalog filters out bundles with MarketingProjection visible=false
        - getCatalog ignores drafts (only live = published+not-superseded)
        - i18n: MarketingProjection overrides label + fills description (matching locale)
        - i18n: falls back to DE projection when locale is missing
        - i18n: without a projection the bundle root label applies (description stays empty)
        - bundle promotions are resolved with targetType=BUNDLE

<!-- END proof -->

### SC-MKT-004 — Marketing text belongs to one version and one language

🟢 So a price change and a wording change are separate acts, and a translation cannot silently
describe an offer that is no longer current. There is exactly one entry per version and language.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/marketing-projections-service.test.js`
    - MarketingProjectionsService — master data operations
        - create creates a MarketingProjection (default locale=de)
        - create sets marketing defaults (visible, badge, trial)
        - update changes top features, badge and trial
        - create throws 409 on duplicate creation (same Target+Locale)
        - create accepts multiple locales per target
        - update changes required and marketing fields
        - delete removes the row
        - list filters by targetType + locale
        - getById throws 404 for missing ID

<!-- END proof -->

### SC-MKT-005 — Marketing text falls back to the default language rather than appearing empty

🟢

_Source:_ release 1.0.0-rc.6

### SC-MKT-006 — Marketing edits take effect at once and are not versioned

🟢 They govern what the public catalogue displays, never what a running subscription is owed, so
there is nothing for them to rewrite.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/marketing-projections-service.test.js`
    - MarketingProjectionsService — master data operations
        - create creates a MarketingProjection (default locale=de)
        - create sets marketing defaults (visible, badge, trial)
        - update changes top features, badge and trial
        - create throws 409 on duplicate creation (same Target+Locale)
        - create accepts multiple locales per target
        - update changes required and marketing fields
        - delete removes the row
        - list filters by targetType + locale
        - getById throws 404 for missing ID

<!-- END proof -->

### SC-MKT-007 — Which languages the catalogue is published in is an operator's choice

🟢 Made on the marketing screen, from the pool the installation declared, not in a deployment.

_Source:_ #217 · `docs/reference/options.md`

### SC-MKT-008 — An installation has exactly one set of marketing settings

🟢 A convention resting on a default does not hold against a caller that supplies the value, so it is
a constraint rather than a habit.

_Source:_ `docs/explanation/data-model.md` · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/marketing-projections-service.test.js`
    - MarketingProjectionsService — master data operations
        - create creates a MarketingProjection (default locale=de)
        - create sets marketing defaults (visible, badge, trial)
        - update changes top features, badge and trial
        - create throws 409 on duplicate creation (same Target+Locale)
        - create accepts multiple locales per target
        - update changes required and marketing fields
        - delete removes the row
        - list filters by targetType + locale
        - getById throws 404 for missing ID

<!-- END proof -->

### SC-MKT-009 — At most one plan is marked as the recommended one

🟢

_Source:_ `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — comparison matrix (staircase sorting)
        - feature rows: widest coverage first, on a tie the leading plan column

<!-- END proof -->

### SC-MKT-010 — Exactly one promotion applies to a given plan, language and rhythm

🟢 Where several overlap, the operator's priority decides, and a promotion tied to a code is not
shown as a public one. A promotion runs to the end of its last day, and never pushes a price below
zero.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — priceTag (#47) + featureLabels (#48)
        - priceTag of the bundle MarketingProjection lands in the payload
        - priceTag is null without a MarketingProjection (backward compatible)
        - featureLabels (#48): labels for bundle features ∪ requiresFeatures from the
          FeatureCatalogEntries (incl. i18n)
        - featureLabels: non-curated keys are missing, empty without a CatalogEntryRepository
          (graceful)
- `packages/nest/tests/public-marketing-catalog-plans-pricetag.test.js`
    - PublicMarketingCatalogService — Plan priceTag (#47)
        - the plan MarketingProjection priceTag lands in the payload
        - priceTag is null when the projection maintains none (backwards compatible)

<!-- END proof -->

### SC-MKT-011 — The public catalogue shows base prices only

🟢 A visitor has no plan, so a price that exists only as an override for one plan cannot be shown
there, and an add-on priced that way reads as having no public price rather than as free.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the prices a store is shown
        - are resolved for the plan, in both rhythms
        - carry an override the public catalogue cannot know about
        - a bundle sold in one rhythm only says so for the other
        - an id nobody knows is left out rather than answered with nulls
        - asking for nothing costs nothing
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Bundles
        - getCatalog returns empty bundles[] without a BundleRepository
        - getCatalog returns published live bundles with compatiblePlanKeys
        - requiresFeatures (#35): uncovered requires of the bundle features from the
          FeatureCatalogEntries
        - requiresFeatures without a CatalogEntryRepository: empty (graceful)
        - getCatalog filters out non-marketed bundles
        - getCatalog filters out bundles with MarketingProjection visible=false
        - getCatalog ignores drafts (only live = published+not-superseded)
        - i18n: MarketingProjection overrides label + fills description (matching locale)
        - i18n: falls back to DE projection when locale is missing
        - i18n: without a projection the bundle root label applies (description stays empty)
        - bundle promotions are resolved with targetType=BUNDLE

<!-- END proof -->

### SC-MKT-012 — The public catalogue answers even when something behind it is unavailable

🟢 It falls back to what it can still say rather than failing, because it is the page a prospective
customer meets first and it requires no account.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-route.test.js`
    - SaaSiCat public route metadata
        - ${controller.name} is recognized by global auth guards
        - unmarked controllers stay protected

<!-- END proof -->

### SC-MKT-013 — What a customer selected is frozen into an offer before it becomes a contract

🟢 💰 With an expiry date that runs to the end of its last day. What they saw is what they buy.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - create creates an open offer
        - update customizes an open offer
        - create requires bundle line items for specific bundle versions
        - create freezes bundle versions, promotions and promo code into the offer
        - create adds the discounted price as a negative discount line item
        - consume freezes the offer
        - consume blocks a no-longer-bookable bundle version
        - update on a consumed offer throws Conflict
        - update on an expired offer throws Conflict
        - double consume throws Conflict
        - getById throws for an unknown offer

<!-- END proof -->

### SC-MKT-014 — An offer that has expired or been used cannot become a contract

🟢 Nor can it be changed once it has been used.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - create creates an open offer
        - update customizes an open offer
        - create requires bundle line items for specific bundle versions
        - create freezes bundle versions, promotions and promo code into the offer
        - create adds the discounted price as a negative discount line item
        - consume freezes the offer
        - consume blocks a no-longer-bookable bundle version
        - update on a consumed offer throws Conflict
        - update on an expired offer throws Conflict
        - double consume throws Conflict
        - getById throws for an unknown offer

<!-- END proof -->

### SC-MKT-015 — An offer whose selection does not cover its own dependencies is refused

🟢 If a chosen feature needs another one, the plan and the selected add-ons together have to supply
it. A customer is not sold a combination that cannot work.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService — requires validation (#35 P6)
        - create throws 422 CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED for uncovered requires
        - create accepts when a second bundle covers the requires
        - create accepts when the plan covers the requires
        - update validates the changed bundle selection against requires
        - without a CatalogEntryRepository no validation happens (graceful)
        - without a PlanRepository the plan line item featuresSnapshot covers (fallback)

<!-- END proof -->

### SC-MKT-016 — An offer cannot be turned into a contract if part of it is no longer on sale

🟢 💰 Every add-on in it has to still be bookable at the moment of purchase.

_Source:_ `docs/reference/error-codes.md`

### SC-MKT-017 — One offer yields at most one contract, and only once its prices are frozen

🟢 💰 Every selected item carries its own frozen line, so what was agreed is legible item by item.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - create creates an open offer
        - update customizes an open offer
        - create requires bundle line items for specific bundle versions
        - create freezes bundle versions, promotions and promo code into the offer
        - create adds the discounted price as a negative discount line item
        - consume freezes the offer
        - consume blocks a no-longer-bookable bundle version
        - update on a consumed offer throws Conflict
        - update on an expired offer throws Conflict
        - double consume throws Conflict
        - getById throws for an unknown offer
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — V3 ContractLineItems
        - reads entitlements from active contract snapshot without catalog join
        - Contract entitlementSnapshot wins over line-item aggregation
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a yearly contract holding a monthly add-on
        - counts the add-on as often as it falls due
        - a yearly add-on beside a yearly plan is counted once
        - a monthly contract adds a monthly add-on as it stands
- `packages/nest/tests/subscription-contract-service.test.js`
    - SubscriptionContractService
        - createFromOffer creates immutable contract line items from a consumed offer
        - createFromOffer blocks open offers
        - replaceActiveContract closes the old contract and creates a new one
        - create requires a plan line item
        - contractLineItemToInvoiceLineItem maps the contract snapshot losslessly to an invoice
        - subscriptionContractToInvoiceSnapshot builds a complete invoice projection from the
          contract
        - getActiveInvoiceSnapshotForTenant returns the invoice projection of the active contract
        - getActiveInvoiceSnapshotForTenant throws without an active contract

<!-- END proof -->

### SC-MKT-018 — A contract has exactly one plan line and at least one line in total

🟢 💰 And it cannot end before it starts.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-contract-service.test.js`
    - SubscriptionContractService
        - createFromOffer creates immutable contract line items from a consumed offer
        - createFromOffer blocks open offers
        - replaceActiveContract closes the old contract and creates a new one
        - create requires a plan line item
        - contractLineItemToInvoiceLineItem maps the contract snapshot losslessly to an invoice
        - subscriptionContractToInvoiceSnapshot builds a complete invoice projection from the
          contract
        - getActiveInvoiceSnapshotForTenant returns the invoice projection of the active contract
        - getActiveInvoiceSnapshotForTenant throws without an active contract

<!-- END proof -->

### SC-MKT-019 — A contract that is already closed is not closed again

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-contract-service.test.js`
    - SubscriptionContractService
        - createFromOffer creates immutable contract line items from a consumed offer
        - createFromOffer blocks open offers
        - replaceActiveContract closes the old contract and creates a new one
        - create requires a plan line item
        - contractLineItemToInvoiceLineItem maps the contract snapshot losslessly to an invoice
        - subscriptionContractToInvoiceSnapshot builds a complete invoice projection from the
          contract
        - getActiveInvoiceSnapshotForTenant returns the invoice projection of the active contract
        - getActiveInvoiceSnapshotForTenant throws without an active contract

<!-- END proof -->

### SC-MKT-020 — A contract agreed after a cancellation ends when that cancellation does

🟢 Otherwise the ending would last exactly until the next plan change.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a contract frozen after the cancellation
        - inherits the ending rather than starting open
        - while a subscription with no ending freezes open, as before

<!-- END proof -->

### SC-MKT-021 — A tenant can read back the package they were sold

🟢 The frozen selection is visible to them, unchanged, in their own self-service.

_Source:_ release 1.0.0-rc.6
