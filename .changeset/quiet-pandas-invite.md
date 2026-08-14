---
'@saasicat/ui-vue': minor
---

One categorical colour ramp, contrast checks that see gradients and dialogs, and
reflow points that agree with Quasar.

**One identity ramp instead of five.** `PlanList`, `PlanMatrix`,
`tenants/format.ts`, `PromoCodesPage`, `MarketingPromotionsTab` and
`discovery-ui.ts` each carried their own six-colour palette of hex literals —
two of them byte for byte identical, and the tenants one silently different, so
the same plan was violet on the plans page and brand blue on the tenants page.
There is now one ramp in the theme (`--sa-color-identity-1…6`, plus
`-identity-neutral`), with a value per theme, and one module that reads it:

```ts
import { identityAccentFor, identityChipStyle } from '@saasicat/ui-vue/client';

const style = identityChipStyle(identityAccentFor(plan.planKey, props.planAccents, index));
```

Consumer colours still win — `planAccents` takes any CSS colour, and the helpers
mix rather than concatenate.

This closes the `.sa-plan-list-plan-mark` contrast exception: those accents were
applied as inline styles built by gluing hex digits onto a colour
(`accent + '15'`), so they could not follow the theme and the plan mark measured
2.96:1 on a dark surface. Every rung is now chosen to be readable as text in its
own theme.

**Two contrast blind spots closed.**

- Both checkers now read a **gradient's colour stops** and judge the foreground
  against each. The header, the drawer logo, both logo badges and the production
  banner had never been judged: their backgrounds are
  `var(--knob, linear-gradient(…))`, which the source checker resolved to
  `null`, and the browser one skipped any element with a `background-image`.
  It found the plan timeline's draft hatch at 2.34:1 in light and 1.34:1 in dark.
- The browser checker now looks inside **teleported nodes**. Quasar moves every
  dialog to `<body>`, so a checker walking the page root had never judged one of
  the package's twenty-one dialog sites. It found Quasar's inactive stepper
  labels at 2.68:1, which the theme now paints from a role.

**Reflow points are Quasar's.** The six ad-hoc breakpoints (540, 600, 980, 1100,
1180, 1280) are on Quasar's bands, so a component no longer reflows in a band
where the host application's grid does not.

**Tenant-facing fixes.** `MySubscriptionBundlesPage` takes an `http` prop like
every other tenant component — without one it fell through to a bare `fetch()`,
so an app using an axios adapter with an auth interceptor got an unauthenticated
request from this page and nowhere else. `planChangeWizardI18n()` is exported,
so mounting `PlanChangeWizard` directly no longer means reproducing a 44-key
string mapping by hand. The marketing toolbar wraps instead of pushing content
off the side of the page below 672px.
