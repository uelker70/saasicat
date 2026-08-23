---
'@saasicat/cli': patch
'@saasicat/nest': patch
'@saasicat/adapter-prisma': patch
'@saasicat/adapter-drizzle': patch
'@saasicat/ui-vue': patch
'@saasicat/persistence-testing': patch
'create-saasicat-admin': patch
---

**`saasicat schema apply` now appends the enums a fragment declares, above the models that use
them.** It used to copy models only, so a fresh schema ended up with `Subscription.billingCycle`
and no `BillingCycle` — twenty Prisma validation errors at quickstart step 3 for anyone who had
not pasted the enums in by hand. An enum the schema already declares is left untouched, as models
are. Found by installing the 1.0 candidate from npm into an empty project; the example app had
carried the enums since before the command existed, so nothing in the repository saw the gap.

**Every package with an exports map now exports `./package.json`.** Seven did not, and a bundler
plugin, `vue-tsc` or pnpm reading the manifest got `ERR_PACKAGE_PATH_NOT_EXPORTED`.
**`saasicat init` names two more things the generated wiring needs.** The `forRoot` block now
carries `imports: [YourPrismaModule, YourAuthModule]` the way it carries `YourAuthGuard` — it does
not compile until you name them — because `prismaPersistence({ client: PrismaService })` is
resolved inside the platform module, which sees only what that list holds or what is `@Global`.
Left out, the generated app compiled and stopped on its first boot with "Nest can't resolve
dependencies of … (PrismaService)". And `init` now refuses a `tsconfig.json` whose
`moduleResolution` is `node`: the files it writes import subpath exports, which only `node16`,
`nodenext` or `bundler` resolve. The quickstart says so too.

**`create-saasicat-admin` scaffolds an app that type-checks.** Its `platform-loaders.ts` still
passed `getAuthToken` to `createPlatformLoaders`, an option the 1.0 line no longer has, so every
fresh admin failed `vue-tsc` on its first run. The scaffolder's tests now type-check a scaffolded
app against the `@saasicat/ui-vue` it was scaffolded for.
