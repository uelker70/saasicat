---
'@saasicat/core': major
---

**`@saasicat/types` is `@saasicat/core`.** The package always carried the pure domain logic both
sides run — the error-code catalogues and their texts, `classifyPlanDiff`, the promo arithmetic,
the feature-requires rules — and a package named "types" gave a reader no reason to look for a
function in it. Pricing and proration are planned to consolidate here next.

Every import moves as-is: `from '@saasicat/types'` becomes `from '@saasicat/core'`, and
`npx @saasicat/cli@latest codemod v1 --dir=.` rewrites it along with the rest of the 1.0 rename.
`@saasicat/types` stays on npm for the 0.x line and gets no 1.0.
