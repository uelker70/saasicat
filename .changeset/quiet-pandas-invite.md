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

The ramp ships in two forms, and which one you want depends on where the colour
goes. `IDENTITY_ACCENTS` are token references and follow the theme — use them to
paint. `IDENTITY_ACCENT_VALUES` are concrete colours — use them wherever the
colour is **stored**, such as a picker whose choice is sent to an API. A test
binds the two so they cannot drift.

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

**Reflow points agree with the thing they have to fit into.** Five of the six
ad-hoc breakpoints (540, 600, 980, 1280 and one of the 1100s) are on Quasar's
bands, so a component no longer reflows in a band where the host application's
grid does not.

The plan-version editor is the exception, and deliberately: it reflows on a
**container query** rather than a viewport width. A viewport threshold is wrong
in one of the admin drawer's two states by construction — with the 240px drawer
open at 1024–1100px, `320px 1fr 360px` had only 784–860px to sit in, leaving the
middle column at 104–180px and clipping its form controls behind
`overflow: hidden`. If you embed `PlanVersionEditor` in a narrower shell than the
admin's, it now stacks earlier than before; that is the point of the change.

Two more layout fixes came with it. The plan list **scrolls horizontally**
instead of being cut off — its six-column grid needs about 790px, and below that
the wrapper's `overflow: hidden`, which is there for the corner radius, simply
removed the far columns. And Quasar's **stepper** takes its colours from the
theme: its inactive step titles were a hard-coded grey at 2.68:1 on a white card.
The active step keeps Quasar's `text-primary` accent — that is the "you are here"
affordance.

**Tenant-facing fixes.** `MySubscriptionBundlesPage` takes an `http` prop like
every other tenant component — without one it fell through to a bare `fetch()`,
so an app using an axios adapter with an auth interceptor got an unauthenticated
request from this page and nowhere else. `planChangeWizardI18n()` is exported,
so mounting `PlanChangeWizard` directly no longer means reproducing a 44-key
string mapping by hand. The marketing toolbar wraps instead of pushing content
off the side of the page below 672px.
