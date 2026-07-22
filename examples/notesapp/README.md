# notesapp — SaaSiCat reference implementation

A deliberately small, **runnable** multi-tenant NestJS app that follows the
[quickstart](../../docs/quickstart.md) end to end: two plans in
`config/saas.yaml`, one quota provider, the four platform decorators, the
`prismaPersistence()` bundle — and automatic feature/quota enforcement with
zero platform code inside the handlers.

What it demonstrates:

| Concern | Where |
| --- | --- |
| App identity + plans (static path) | [`config/saas.yaml`](config/saas.yaml) |
| Canonical platform tables next to app tables | [`prisma/schema.prisma`](prisma/schema.prisma) (fragments 04/06/10) |
| One-line persistence wiring | [`src/app.module.ts`](src/app.module.ts) — `prismaPersistence({ client, passwordHasher })` |
| Countable quota declaration | [`src/saas/notes-quota.provider.ts`](src/saas/notes-quota.provider.ts) — `@DefinesQuota` |
| Enforcement decorators | [`src/notes/notes.controller.ts`](src/notes/notes.controller.ts) — `@ImplementsCapability`, `@RequireFeature`, `@EnforceQuota` |
| 402 quota responses | `LimitExceededFilter` as `APP_FILTER` in `app.module.ts` |
| Auth ordering (global guard!) | [`src/auth/demo-auth.guard.ts`](src/auth/demo-auth.guard.ts) + `DemoAuthModule` |
| DB-free platform test | [`tests/notesapp-smoke.test.js`](tests/notesapp-smoke.test.js) |

> **Demo auth:** the app identifies callers from an `x-demo-tenant` header —
> obviously NOT authentication. Swap `DemoAuthGuard` for your JWT guard; it
> must stay a **global** guard registered before `SaasPlatformModule`
> (the platform's feature guard and quota interceptor read `request.user`).

## Run it

```bash
# from the repo root
pnpm install
pnpm --filter "notesapp-example..." build

# disposable database
docker run --rm -d --name notesapp-pg -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:16

cd examples/notesapp
cp .env.example .env
export DATABASE_URL=postgresql://postgres:test@localhost:5432/postgres
pnpm run db:push     # apply prisma/schema.prisma
pnpm run db:seed     # demo tenants: tenant-a, tenant-b
pnpm start           # http://localhost:3000/api/v1
```

## Walkthrough (verified responses)

```bash
BASE=http://localhost:3000/api/v1
A='-H "x-demo-tenant: tenant-a"'

# 1. What does my plan allow? (STARTER: NOTES, notesMax=25)
curl -s $BASE/tenant/manifest -H 'x-demo-tenant: tenant-a' | jq '{planId, features, quotas}'

# 2. Create notes — the 26th one hits the quota:
for i in $(seq 1 26); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/notes \
       -H 'x-demo-tenant: tenant-a' -H 'content-type: application/json' \
       -d "{\"title\":\"note $i\"}"
done
# → 25× 201, then 402:
# {"statusCode":402,"error":"PaymentRequired","reason":"LIMIT_EXCEEDED",
#  "dimension":"notesMax","used":25,"max":25,...}

# 3. Feature gate — export is a PRO feature:
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/notes/export \
     -H 'x-demo-tenant: tenant-a'          # → 403 (STARTER)

# 4. Tenants are isolated — tenant-b starts at 0/25:
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/notes \
     -H 'x-demo-tenant: tenant-b' -H 'content-type: application/json' \
     -d '{"title":"b1"}'                   # → 201

# 5. No auth → 401; SuperAdmin surface:
curl -s -o /dev/null -w '%{http_code}\n' $BASE/notes            # → 401
curl -s $BASE/admin/manifest -H 'x-demo-tenant: admin' \
     -H 'x-demo-role: SUPER_ADMIN' | jq '.project.key'          # → "notesapp"

# 6. Discovery found the code-declared capabilities at boot:
jq '[.capabilities[].capabilityKey]' var/discovery-snapshot.json
# → ["notes.create", "notes.export"]
```

## Where to go from here

- **SuperAdmin UI:** `pnpm create saasicat-admin admin --project-key=notesapp`
  scaffolds the Vue admin against `/api/v1/admin` (quickstart step 9).
- **Real plans per tenant (V3 contracts):** add fragments `01`/`03` +
  `sql/constraints.postgres.sql`, set `entitlement: {}` — the bundle already
  ships the repositories, verified by `@saasicat/persistence-testing`.
- **Drizzle instead of Prisma:** swap the bundle for
  `drizzlePersistence({ db })` from `@saasicat/adapter-drizzle` — same
  slices, same verified semantics.
- Inside this monorepo the example uses `workspace:^` versions; in your own
  app install the published `@saasicat/*` packages instead.
