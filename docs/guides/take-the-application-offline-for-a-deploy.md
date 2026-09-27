# Take the application offline for a deploy

Most deploys need no downtime. Add what the new version needs, switch to it, and remove what the
old one needed in a later deploy: expand and contract. Nothing races, and the previous image stays
a valid rollback.

Two kinds of migration do not fit that pattern, and this guide is for them:

- **A migration that transforms data.** A backfill, a renumbering or a move of rows must not see a
  write from either version while it runs.
- **A migration that removes something.** It drops or renames what the version still running
  reads. Between the migration and the switch, that version answers from a schema it does not
  know.

For these you announce a **maintenance window** to the tenants, **lock** the application for the
length of the deploy, and **unlock** once the new version is healthy. While the lock holds, every
tenant request gets `503` with the code `MAINTENANCE`. Everything below is what an integrator
wires once and what an operator does on the day.

## What the lock does, and where it stops

Every request is refused with `503`, the code `MAINTENANCE`, a `Retry-After` header and the
announced end. The refusal happens in a global guard that SaaSiCat registers ahead of its own
feature guard, so a refused request has read nothing but the lock. Four things get through:

- the administration, so the operator who locked the application can come back and unlock it;
- `GET /public/maintenance`, the status a tenant's page reads;
- a route the application marks with `@AllowDuringMaintenance()`, such as a health probe;
- a platform administrator whose sign-in the application has already established. This lets the
  operator try the new version before letting tenants in.

A payment provider's callback is refused like any other request. The provider retries it once the
lock is gone, so no write races the migration.

The lock begins and ends only on command: from the deploy script, the command line or the
administration. The announced times are what tenants are told and what `Retry-After` says. A lock
that runs past its announced end tells tenants it is taking longer than announced. It does not let
them back onto a half-migrated schema.

Where it stops:

- The command line does not go through HTTP and is not held.
- A guard the application registered globally _before_ SaaSiCat's runs first. An authentication
  guard that reads its session from the database still does so for a refused request.
- A version that starts inside the window runs its own start-up as usual.

## Wire it once

1. **The table.** Add `MaintenanceWindow` from `@saasicat/spec/prisma-fragments/16-maintenance-window.prisma`
   and run `@saasicat/spec/sql/1.0-maintenance-windows-are-kept.postgres.sql` once, before
   `db push` where you use one. The file creates the partial unique index that allows at most one
   open window; `db push` does not know that index, so apply `constraints.postgres.sql` after it,
   as `examples/notesapp/docker-entrypoint.sh` does.
2. **The module.** Set `maintenance: true` in `SaaSiCatModule.forRoot`. Both shipped adapters
   provide `persistence.core.maintenanceWindows`. With another persistence, pass
   `maintenance: { windows }`.
3. **The routes that must answer.** Mark the health and readiness probes with
   `@AllowDuringMaintenance()` from `@saasicat/nest`. Otherwise the lock answers `503` there too,
   and the deploy's health gate never sees the new version come up.
4. **Your own scheduled jobs.** Inject `MaintenanceService` and skip the run while
   `await maintenance.isLocked()` is true. SaaSiCat's own two jobs already do. A skipped run is
   caught up by the next one.
5. **The tenant's pages.** Wrap the whole application — the sign-in page included — in
   `MaintenanceGate` from `@saasicat/ui-vue-tenant`, and hand every refused response to
   `reportMaintenanceRefusal(status, body)` from `@saasicat/ui-vue`:

    ```vue
    <template>
        <MaintenanceGate :http="platformHttp" api-base="/api/v1">
            <router-view />
        </MaintenanceGate>
    </template>
    ```

    ```ts
    api.interceptors.response.use(undefined, (error) => {
        if (error.response) reportMaintenanceRefusal(error.response.status, error.response.data);
        return Promise.reject(error);
    });
    ```

    Tenants see an announced window above the application. While the lock holds they see one
    maintenance page instead of failing actions, and a request the lock refused is reported as not
    carried out. Once the lock is lifted the application comes back on the screen they were on,
    loaded afresh. Input they had not sent when the lock began is not kept — the application is
    unmounted under the lock, so that nothing of it stays above the maintenance page — which is
    what the announcement ahead of the window is for.

6. **The command line.** Register `MaintenanceCommands`, its six sub-commands and
   `MaintenanceCliFlow` from `@saasicat/cli` in your CLI module (see
   [Extend your CLI](extend-your-cli.md)).
7. **Mail, if you want it.** Bind a `MaintenanceNotificationPort` as `maintenance.notifications`.
   It is called when a window is announced, moved or cancelled, and it writes to your users in
   your own words, from your own sender, in their language. The operator does not wait on it, and
   a failure is logged; the window stands either way.

**Deploy this once, normally, before you need it.** The lock protects only a deploy whose running
version already reads it.

## On the day

Announce the window in the administration (**Maintenance** in the sidebar), or from the command
line. Times always carry their zone:

```bash
myapp maintenance announce --starts 2026-10-02T22:00+02:00 --ends 2026-10-02T23:00+02:00 \
    --message "Upgrade to 2.3" --yes
```

The deploy script then does the rest. What matters is the order:

```bash
myapp maintenance on --until 2026-10-02T23:00+02:00 --yes   # returns once every process sees it
pg_dump ... > before-2.3.sql                                # a backup that holds the lock too
<run the migrations>
<start the new version and wait for its health check>
myapp maintenance off --yes
```

`maintenance on` returns only after every process has had time to see the lock, plus a grace for
requests already under way (`--drain <seconds>`, default 10). The migration therefore runs alone.
Locking what is already locked, and unlocking what is not, report the state that holds and change
nothing, so a retried script is safe.

The command line asks for the operator's identity (the environment variable your CLI names, or
`--as`) and, against production, the confirmation `--yes` gives. It asks for no second factor,
because a script has nobody to type one. The administration's lock and unlock buttons ask for a
confirmation and the second factor. Every step is in the audit log.

If the deploy fails, restore the backup. It was taken inside the window, so it restores with the
lock on, and tenants stay out until you unlock.

A lock nobody lifted is reported in two places: on every page of the administration, which says so
louder once the announced end has passed, and by `myapp doctor`.
