# notesapp — SaaSiCat reference implementation

A deliberately small, **runnable** multi-tenant NestJS app that follows the
[quickstart](../../docs/quickstart.md) through the full product loop:

```text
Capability → Discovery → Packaging → Contract → Enforcement
```

It declares note creation and export in code, discovers both at boot,
packages them as Starter and Pro, and verifies feature and quota enforcement
with no platform logic inside the handlers. The high-level `SaaSiCatModule`
keeps the integration in one place.

What it demonstrates:

| Concern                                      | Where                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App identity + plans (static path)           | [`config/saas.yaml`](config/saas.yaml)                                                                                                                                      |
| Canonical platform tables next to app tables | [`prisma/schema.prisma`](prisma/schema.prisma) (fragments 04/06/10)                                                                                                         |
| Standard platform wiring                     | [`src/saasicat.config.ts`](src/saasicat.config.ts) — the options of one `SaaSiCatModule.forRoot(...)`, shared by the app and its CLI                                        |
| Countable quota declaration                  | [`src/saas/notes-quota.provider.ts`](src/saas/notes-quota.provider.ts) — `@DefinesQuota`                                                                                    |
| Enforcement decorators                       | [`src/notes/notes.controller.ts`](src/notes/notes.controller.ts) — `@ImplementsCapability`, `@RequireFeature`, `@EnforceQuota`                                              |
| Full standard Admin backend                  | `adminResources: true` + `promoCodes: true` in [`src/saasicat.config.ts`](src/saasicat.config.ts)                                                                           |
| Full SuperAdmin UI                           | [`admin/src/pages`](admin/src/pages) — discovery, catalog, plans, bundles, tenants, users, audit, subscriptions and promos                                                  |
| 402 quota responses                          | `LimitExceededFilter` as `APP_FILTER` in `app.module.ts`                                                                                                                    |
| Auth ordering (global guard!)                | [`src/auth/demo-auth.guard.ts`](src/auth/demo-auth.guard.ts) + `DemoAuthModule`                                                                                             |
| Contracts and invoices                       | `tenantBilling.contractFreeze` and `chargeJournal` in [`src/saasicat.config.ts`](src/saasicat.config.ts), `invoicing` and `terms` in [`config/saas.yaml`](config/saas.yaml) |
| Operator command line                        | [`src/cli`](src/cli) — `installation status`, `installation mark`, `doctor`                                                                                                 |
| DB-free platform test                        | [`tests/notesapp-smoke.test.mjs`](tests/notesapp-smoke.test.mjs)                                                                                                            |

> **Demo auth:** the app identifies callers from an `x-demo-tenant` header —
> obviously NOT authentication. Swap `DemoAuthGuard` for your JWT guard; it
> must stay a **global** guard registered before `SaaSiCatModule`
> (the platform's feature guard and quota interceptor read `request.user`).

## Run it with Docker (database + backend + SuperAdmin UI)

```bash
# from the repo root
docker compose -f examples/notesapp/docker-compose.yml up --build
```

- **SuperAdmin UI** → <http://localhost:9000>, sign in with
  `admin@notesapp.example` / `demo`. Publishing, ending or deleting a plan and
  suspending a tenant ask for a one-time code: the first seed prints an
  `otpauth://` URI to add to an authenticator app
- **Web UI** → <http://localhost:8080> (the tenant-facing app)
- **API** → <http://localhost:3000/api/v1> (for the curl walkthrough below)
- **Postgres** → `localhost:5432` (`notesapp` / `notesapp`)

Every one of these ports is a default you can move: copy `.env.example` to
`.env` and set `ADMIN_HOST_PORT`, `WEB_HOST_PORT`, `BACKEND_HOST_PORT` or
`DB_HOST_PORT`. Only the host side changes — the containers keep their internal
ports, so the admin still reaches the API and no other file needs editing.

The backend container applies `prisma db push` and seeds the demo data on every
start; both are idempotent. The seed writes a subscription only where its tenant
has none, and activates it through the platform — its add-ons, its first
contract, its first charges — as an application does; a subscription that
exists keeps its plan, its add-ons and its contracts. Set `SEED_ON_START=false`
to keep the rest of the data you changed through the UI as well. nginx serves
the admin and proxies `/api` to the backend, so both share an origin and the
backend needs no CORS configuration.

## Run it locally

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
pnpm run db:seed     # demo tenants, SuperAdmin admin@notesapp.example / demo, its otpauth URI
pnpm start           # http://localhost:3000/api/v1

# SuperAdmin UI in a second shell (proxies /api to the backend)
pnpm --filter notesapp-admin dev    # http://localhost:9100
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

## Invoices

A plan change concludes a contract with the tenant's subscriber, and every
quarter of an hour the platform issues what the contracts owe: it numbers the
invoice on the range [`config/saas.yaml`](config/saas.yaml) names under
`invoicing`, renders the ZUGFeRD PDF, archives it in the database, hands it to
the mail port, and confirms the contract with the terms it was concluded
under. Run against the stack, after the walkthrough:

```bash
# tenant-a moves to Pro; the tenant's administrator may change what it pays
curl -s $BASE/billing/plan/preview -H 'x-demo-tenant: tenant-a' \
     -H 'x-demo-role: TENANT_ADMIN' -H 'content-type: application/json' \
     -d '{"plan":"PRO","billingCycle":"YEARLY"}' | jq -r .target.planVersionId
curl -s $BASE/billing/plan -H 'x-demo-tenant: tenant-a' \
     -H 'x-demo-role: TENANT_ADMIN' -H 'content-type: application/json' \
     -d '{"plan":"PRO","billingCycle":"YEARLY","planVersionId":"<the id above>"}'
# → {"plan":"PRO","billingCycle":"YEARLY","immediate":true}

# at the next quarter hour the backend logs
#   Invoice NOTES-2026-000001 to the invoice email of subscriber …, attaching NOTES-2026-000001.pdf (… bytes).
curl -s $BASE/admin/invoices -H 'x-demo-tenant: admin' \
     -H 'x-demo-role: SUPER_ADMIN' | jq '.invoices[].number'   # → "NOTES-2026-000001"
```

The SuperAdmin UI shows it under Invoices, with the subscriber's record, the
contracts, the open items and the reconciliation beside it; the tenant sees it
on the billing page of the web UI.

What stands as it is: the numbers, the documents, the archive and every record
the platform keeps. What a real application replaces:

- **The mail port.** [`src/saas/notes-invoice-mail-log.ts`](src/saas/notes-invoice-mail-log.ts)
  writes a line to the log — never the address, never the file — where a real
  application sends the invoice by e-mail.
- **The payment gateway.** `DevPaymentGateway` confirms every payment method
  on the spot and moves no money. A real application binds its provider's
  gateway, such as `@saasicat/payment-stripe`, and names its account in
  `config/saas.yaml#payments`.
- **The issuer and the terms.** `issuer` in `config/saas.yaml` and
  [`config/terms-2026-11.pdf`](config/terms-2026-11.pdf) are an example
  company's; the platform archives the terms file at every start.

## Mark the installation

A tenant's data is deleted only from a database marked as the installation of
the environment the process runs in (`SAASICAT_INSTALLATION`), and nothing
marks it on its own. The notes app's command line, [`src/cli`](src/cli), does
that and nothing else: it registers the platform's `installation` and `doctor`
commands, and starts the platform from the application's own options
([`src/saasicat.config.ts`](src/saasicat.config.ts)) and environment, so it
marks the database the application serves. The `bin` entry in `package.json`
names it `notesapp`, the way an installed application exposes its command.
[Extend your CLI](../../docs/guides/extend-your-cli.md) lists every other
command an application can register.

```bash
# in the compose stack, from the repo root
docker compose -f examples/notesapp/docker-compose.yml exec backend \
    node dist/cli/main.js installation status
docker compose -f examples/notesapp/docker-compose.yml exec backend \
    node dist/cli/main.js installation mark notesapp-compose --as admin@notesapp.example

# locally, from examples/notesapp, in the environment `pnpm start` runs in
pnpm run cli installation status
pnpm run cli installation mark notesapp-local --as admin@notesapp.example
pnpm run cli doctor --as admin@notesapp.example
```

- `installation status` says whether the database carries this environment's
  mark. It only reads, and asks for nobody.
- `installation mark <identifier>` writes the mark, for the environment's own
  `SAASICAT_INSTALLATION` only. It acts as a SuperAdmin (`--as`, or
  `NOTESAPP_ADMIN_EMAIL`) and asks for that SuperAdmin's one-time code, so the
  second factor has to be set up already. Here the seed sets it up for
  `admin@notesapp.example` and prints its `otpauth://` URI on the first run. A
  real application's operators enrol with `admin mfa-setup`, which this command
  line leaves out.
- `doctor` runs the platform's checks as a SuperAdmin, the installation's mark
  among them.

`NOTESAPP_SKIP_MFA=1` skips the one-time code unless `NOTESAPP_ENV=production`,
for a scripted demo; an installation that holds real data does not set it.

## Why `src/saas` is still there

The standard module removed the former catalog module, billing module, plan
resolver, subscription/usage forwarding ports and the 471-line Admin resource
service. The remaining 164 lines are NotesApp decisions: its quota counter,
feature labels and three dashboard KPIs.

No Admin feature was removed to get there. The demo still exposes discovery,
plans, bundles, the marketing catalog, tenants with detail and
suspend/reactivate actions, users, audit, subscriptions and promo-code CRUD.
Their standard backend now comes from SaaSiCat; the small Vue wrappers only add
NotesApp labels, columns and plan choices.

## Where to go from here

- **SuperAdmin UI:** already scaffolded in [`admin/`](admin/) via
  `pnpm create saasicat-admin admin --app-key=notesapp` (quickstart step 9).
  Its `services/http.ts` sends this example's demo auth headers instead of a
  bearer token — swap it for your auth backend.
- **Real payment collection:** keep the current contract and entitlement
  model, and swap the development gateway for your provider's (see
  [Invoices](#invoices)); product capabilities and quota logic stay out of the
  provider integration.
- **Drizzle instead of Prisma:** swap the bundle for
  `drizzlePersistence({ db })` from `@saasicat/adapter-drizzle` for the core
  slices. Catalog and tenant-billing adapters are not bundled there yet, so
  wire those low-level modules explicitly.
- Inside this monorepo the example uses `workspace:^` versions; in your own
  app install the published `@saasicat/*` packages instead.
