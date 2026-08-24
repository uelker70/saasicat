# ADR 0010 — The tenant surface stands without Quasar

**Status:** accepted, not yet implemented · **Date:** 2026-08-24

The work is [issue #206](https://github.com/uelker70/saasicat/issues/206). Until
it lands, `quasar` is still a peer dependency of that package and new code there
writes plain elements rather than adding to the 69 usages this removes.

## Context

`@saasicat/ui-vue-tenant` renders inside the **customer's own application** —
the plan section on their account page, the upgrade wizard, the bundle store.
That is a different room from the one `@saasicat/ui-vue` lives in: the admin UI
is a whole application SaaSiCat hands over, and it may reasonably decide what it
is built from. A component embedded in somebody else's product may not.

Today it decides for them. `quasar ^2.22.0` is a peer dependency, and 69 Quasar
components sit across 8 of the package's 26 SFCs — a `q-stepper` carries the
whole plan-change wizard, `q-dialog` carries the bundle preview, and 15 `q-btn`
sit beside 17 hand-written `<button>`s that do the same job. An application that
does not use Quasar cannot embed the tenant surface at all, and one that does
inherits Quasar's look in a place it styled itself.

The mixed state is the immediate cost: nothing in the package says which of the
two kinds of button is the right one to write next, and a lint rule that
demanded either would be arguing for a stack decision nobody had made.

The larger cost is the one an integrator pays at the door. A developer
evaluating SaaSiCat is deciding whether to put a plan section into an
application they already have — with a UI framework they already chose. "You
also need Quasar" is not a line item on that decision; it is the end of it. The
admin UI may ask for Quasar because it IS the application SaaSiCat hands over.
The tenant components are a guest in somebody else's, and a guest does not bring
a framework.

## Decision

The tenant package targets **Vue and CSS only**. No Quasar components, no
`quasar` peer dependency; the design tokens under `@saasicat/ui-vue`'s theme
stay, because those are CSS custom properties and cost a consumer nothing.

Concretely, what has to be replaced:

| File                                           | Quasar usages |
| ---------------------------------------------- | ------------- |
| `PlanChangeWizard.vue`                         | 18            |
| `tenant-plan-section/BundlePreviewDialog.vue`  | 16            |
| `TenantPlanSection.vue`                        | 12            |
| `tenant-plan-section/TenantBundleStore.vue`    | 8             |
| `PackageSnapshotPanel.vue`                     | 7             |
| `tenant-plan-section/TenantFeatureMatrix.vue`  | 4             |
| `tenant-plan-section/TenantPlanCardHeader.vue` | 3             |
| `tenant-plan-section/TenantUsageGrid.vue`      | 1             |

The two that carry behaviour rather than shape are the work: `q-stepper` in the
wizard and `q-dialog` in the preview. Cards, badges, separators, chips and
spinners are markup with a class.

The admin package goes the other way and keeps going: `@saasicat/ui-vue` writes
no control by hand, and `saasicat/no-hand-built-controls` holds it there. The
two packages answer to different rooms, so one rule cannot cover both — which is
why that rule is scoped to `packages/ui-vue/src` and says so.

## Alternatives considered

- **Finish the Quasar migration in the tenant package instead.** Converting its
  17 remaining hand-written controls would have made the package internally
  consistent, and it adds no requirement the `q-stepper` does not already
  impose. Rejected because it settles the mixed state in the direction that
  keeps a framework choice inside somebody else's application.
- **Leave it mixed and scope the lint rules with an apology.** The rules would
  hold for half the repository while their headers describe a repository-wide
  standard. A rule that is true of half a repository teaches nothing about
  the half it skips.
- **Ship both — a Quasar build and a plain build.** Two implementations of every
  tenant view, and the pair drifts on the first fix that lands in one of them.

## Consequences

- A consumer of the tenant components needs Vue and the theme's CSS custom
  properties, nothing else. The peer dependency on `quasar` goes away, and the
  package's README stops promising the platform's primitives.
- The wizard and the dialog become this package's own components. That is real
  work — a stepper is state plus keyboard plus focus management — and it is
  where an accessibility regression would come from if it is done carelessly.
  Both need component tests before the Quasar version is removed.
- `@saasicat/ui-vue-tenant` stops depending on `@saasicat/ui-vue` for
  primitives; what remains is types and the theme.
- The visual baselines for `tenant-plan`, `tenant-bundles` and
  `tenant-plan-change` will move. They are computed-style recordings, so the
  diff will state exactly what changed rather than showing a picture.

## What breaks if you ignore this

Writing a `q-btn` into a tenant component puts a framework requirement into an
application that did not choose it. The failure is not a broken build in this
repository — everything here has Quasar — but a consumer whose bundle grows by a
UI framework they never installed, or whose account page renders an unstyled
control because they installed Quasar without its stylesheet. Neither is visible
from inside SaaSiCat, and both are reported as "your component does not work".

The second failure is quieter and has already happened once in this package: a
hand-written control beside a Quasar one, each carrying half of the disabled,
focus and keyboard behaviour, with nothing saying which is the pattern. The
package sat at 15 `q-btn` against 17 `<button>` for exactly that reason. Until
the migration is finished, new code in the tenant package writes plain elements
— that is the direction of travel, and the mixed state is the thing being paid
off rather than a licence to add to it.
