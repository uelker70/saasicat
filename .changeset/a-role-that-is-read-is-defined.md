---
'@saasicat/ui-vue-tenant': patch
---

Two tenant notice boxes get their corners back

`TenantPlanSection`'s late-notice warning and `PlanChangeWizard`'s deferral
block both read `var(--sa-radius-md)`. The theme's radius ladder is named by
role rather than by size and has no `-md` step, and an undefined custom
property makes CSS drop the declaration around it — so both elements rendered
with square corners beside five sibling notice boxes that were rounded. They
read `--sa-radius-badge` now, the step every other tone-surface block in the
package already used.

Nothing in this repository resolved those variables: the package ships its
source, so the declarations are compiled by the consumer's bundler against the
roles their copy of `@saasicat/ui-vue/theme.css` defines. A repository test now
compares the roles the package reads against the roles that theme entry
declares, and fails on a read with neither a definition nor a fallback.
