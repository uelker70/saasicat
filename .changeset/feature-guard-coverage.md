---
'@saasicat/nest': patch
---

Stop warning about `globalFeatureGuard` at applications that have nothing open

The warning added in 0.22.0 fired on the option alone, from `forRoot()` — where
no controller exists yet, so it could only read the setting back. It therefore
told every application using the per-controller guard pattern that it "serves
unlicensed traffic", including the two that bind a guard on all of their
annotated routes (22 of 22 and 18 of 18, counted). A warning that fires on a
correct configuration is worse than none: it teaches people to scroll past
warnings, including the ones that mean something.

The question is now asked where it can be answered. `FeatureGuardCoverageCheck`
runs after bootstrap, walks the controllers, and warns only about routes that
carry `@RequireFeature` with no feature guard in front of them — naming each
one. Silence means "checked, nothing open" rather than "did not look".

A guard of your own that wraps `FeatureGuard`/`StaticFeatureGuard` is not
recognised, and its routes are listed; the message says so. Naming a covered
route costs a moment to verify, whereas staying silent about an open one is not
recoverable.
