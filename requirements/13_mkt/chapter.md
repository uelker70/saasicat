---
title: The public catalogue, checkout and contracts
---

What a prospective customer sees before they buy, and what happens between choosing and owning.
The single idea running through it: the offer is frozen before money is involved, so what somebody
saw is what they get, and a catalogue edit in between cannot change it.

### SC-MKT-001 — A pricing page reads the published catalogue rather than computing prices

🟢 There is one place prices are decided, and the page is not it.

_Source:_ `docs/explanation/architecture.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-catalog-controller.test.js`
    - listPlans returns only marketed plans in the generic format
    - a plan published after the controller was built is listed at once, and a retired one is gone
    - a plan sold by negotiation is left out even when a figure is on file
    - listFeatureRegistry returns the injected registry 1:1 without a CatalogEntry repo
    - listFeatureRegistry overlays the DB icon over the static registry icon (#13)
    - listBundles returns requiresFeatures from the FeatureCatalogEntries (#35)
    - listBundles without a CatalogEntry repo: requiresFeatures stays empty (graceful)

<!-- END proof -->

### SC-MKT-002 — Only plans an operator marked as marketed appear in self-service

🟢 A negotiated plan is not something a stranger can select for themselves.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/configurator-catalog-builder.test.js`
    - ConfiguratorCatalogBuilder
        - maps marketed live PlanVersions onto models (incl. quota normalization)
        - plan without a marketing entry is hidden
- `packages/nest/tests/registration-service.test.js`
    - listPublicPlans() passes the plan list through

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
        - a promotion the price it meets cannot bear › a percentage above 100 shows the add-on free,
          never at a negative price
        - a promotion the price it meets cannot bear › an intro price above the price shows no
          promotion at all

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

🔵 _(Superseded on 2026-08-31 by `SC-MKT-022`.)_

_Source:_ `docs/reference/options.md`

### SC-MKT-022 — A catalogue offers at most one recommended plan, and the language decides which

🟢 The mark belongs to a projection, and a projection belongs to one plan version and one language,
so no single row can keep this promise: two rows in the same language can carry it, and one carried
in the default language reaches another language through the fallback that fills in a missing
translation. The catalogue is where all three — the live versions, the language asked for, and the
fallback — are known at once, so that is where it is decided. A row written for the language that
was asked for wins over one inherited from the default; failing that, the first plan the catalogue
offers. The others keep their card and lose the mark.

_Source:_ #255

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/recommended-plan.test.js`
    - keepOneRecommended
        - one is left alone
        - none stays none, and the answer is null
        - a row written for the language beats one inherited from the default
        - and it wins from anywhere in the list, not only from the front
        - with none written for the language, the first the caller offers wins
        - with every one written for it, the first still wins
        - a plan that is not recommended is never made one
        - an empty catalogue answers null rather than throwing
        - only the mark is touched — every card stays
- `packages/nest/tests/marketing-projections-service.test.js`
    - MarketingProjectionsService — the recommended mark is not decided here
        - a second recommended projection in the same language is accepted
        - and so is recommending one by edit while another already is
- `packages/nest/tests/public-marketing-catalog-plans-pricetag.test.js`
    - PublicMarketingCatalogService — the recommended plan
        - one is one
        - a plan reaching the page through the fallback loses to one written for the language
        - two rows in the same language leave the one the catalogue offers first
        - the one that loses the mark keeps its card
        - a catalogue that recommends nothing recommends nothing
        - a single fallback row still recommends its plan

<!-- END proof -->

### SC-MKT-010 — Exactly one promotion applies to a given plan, language and rhythm

🟢 Where several overlap, the operator's priority decides, and a promotion tied to a code is not
shown as a public one. A promotion runs to the end of its last day, and never pushes a price below
zero.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-promotion-lowers-a-price-and-nothing-else.test.js`
    - applyPromo keeps a price between 0 and the price it is applied to
        - bounded: ${what}
        - what the result says it takes off is what it takes off
        - ${what} takes nothing off, so it is no promotion there
    - the promotion a price carries
        - is the active one for the key, with what it makes of the price
        - is none for ${what}
- `packages/core/tests/promotion-helpers.test.js`
    - pickActivePromo
        - highest priority wins on overlap
        - onlyLocales filters
        - billingCycle filters
        - requiresCoupon promotions are not selected automatically
        - non-matching plan → null
        - targetType filters bundle promotions separately from plan promotions
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Bundles
        - a promotion the price it meets cannot bear › a percentage above 100 shows the add-on free,
          never at a negative price
        - a promotion the price it meets cannot bear › an intro price above the price shows no
          promotion at all

<!-- END proof -->

### SC-MKT-026 — A promotion is saved only with a value its type can take

🟢 💰 A percentage above 0 and at most 100, an amount above 0, an intro price of at least 0 for a
whole number of months, a whole number of free months — on creating a promotion and on changing
one, where a change of type alone meets the value already stored. Whether an intro price or an
amount fits a line depends on the price it meets, which differs per plan and rhythm, so that bound
is held where the promotion is applied (`SC-MKT-010`).

_Source:_ #311

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-promotion-takes-a-value-its-type-can-take.test.js`
    - creating a promotion
        - a ${type} of ${JSON.stringify(value)} is refused, and nothing is stored
        - a ${type} of ${JSON.stringify(value)} is saved
    - changing a promotion
        - a value its type does not take is refused, and the stored one stays
        - a change of type alone meets the value already stored
        - a ${field} sent as null is judged as null, not as the one stored, and nothing is written
        - a change of both to a pair that fits is saved
        - a change of another field leaves a valid value alone

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
        - a promotion the price it meets cannot bear › a percentage above 100 shows the add-on free,
          never at a negative price
        - a promotion the price it meets cannot bear › an intro price above the price shows no
          promotion at all
- `packages/ui-vue/tests/use-tenant-billing-catalog.test.js`
    - useTenantBillingCatalog
        - load() reads all three endpoints under the default prefix
        - a trailing slash in the prefix does not become a double slash
        - the wire form of a bundle becomes the shape the page renders
        - the optional wire fields default rather than arriving as undefined
        - a missing /bundles endpoint is not fatal — the plan page still renders
        - a failing /plans clears what it could not load
        - a client that resolves with status 0 fails the load rather than emptying it
        - a client that rejects is reported, not swallowed
        - it loads on its own unless the consumer says otherwise

<!-- END proof -->

### SC-MKT-012 — The public catalogue answers even when something behind it is unavailable

🟢 It falls back to what it can still say rather than failing, because it is the page a prospective
customer meets first and it requires no account.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-catalog-controller.test.js`
    - listPlans returns only marketed plans in the generic format
    - a plan published after the controller was built is listed at once, and a retired one is gone
    - a plan sold by negotiation is left out even when a figure is on file
    - listFeatureRegistry returns the injected registry 1:1 without a CatalogEntry repo
    - listFeatureRegistry overlays the DB icon over the static registry icon (#13)
    - listBundles returns requiresFeatures from the FeatureCatalogEntries (#35)
    - listBundles without a CatalogEntry repo: requiresFeatures stays empty (graceful)
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
        - create creates an open offer with a frozen plan line
        - update adds an add-on and prices the offer again
        - every selected bundle version carries its own frozen line
        - a promo code becomes a negative discount line, and removing it removes the line
        - consume freezes the offer
        - consume blocks a bundle version that went off sale after the offer was made
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
        - create creates an open offer with a frozen plan line
        - update adds an add-on and prices the offer again
        - every selected bundle version carries its own frozen line
        - a promo code becomes a negative discount line, and removing it removes the line
        - consume freezes the offer
        - consume blocks a bundle version that went off sale after the offer was made
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

<!-- END proof -->

### SC-MKT-016 — An offer cannot be turned into a contract if part of it is no longer on sale

🟢 💰 Every add-on in it has to still be bookable at the moment of purchase.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - consume blocks a bundle version that went off sale after the offer was made

<!-- END proof -->

### SC-MKT-017 — One offer yields at most one contract, and only once its prices are frozen

🟢 💰 Every selected item carries its own frozen line, so what was agreed is legible item by item.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - create creates an open offer with a frozen plan line
        - update adds an add-on and prices the offer again
        - every selected bundle version carries its own frozen line
        - a promo code becomes a negative discount line, and removing it removes the line
        - consume freezes the offer
        - consume blocks a bundle version that went off sale after the offer was made
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
        - each rhythm pays its tax on its own net, so the gross is what the charges come to
        - a monthly contract adds a monthly add-on as it stands
- `packages/nest/tests/subscription-contract-service.test.js`
    - SubscriptionContractService
        - createFromOffer creates immutable contract line items from a consumed offer
        - createFromOffer blocks open offers
        - replaceActiveContract closes the old contract and creates a new one
        - a replacement whose rate is refused leaves the previous contract active
        - create requires a plan line item
        - a line whose tax does not close its own gap is refused
        - ${what} is refused when a contract is created directly
        - a line booked in another currency than its contract is refused
        - and a line whose tax does close it goes through
        - contractLineItemToInvoiceLineItem maps the contract snapshot losslessly to an invoice
        - subscriptionContractToInvoiceSnapshot builds a complete invoice projection from the
          contract
        - getActiveInvoiceSnapshotForTenant returns the invoice projection of the active contract
        - getActiveInvoiceSnapshotForTenant throws without an active contract
- `packages/nest/tests/tenant-subscription-bundles-refreeze.test.js`
    - add re-freezes the contract with an unchanged plan
    - cancel re-freezes the contract
    - without a ContractFreezePort, add works unchanged
    - freeze error is non-fatal — the mutation result still comes back
    - a failed mutation triggers no freeze

<!-- END proof -->

### SC-MKT-023 — An offer's amounts are computed from the catalogue, never taken from the request

🟢 💰 A caller chooses a plan, a rhythm, add-ons and perhaps a promo code; the plan price comes from
the plan version on sale, an add-on's from its bundle version with the price it carries for that
plan, the promotion from the same choice the public catalogue makes, a promo code's discount from
what the promo module accepts, and the currency and VAT rate from the installation. A plan without a
price for the rhythm, an add-on that is not on sale, not marketed, not compatible or not priced for
the plan, and a code the promo module refuses or cannot check are refused rather than priced at
nothing. When the offer is consumed its stored amounts are computed again from the versions it froze
and the promotions as they stood when it was priced, and its promo code with the promo module as it
stands then, since a code is redeemed when the contract is concluded; an offer whose amounts differ,
or whose code has since expired or run out of redemptions, is refused, so no amount written by
anything else becomes a contract.

_Source:_ release 1.0.0-rc.13

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-offer-is-priced-from-the-catalogue.test.js`
    - what a request says is not an amount
        - the public bodies strip amounts before the service sees them
        - a service called without that pipe still prices from the catalogue
        - an update cannot bring amounts in either
    - where each amount comes from
        - the plan version on sale, in the rhythm chosen, with the installation VAT in per cent
        - an add-on's price for that plan and rhythm, its override included
        - the promotion the public catalogue picks, as a discount with its snapshot
        - a promotion tied to a code, or to another language, is not applied
        - a promo code the promo module accepts, on the plan price after its promotion
    - what cannot be priced is refused, not priced at nothing
        - a plan with no version on sale
        - a plan that is not marketed
        - a plan without a price for the rhythm
        - an add-on that is ${reason}
        - the same add-on twice
        - a promo code the promo module refuses
        - a promo code where no promo module is registered to check it
        - the module does not start without a plan repository to price from
    - an offer becomes a contract only with the amounts the catalogue gave it
        - an offer as priced is consumed
        - ${what} written into the stored row is refused
        - a promotion that starts after the offer was priced does not unsettle it
        - a promo code the promo module no longer accepts is refused at consumption
        - an add-on renamed after the offer keeps the offer valid

<!-- END proof -->

### SC-MKT-024 — An offer is concluded into its contract in one step, or not at all

🟢 💰 Consuming the offer, writing the contract it becomes and the application's own writes for it,
such as starting the subscription, commit together or not at all (`CheckoutOfferService.conclude`).
Everything that can refuse is asked first: the offer is open, its add-ons bookable, its amounts the
catalogue's (`SC-MKT-023`), and the contract passes the checks every contract is held to. A failure
after that undoes the consume and the contract, and the offer can be concluded again. The contract
is built from the offer as the transaction consumes it, and an offer changed after its checks is
refused with `CHECKOUT_OFFER_CHANGED` rather than concluded into a contract it no longer describes.
An offer already concluded for the same tenant answers with its contract, so a caller retrying after
a lost answer, or losing to another call for that tenant, gets the conclusion that stands, and the
application's writes do not run a second time; for any other tenant it is refused as consumed, since
an offer carries no tenant and its link can reach anyone. A failure of the application's own writes
stays that caller's error, whatever another call does meanwhile. A promo code on the offer is
redeemed among those writes, on the same transaction: before it the code is checked only as pricing
checks it, and nothing checks it again afterwards, so a redemption that takes the code's last slot
does not refuse the offer it was redeemed for. Where the persistence bundle has no contract
repository or no transaction runner, concluding refuses to run rather than writing the two apart;
consuming an offer alone (`SC-MKT-017`) stays available and leaves the contract to the caller.

_Source:_ autohauspro#352

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-offer-is-concluded-with-its-contract.test.js`
    - concluding an offer
        - consumes it, writes its contract and runs the application on one transaction
        - on a transaction the caller holds, opens none of its own and writes everything on that one
        - undoes all of it when the application’s own write fails, and can be concluded again
        - refuses a contract the offer cannot become before anything is written
        - refuses an offer whose amounts no longer match before anything is written
        - answers an offer concluded already with its contract, without running the application
          again
        - gives a caller that loses the race the conclusion that stands
        - refuses the offer to another tenant once it is concluded, rather than handing over the
          contract
        - refuses a caller that loses the race to another tenant
        - refuses an offer changed between its checks and the transaction, writing nothing
        - keeps its own failure when another call concludes the offer during the rollback
        - keeps its own failure under a runner that retries after a refused consume
        - refuses an offer consumed without a contract, rather than concluding it twice over
    - the party an offer is concluded with
        - a subscriber passed in is created on the transaction, before the contract that names it
        - a failure after it undoes the subscriber with the contract, and the next attempt creates
          one
        - a tenant with no subscriber and none passed in is refused before anything is written
        - a subscriber passed in for a tenant that has one is refused before anything is written
        - a subscriber without a legal name is refused before anything is written
        - a retry after the conclusion answers with it and creates no second subscriber
    - a promo code on the offer
        - is not checked again after the redemption took its last slot
        - whose redemption is refused inside the transaction undoes the conclusion
    - without what concluding writes through
        - the service refuses to conclude rather than writing the two apart
        - the module does not start with half of it
        - the module does not start without the parties a contract names
- `packages/nest/tests/platform-composition.test.js`
    - the checkout offer composer
        - wires concluding from a bundle that has contracts and a transaction runner
        - leaves it unwired where the bundle has contracts but no subscribers
        - leaves it unwired where the bundle has no contract repository
        - refuses to start when the application names half of it and nothing supplies the rest
        - leaves it unwired without a transaction runner

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
        - a replacement whose rate is refused leaves the previous contract active
        - create requires a plan line item
        - a line whose tax does not close its own gap is refused
        - ${what} is refused when a contract is created directly
        - a line booked in another currency than its contract is refused
        - and a line whose tax does close it goes through
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
        - a replacement whose rate is refused leaves the previous contract active
        - create requires a plan line item
        - a line whose tax does not close its own gap is refused
        - ${what} is refused when a contract is created directly
        - a line booked in another currency than its contract is refused
        - and a line whose tax does close it goes through
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

### SC-MKT-025 — The public catalogue says what a new payment method is taken with

🟢 A page that offers the plans can say what will be asked for before anybody reaches a form: the
public catalogue answers whether this installation takes a new payment method at all, and the
methods that form offers, in the order the installation names them. It is derived from the account
`config/saas.yaml#payments.newPaymentMethods` names and the gateway bound for it, rather than kept a
second time on the website — so a page that says "no payment method is taken" keeps saying it only
while it is true. The catalogue is told where to read that answer when it is wired, and a wiring
that cannot reach it refuses to start rather than publishing that none is taken. Which account it is
and who keeps the payment method stay inside: a prospect is told that a card or a direct debit will
be asked for, not where it is kept.

_Source:_ #276

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/platform-composition.test.js`
    - the catalogue composer
        - a catalogue beside payments reads them from the gateway registry
        - a catalogue without payments is told that none are taken, not left to guess
- `packages/nest/tests/the-public-catalogue-says-what-a-payment-method-is-taken-with.test.js`
    - what the public catalogue says a payment method is taken with
        - an installation that takes none says so
        - an account that takes new payment methods answers with the methods it offers
        - the methods keep the order the installation names them in
        - a gateway bound for an account that takes no new ones takes none
        - a catalogue with no plan versions to show still answers it
        - neither the account nor its provider is in the answer
        - the registry reaches the catalogue in a wired application
        - a catalogue told there is no source takes none
        - a source out of the catalogue’s scope refuses the boot instead of answering

<!-- END proof -->
