---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

The platform records the configuration it applied

`config/saas.yaml` says what should be true. Until now nothing said what IS
true, and somebody who edited the file an hour ago had no way to tell whether
it had landed. At every start the platform now records the settings it applied
— everything in the file but the plans and the features, with the environment
references resolved — together with a `sha256-…` fingerprint over them, the
moment they took effect and the file they came from.

Three states, and almost every start is the middle one: no record → written;
same fingerprint → nothing happens, and `appliedAt` keeps saying when these
values took effect; different → the record is replaced and the difference is
written down, leaf by leaf with both values, in `settings_changes`. The
fingerprint covers the settings and not the catalogue, so a plan added to the
file is not a configuration change — and it covers the resolved values, so a
production variable that moved the notice period is one.

**The record is a mirror, never a source.** Nothing reads a setting out of it;
a record that disagrees with the file changes nothing about what runs, and a
test holds the port to the module that writes it and the endpoint that shows
it. `GET /admin/settings` is that endpoint: the running settings, their
fingerprint and source, `appliedAt` where the record matches what is running,
and the recent changes with what moved.

**Two tables, one migration.** `applied_settings` holds one row — the
installation's, held to one by a `CHECK` rather than by convention — and
`settings_changes` one row per start that noticed a change. Run
`sql/1.0-the-applied-settings-are-recorded.postgres.sql` once, before
`db push` where you use one; it is safe to run again and does nothing on a
database created from the reference schema. On the Prisma path, copy the two
models from `prisma-fragments/12-applied-settings.prisma`.

`AppliedSettingsPort` is a new port in `@saasicat/core`, served by both
`prismaPersistence()` and `drizzlePersistence()` as `core.appliedSettings` and
held to the same executable contract. It is optional in the bundle: a
persistence adapter written before it existed still starts, and the platform
says once, at boot, that it is not recording. `SaaSiCatAdapters.appliedSettings`
overrides the bundle's slice like the other core ports.

`loadPlanCatalogFromFile` now remembers the absolute path it read a catalogue
from — `catalogSource(catalog)` returns it — which is what the record names as
the source. A catalogue handed in as an object, or through `dbCatalog`, is
recorded as coming from code, not from a path the platform did not read.

`@saasicat/core` also gains `settingsSubtreeOf`, `canonicalJson` and
`diffSettings`, the pure functions behind the fingerprint and the difference.
