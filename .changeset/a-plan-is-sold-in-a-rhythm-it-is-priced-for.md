---
'@saasicat/core': minor
'@saasicat/nest': major
'@saasicat/ui-vue': major
'@saasicat/ui-vue-tenant': major
---

A plan is sold only in a rhythm it carries a price for

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
