---
'@saasicat/ui-vue-tenant': minor
'@saasicat/ui-vue': minor
---

The tenant components no longer need a UI framework

`@saasicat/ui-vue-tenant` renders inside your application, so it stopped deciding
what your application is built from. `quasar` is gone from its peer
dependencies; the plan section, the plan-change wizard, the bundle store and the
package snapshot are plain elements on the theme's CSS custom properties. If you
installed Quasar only to embed a plan section, it can go — with
`@quasar/vite-plugin` and the Sass setup beside it.

Breaking for anyone who styled around the old markup or rendered the inner
components directly: the `q-*` class names are gone, `TenantPlanCardHeader` takes
`statusTone` instead of `statusColor`, and the feature matrix hands the
registry's icon to a `#feature-icon` slot rather than drawing a Quasar icon name
that needed Quasar's icon font. `docs/guides/upgrade-to-1.0.md` has the details.

Two composables are new in `@saasicat/ui-vue`, both framework-free and both
usable outside the tenant package: `useDialog` (focus trap, focus return,
escape, `aria-modal`, `aria-labelledby`, scroll lock, settable teleport target)
and `useSteps` (a linear wizard's position, its guard, and moving focus to the
new step's heading). `bindSaThemeAttribute` joins them: it writes the one
attribute the role tokens key off, so an app can follow the OS theme without
installing Quasar for it.
