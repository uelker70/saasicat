---
'@saasicat/nest': patch
---

Recognise the platform's feature guards by marker rather than by class name

`FeatureGuard` is a name any application might use for a guard of its own, and
the coverage check added in 0.22.1 matched on it — so a same-named foreign
guard silenced the warning while nothing enforced the entitlement. Both
platform guards now carry a `Symbol.for` marker, which survives the duplicate
class identity across CJS entry points that made name matching tempting in the
first place.

The check also treated controller helper methods as routes: a class-level
`@RequireFeature` is inherited by all of them, so with guards bound per handler
the helpers looked open while every real endpoint was covered. Only methods
carrying Nest's route metadata are considered now.
