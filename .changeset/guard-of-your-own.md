---
'@saasicat/nest': patch
---

**Correction to the 1.0.0-rc.0 notes on the enforcement-chain check.** They said neither known
consumer was affected because every `@RequireFeature` sat in a file that also binds a feature
guard. One consumer binds a feature guard of its own — a class that enforces the annotation
through `EntitlementService` but is not the platform's — and the check recognises a guard only
by `FEATURE_GUARD_MARKER`, so that application stopped booting with "63 annotated route(s) have
no feature guard in front of them". The way out was already in the message and is now in
[`docs/guides/upgrade-to-1.0.md`](https://github.com/uelker70/saasicat/blob/main/docs/guides/upgrade-to-1.0.md):
put `static readonly [FEATURE_GUARD_MARKER] = true` on a guard that really enforces
`@RequireFeature`, or set `enforcementChainCheck: false` for a guard bound as a global `APP_GUARD`.
