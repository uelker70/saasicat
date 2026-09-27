---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/cli': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

An operator announces a maintenance window and locks the application for a
deploy

For a migration that transforms data or removes what the running version
reads, an operator announces a window to the tenants, locks the application
for the length of the deploy, and unlocks once the new version is healthy
(`SC-OPS-012` to `SC-OPS-015`). Optional: `maintenance: true` in
`SaaSiCatModule.forRoot`.

- While the lock holds, every tenant request is refused with `503`, the code
  `MAINTENANCE`, a `Retry-After` and the announced end, by a global guard
  registered ahead of the feature guard. The administration, the status route
  `GET /public/maintenance`, routes marked `@AllowDuringMaintenance()` and a
  signed-in platform administrator pass; payment callbacks are refused and
  retried by the provider. SaaSiCat's two scheduled jobs skip their run, and
  `MaintenanceService.isLocked()` is what an application's own jobs ask.
- The lock begins and ends only on command. The announced times are what
  tenants are told; a lock past its end says it is taking longer. Locking what
  is locked and unlocking what is not change nothing and say so.
- `maintenance_windows` keeps one row per window, at most one open, in both
  shipped adapters (`persistence.core.maintenanceWindows`), with the Prisma
  fragment `16-maintenance-window.prisma` and the migration
  `1.0-maintenance-windows-are-kept.postgres.sql`. The persistence contract
  holds an adapter to it (`maintenanceWindows`).
- The administration gains a **Maintenance** page, and a strip on every page
  while tenants are locked out. Locking and unlocking there need a
  confirmation and the second factor (`SC-ADM-029`, `SC-ADM-030`).
- `@saasicat/cli` adds `maintenance status|announce|reschedule|cancel|on|off`
  — `on` returns once every process has had time to see the lock — and a
  `doctor` check that reports a lock and a lapsed announcement.
- `@saasicat/ui-vue-tenant` adds `MaintenanceGate`: the announcement above the
  application and its sign-in page, one maintenance page while the lock holds,
  and the application again once it is lifted (`SC-UI-026`).
  `reportMaintenanceRefusal` switches it at once from an HTTP interceptor.
- An optional `MaintenanceNotificationPort` hears of a window announced, moved
  or cancelled, so the application can mail its users.
