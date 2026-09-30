---
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': patch
'@saasicat/core': patch
---

Lift row policies for the platform's cross-tenant work in the Prisma bundle

`prismaPersistence()` created its RLS bypass inline, where no Prisma client
could see it, and the README's recipe for applying it used `$use`, which
Prisma 7 no longer has, and `SET LOCAL row_security = off`, which makes a
filtered query fail rather than lift a policy (`SC-COMP-019`).

- `rlsIntegration: true` now does the lifting. Every statement the bundle's
  adapters run inside the platform's `runWithBypass` — a read, a write, a raw
  statement, and an interactive transaction the runner or a repository opens —
  runs in one transaction with `set_config('app.bypass_rls', 'true', true)`,
  and a policy that accepts that setting beside the tenant lets it through.
  The setting ends with the transaction. The README gives the policy.
- A statement that enters the bypass inside a transaction opened outside it is
  refused with an error, since the setting would outlast the bypass there.
- `PrismaRlsBypass` is the building block: pass one as `rlsIntegration` to name
  another setting, or to run statements of your own through the same port with
  `bypass.extend(prisma)`.
- `runWithBypass` in both shipped ports awaits the work inside the frame. A
  query builder's promise runs when it is awaited, so a query handed back
  unawaited ran after the frame had closed — outside the bypass.
- The Drizzle bundle does not lift a policy, and its documentation no longer
  says `row_security = off` would: with row policies, bind an `RlsBypassPort`
  of your own there.

**If you set `rlsIntegration: true` with a middleware of your own**, remove the
middleware — the bundle now lifts the policy itself, for the platform's
statements — and give your policies the `app.bypass_rls` clause. An
installation with a bypass of its own, over its own tenant context, binds its
`RlsBypassPort` in `adapters` and leaves `rlsIntegration` out.
