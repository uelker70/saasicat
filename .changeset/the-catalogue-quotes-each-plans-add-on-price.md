---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

The catalogue names an add-on's price beside each plan

The public catalogue named an add-on's own price, while the contract and the
invoice take the price the add-on carries for the plan chosen, so a prospect
could be shown one price and charged another. `GET public/marketing-catalog`
now gives each add-on `planPrices`: for each plan it can be booked with, what a
contract for that plan takes in each rhythm, and after its promotion
(`SC-MKT-030`). The onboarding shows and charges the price beside the chosen
plan. See "The catalogue names an add-on's price beside each plan" in
`docs/guides/upgrade-to-1.0.md`.

- `@saasicat/core`: `PublicBundlePlanPrice`, and
  `PublicMarketingBundle.planPrices`, required — code that builds the type
  gives it.
- `@saasicat/ui-vue`: `addOnPriceBeside`, `isOfferedWithEveryPlan`,
  `AddOnPriceBeside` and `AddOnPrices`. `useSubscriptionDraft` charges an
  add-on its price beside the chosen plan, and nothing before a plan is chosen.
- **Breaking:** `@saasicat/ui-vue-tenant`: `PublicBundleGrid` requires
  `planKey` and `planKeys`; its `i18n` and `OnboardingConfigurator`'s
  `i18n.bundles` take `dependsOnPlan` in place of `priceOnRequest`.
