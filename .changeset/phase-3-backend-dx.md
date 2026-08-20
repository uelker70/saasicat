---
'@saasicat/nest': minor
'@saasicat/cli': minor
'@saasicat/adapter-prisma': minor
'@saasicat/ui-vue': minor
'@saasicat/types': minor
---

Backend integration: a generator, a boot that refuses a broken licence chain,
and configuration errors that arrive all at once.

**`saasicat init`** scaffolds the platform wiring — app config, persistence
bundle, feature-UI registry, manifest contribution, admin module, one provider
per `--quota=key:Model`, a password hasher — and adds
`SaaSiCatModule.forRoot(...)` to an existing `src/app.module.ts`. What was
thirteen files to create by hand is now none: what stays yours is what each
quota counts, the hasher if scrypt is not enough, and your auth guard. The
command prints all three as next steps and refuses to overwrite an existing
file.

**A broken enforcement chain no longer boots.** `@RequireFeature` and
`@EnforceQuota` with nothing able to resolve a tenant to a plan used to be
silent — the routes answered, the quotas read as unlimited, and the first signal
was a customer using something they never bought. `EnforcementChainCheck` now
refuses the boot, after bootstrap where the annotated routes are visible, and
names them. Same for `globalFeatureGuard: false` with a route that has no
feature guard in front of it. An application with no annotations at all still
boots: a catalogue without enforcement is a real shape.

**Breaking:** an application in either of those states will stop starting.
Neither known consumer is affected — every `@RequireFeature` in both sits in a
file that also binds a feature guard. `FeatureGuardCoverageCheck` is renamed to
`EnforcementChainCheck`.

**Configuration problems arrive together.** The fifteen checks in `forRoot` are
a rule table now: a misconfigured application gets the complete numbered list on
the first boot, each entry with its rule id and a link to
`docs/reference/options.md` — which is generated from that table. Five missing
bindings used to cost five restarts.

**`saasicat schema migrate`** appends the constraints Prisma's DSL cannot
express to the migration it just produced, instead of asking you to paste them
in. And `schema apply`/`schema migrate` take `--tenant-model` / `--user-model`
to enable the foreign keys from the platform tables to your own models; a name
your schema does not declare is refused, with the list of names it does.

**`PrismaAdminResourcesAdapter` takes a mapping.** `adminResources: { delegates:
{ tenant: 'organization' }, fields: { tenant: { isActive: 'enabled' } } }` — an
application whose models are named differently no longer has to set
`adminResources: false` and lose every SuperAdmin endpoint. A mapped delegate
the client does not have fails at construction and lists the ones it does. The
shape is still the boundary: an m:n tenant/user relation implements
`AdminResourcesPort` itself.

**`@saasicat/ui-vue`** completes the resource descriptors: bundles, bundle
versions, catalogue entries, discovery, marketing, promo codes, promotions,
users, subscriptions, and the by-slug tenant operations — 13 descriptors over 54
operations, each held to the same request as the composable or admin client it
mirrors.

Internal: `saas-platform.module.ts` is 244 lines instead of 1,240, with one
composer file per feature; two redundant port barrels are gone from
`@saasicat/types`; and ESLint now enforces the nest domain boundaries with no
exemptions.
