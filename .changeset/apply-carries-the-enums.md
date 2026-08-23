---
'@saasicat/cli': patch
'@saasicat/nest': patch
'@saasicat/adapter-prisma': patch
'@saasicat/adapter-drizzle': patch
'@saasicat/ui-vue': patch
'@saasicat/persistence-testing': patch
---

**`saasicat schema apply` now appends the enums a fragment declares, above the models that use
them.** It used to copy models only, so a fresh schema ended up with `Subscription.billingCycle`
and no `BillingCycle` — twenty Prisma validation errors at quickstart step 3 for anyone who had
not pasted the enums in by hand. An enum the schema already declares is left untouched, as models
are. Found by installing the 1.0 candidate from npm into an empty project; the example app had
carried the enums since before the command existed, so nothing in the repository saw the gap.

**Every package with an exports map now exports `./package.json`.** Seven did not, and a bundler
plugin, `vue-tsc` or pnpm reading the manifest got `ERR_PACKAGE_PATH_NOT_EXPORTED`.
