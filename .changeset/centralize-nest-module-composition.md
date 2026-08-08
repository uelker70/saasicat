---
'@saasicat/nest': minor
---

`SaaSiCatModule.forRoot()` can now compose the complete standard NestJS
platform stack, including setup, admin statistics, checkout offers and
subscription contracts.

Standard repositories are derived from the shared persistence bundle where
possible, while application-specific providers, imports and guards remain
configurable. The high-level module and its typed configuration helper are
available from both `@saasicat/nest` and `@saasicat/nest/platform`; fine-grained
modules remain available as escape hatches.
