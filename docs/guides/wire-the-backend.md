# Wire the backend

The long form of the backend half of the [quickstart](../quickstart.md): what
the platform needs from your NestJS application, and what each option in
`defineSaaSiCat` decides. Work through it once; afterwards
[the options reference](../reference/options.md) is the faster lookup.

- **Node.js 24+**, **pnpm 10+**.
- **NestJS 11+** with Fastify or Express adapter.
- **PostgreSQL** (the platform is PostgreSQL-first: transactions, row locks
  and optional RLS are part of the persistence contract — see
  [data model](../explanation/data-model.md)). The ready-made adapter package is
  `@saasicat/adapter-prisma` (Prisma 6) or `@saasicat/adapter-drizzle`
  (drizzle-orm, driver-independent); other ORMs/schemas plug in through
  the same ports and are held to the same semantics by
  `@saasicat/persistence-testing`.
- **Authentication**: JWT-based is recommended; a `JwtAuthGuard` equivalent
  must exist (passed into `controller.guards` of the platform modules). It
  establishes who is calling; the platform adds `SuperAdminGuard` to every
  operator route itself.
- **Vue 3 + Quasar 2** for the admin frontend; Vite as the build tool.

## Installing Packages

```bash
# Backend
pnpm add @saasicat/spec @saasicat/core @saasicat/nest \
         @saasicat/adapter-prisma @saasicat/cli

# Admin frontend
pnpm add @saasicat/core @saasicat/ui-vue
```

For local development against a checkout of this repo, use
`pnpm.overrides` with `link:` paths (not `file:` — see the note below).

> **Important:** `file:` dependencies are **copied** by pnpm into `node_modules/.pnpm/...`,
> not symlinked. After a platform build you have to run `pnpm install` in the consumer
> so the new state is picked up. In the container setup, a
> helper script (e.g. `scripts/ensure-container-deps.cjs`) or a manual
> `pnpm install` in the container helps; afterwards **you must clear the Vite dev cache
> (`.vite/deps`) and restart the admin container**, otherwise Vite serves the
> old bundled version.

## The canonical schema

The data model has one normative source: the
[logical data model](../explanation/data-model.md) plus the SQL artifacts in
[`@saasicat/spec/sql/`](../../packages/spec/sql/)
(`reference-schema.postgres.sql` — full DDL, generated from the fragments;
`constraints.postgres.sql` — the invariants Prisma cannot express: partial
unique draft indexes, the subscription CHECK). The
[Prisma fragments](../../packages/spec/prisma-fragments/) are the
derived Prisma-DSL rendering of that model; `saasicat schema apply`
splices them into your `schema.prisma` (see the [quickstart](../quickstart.md)).
The JSON Schemas in `@saasicat/spec/schemas/` govern **wire formats**, not
tables.

`saasicat schema migrate` runs `apply`, then `prisma migrate dev --create-only`,
appends `constraints.postgres.sql` to the migration that produced, and applies
it — so the invariants Prisma cannot express arrive with the tables rather than
as a step to remember. `--create-only` is what makes that work: an applied
migration cannot take an edit, and Prisma would see its checksum change. It is
idempotent: a migration that already carries them is left alone.

`schema apply` only ever adds: it brings each fragment's enums and models, and
never touches a block you already have. So a field added to an existing model
in a later release does not arrive on its own, and after a package upgrade your
schema falls behind silently. `saasicat schema check` reports that gap:

```bash
pnpm exec saasicat schema check          # exit 1 on drift — gate CI on it
pnpm exec saasicat schema check --fragments=01,03
```

It fails on fields and enum values missing from declarations you **do** carry,
and on type/optionality changes, because platform code reads those with the
spec's type. A model or enum you do not carry at all is reported as
information, not as a failure — not adopting a fragment is a decision. Fields
you added on top of a platform model are never reported: extending them is
supported.

Ownership stays with the app: the platform ships the canonical tables and
constraints, while FK relations to your `Tenant`/`User` models and all RLS
policies remain app-specific (the fragments carry them as commented-out
examples). Canonical `@@map` table names (`subscriptions`, `plan_versions`,
`audit_logs`, `super_admin_users`, …) must not be renamed — the shipped
adapters and CLI commands rely on them.

Whether a schema/adapter combination actually delivers the required
semantics (row locks, atomic promo claims, rollback, tenant isolation) is
verified by the executable contract in `@saasicat/persistence-testing` —
CI runs it for `@saasicat/adapter-prisma` against a real PostgreSQL.

## App-Identity YAML

Create `config/saas.yaml` (schema:
`@saasicat/spec/schemas/plan-catalog.schema.json`). The file carries **only**
the app identity (branding + version) and the app-global marketing config —
source-of-truth separation:

- **App identity** (name, branding, version) → this file.
- **Features / quotas / capabilities** → code (`@ImplementsCapability`,
  `@DefinesQuota`), published via discovery.
- **Plans / bundles** → DB tables `plan` + `catalogPlanVersion` + `bundles`.
  The single source of truth is the SuperAdmin UI alone.

```yaml
schemaVersion: 1
app:
    name: MyApp
    label: MyApp Cockpit
currency: EUR
vatRate: 19.0
tenantBilling:
    cancellationNoticeDays:
        monthly: 0
        yearly: 0
    selfServiceBlockedPlans:
        asTarget: []
        asSource: []
marketing:
    availableLocales: [de, en]
```

`tenantBilling:` is required, member by member — the notice period per rhythm and
the plans self-service may not reach or leave. Both have a money or a legal
consequence, so the file states them rather than defaulting them; see
[the settings section of the upgrade guide](upgrade-to-1.0.md#the-settings-that-cost-money-live-in-configsaasyaml).

> `features:` and `plans:` are still allowed as optional blocks in the schema —
> only for static setups without an admin UI (tests, smoke environments).
> In production they are deliberately NOT maintained in the YAML.

### A value may name an environment variable

One file, wired differently per environment: a value may be written as
`${NAME}`, and the platform resolves it from the environment when it reads the
file.

```yaml
app:
    name: ${APP_NAME}
    version: ${BUILD_NUMBER}
vatRate: ${VAT_RATE:-19.0}
tenantBilling:
    cancellationNoticeDays:
        monthly: ${NOTICE_DAYS_MONTHLY}
        yearly: ${NOTICE_DAYS_YEARLY}
```

What holds, in the order the platform applies it:

- **The reference is resolved before the schema looks.** A variable standing in
  for `monthly` is held to `integer, minimum: 0` like a number typed into the
  file. The resolved text is read as the type the field declares — `14` is the
  integer 14 where the field takes an integer, and `1234` stays the string
  `"1234"` where `version` takes a string.
- **A variable nobody set stops the boot**, naming the variable and the field,
  unless the file declares a default as `${NAME:-value}`. The default also
  applies when the variable is set to nothing.
- **A value that does not fit the field is refused**, never read as `0` or
  `NaN`: `NOTICE_DAYS_MONTHLY=abc` names the variable, the text and the type
  the field takes. The reading is strict — `1.5`, `1e3` and a leading space are
  not integers.
- **A variable named as a credential is refused** — `SECRET`, `TOKEN`,
  `PASSWORD`, a `PRIVATE_KEY`, an `API_KEY` — whether or not it is set. A value
  the file resolves is shown on the login page, quoted in errors and recorded
  as the applied configuration; a secret stays in the environment and is read
  where it is used, which is what options such as `setupTokenEnvVar` carry:
  the name of a variable, not its value.
- **A variable stands in for one value.** Where a field takes a list, write the
  list in the file and refer to a variable per entry.

Two things are YAML's rather than the platform's: inside a flow collection
(`{ … }` or `[ … ]`) a bare `${X}` opens a nested mapping, so quote it there —
`asTarget: ['${ENTERPRISE_PLAN}']` — and a `$` that does not open a
well-formed reference is ordinary text, so `Price $5` needs no escape. There
is no escape the other way: a literal `${NAME}` cannot be written into a value,
and a text that carried one before this existed is now a reference to a
variable of that name.

References are resolved for the installation's own file only. The catalogue
import (`POST /admin/billing/plan-catalog/import`) refuses a document that
carries one: resolving `${DATABASE_URL}` for whoever can post a YAML body would
hand them the server's environment.

## Loading the Plan Catalog at Boot

```ts
// app.module.ts
import { loadPlanCatalogFromFile } from '@saasicat/nest/billing';

const SAAS_CONFIG_PATH = process.env.MYAPP_SAAS_CONFIG_PATH ?? 'config/saas.yaml';
const SAAS_CONFIG = loadPlanCatalogFromFile({ path: SAAS_CONFIG_PATH });
```

`loadPlanCatalogFromFile` resolves the `${NAME}` references against
`process.env` (pass `env` to resolve against something else) and validates the
result against the schema from `@saasicat/spec` — errors throw early at boot,
every one of them at once.

### What the platform records about it

The file says what should be true. At every start the platform records what
_is_ true: the settings it applied — everything in the file but the plans and
the features, with the environment references resolved — a fingerprint over
them, the moment they took effect and the file they came from. A start that
finds the fingerprint unchanged leaves the record alone; one that finds it
moved replaces the record and writes down what changed, leaf by leaf.
`GET /admin/settings` shows all of it, so somebody who edited the file an hour
ago can see whether it has landed.

The record is a mirror, never a source: nothing reads a setting out of it. It
lives in `applied_settings` and `settings_changes`, which `prismaPersistence()`
and `drizzlePersistence()` both serve; a persistence adapter without the
`core.appliedSettings` port still starts, and the boot log says once that
nothing is being recorded.

### Who is told

The people who want to know that a setting moved are not necessarily the ones
who sign in, so the file names them:

```yaml
notifications:
    settingsChanged: [ops@example.com]
```

Each address is mailed what moved — every leaf with both values, the file, and
when the start noticed it — through the email port you bind:

```ts
SaaSiCatModule.forRoot({
    // …
    adapters: { email: MySmtpEmailPort }, // implements EmailPort from @saasicat/core
});
```

`EmailPort` is one method, `send({ to, subject, text })`, and the platform
composes the text. The record in the application is written either way; mail is
the addition, never the substitute. Name addresses and bind no port, and the
boot log says once that they reach nobody. Name nobody, and nothing is said:
in-app only is what an installation of one operator asked for.

The list is itself a setting. When it moves, the mail goes to the old list and
the new one, so an address taken off is told that once instead of going quiet.

A recorded change survives in the administration until somebody acknowledges
it — `POST /admin/settings/changes/{id}/acknowledge`, audited as the operator's
action, keeping its first author when repeated.

## Your Own Side of Every Contract

`issuer:` names the legal entity a contract is concluded with, on your side. A
contract copies it the day it is concluded and keeps that copy for ever, so the
record of what was agreed still names the right party years later:

```yaml
issuer:
    legalName: Example Software GmbH
    addressLine1: Werkstraße 5
    postalCode: '80331'
    city: München
    country: DE
    vatId: DE123456789
    taxNumber: 12/345/67890
```

Everything here is optional except `legalName`, and the block itself is optional
until you invoice: a contract concluded while it is absent records that no issuer
was named. Optional to add, that is — once a start has recorded an identity,
taking the block away again is refused, for the same reason changing it is. The
next section says what to do about both.

### Moving, and being renamed

The two halves of that block behave differently, and the difference is what a
contract names.

**The address and the country are details.** Change them, restart, and the new
ones are what an invoice quotes from that day on — for contracts already running
too. Nothing is declared for them.

**The legal name and the tax identifiers are the party itself.** A contract
names them, and SaaSiCat cannot tell your renamed company from its successor:
both read as a different name in the same file. So a start that finds them
different from the ones it recorded last time refuses, unless the file says the
change is a correction of that same entity:

```yaml
issuer:
    legalName: Example Software AG
    vatId: DE123456789
    correctionOf:
        legalName: Example Software GmbH
        reason: Change of legal form, registered 2026-07-01
```

`correctionOf` names, for every identity field that moves, the value the
installation recorded before it — `null` where it recorded none, which is how a
tax number assigned later is declared:

```yaml
issuer:
    legalName: Example Software GmbH
    taxNumber: 12/345/67890
    correctionOf:
        taxNumber: null
        reason: Assigned by the tax office on 2026-07-01
```

It is needed only for the start that carries the change; once that start has
recorded it, the record holds the corrected identity and a later deploy may drop
the block. Leaving it in changes nothing — and it does not cover the next change
either, because it names an identity the record no longer holds.

"Once that start has recorded it" is the whole condition, and it can fail: the
record is written best-effort, so a start that applied the correction but could
not write its record logs that and carries on. Drop the declaration after such a
start and the next one is refused, because the record still holds the identity
before it. `GET /admin/settings` shows what was recorded; drop the block once it
shows the corrected identity.

What it carries is a reason and not a date: the settings record dates the start
that applied it, and a date typed here would be a second answer to that
question. Where the legal change has a date of its own, put it in the reason, as
above.

A start that cannot square the two says so and stops, naming the contracts still
running and what each of them was concluded under:

```text
The issuer in /app/config/saas.yaml is not the legal entity this installation recorded.
  recorded: 'Example Software GmbH' (VAT id 'DE123456789', tax number none)
  in the file: 'Other Software AG' (VAT id 'DE999999999', tax number none)
`issuer.correctionOf` declares nothing, so nothing says this is the same entity.
3 contract(s) are still running:
  6c1f… (tenant t-17, from 2026-01-01, concluded under 'Example Software GmbH')
  …
Moving a contract to another legal entity is a transfer, not an edit of a setting. …
```

Removing the block once an identity is recorded is refused the same way, and it
is the one shape a declaration cannot rescue: `correctionOf` lives inside the
block, and there is no entity left in the file for it to be about. That refusal
prints the issuer as the installation recorded it, address included, to write
back — replacing the block where one is still there, because a file with two
`issuer:` keys is one YAML refuses to read.

Moving a contract to another legal entity is a transfer, and there is no edit of
a setting that does it. That refusal applies whichever way the identity moves,
so during a rolling deploy an old replica restarting on the previous file is
refused too — which is the point: two replicas concluding contracts under two
different legal entities is what this prevents.

Two things follow from where the comparison happens. It needs the
`core.appliedSettings` port, which both shipped persistence bundles provide;
without it the boot log says once that the issuer is compared with nothing, and
the identity is not guarded. And an installation that has never named an issuer
is naming it for the first time, so it declares nothing.

`<app> doctor` reports the same comparison as `platform.issuer-identity`, and
says while nothing has moved what changing the identity would cost:

```text
✓  Issuer identity against the recorded one: 'Example Software GmbH' is what the
   installation recorded. 142 contract(s) are running, and their issuer copies do
   not follow a change. Changing the legal name or a tax identifier needs
   `issuer.correctionOf` beside the values it replaces; the address and the
   contact details do not.
```

What it does not do is turn a refusal into a report. Your CLI boots the same
application, so a configuration the start refuses refuses the CLI too — with the
refusal shown further up, before any command runs. That is still ahead of the deploy, which
is the point of running it there; it arrives as a failed start rather than as a
✗ line. `IssuerIdentityInspector.inspect()` is the same answer without the hook,
for a health endpoint or a diagnostic of your own.

**Run it on the configuration the installation runs.** Every start records what
it applied, and a CLI process is a start: booting your application against the
production database with a _newer_ `config/saas.yaml` applies that file to the
record, a declared correction included. The running replicas are then on a file
that names the identity before it, and the next one to restart is refused —
before your deploy goes out. This was always how the record worked; what is new
is that the issuer identity has a refusal attached to it. So run `<app> doctor`
and one-off commands with the file the installation is running, and let the
deploy be what carries a changed one.

## Standard Persistence Bundle (Prisma)

On the canonical schema, do not write one forwarding provider per repository.
`prismaPersistence()` already supplies the standard slices:

- core admin persistence, audit, MFA, RLS bypass and transactions;
- subscriptions, plan versions, contracts and booked bundles;
- plan, bundle, discovery-review, marketing and promotion repositories;
- tenant subscription read/write adapters;
- promo-code repositories and plan-catalog import/read sinks;
- the standard Tenant/User/Audit/Subscription resource adapter.

```ts
const persistence = prismaPersistence({
    client: PrismaService,
    passwordHasher: Argon2Hasher,
    adminResources: { tenantMetrics: ['users', 'storageItems'] },
});
```

The application still owns authentication and product logic. In particular,
each quota needs one `QuotaProvider` because only the application knows how to
count users, notes, storage or API calls. That same provider is reused for
runtime enforcement and the tenant usage response.

A custom schema or database can implement `SaaSiCatPersistenceAdapter` with
the same named slices. The fine-grained ports and individual modules remain
public; the bundle does not remove the extension points.

## Wiring the Standard AppModule

```ts
import { defineSaaSiCat, SaaSiCatModule } from '@saasicat/nest/platform';

@Module({
    imports: [
        PrismaModule,
        AuthModule,

        SaaSiCatModule.forRoot(
            defineSaaSiCat({
                planCatalog: SAAS_CONFIG,
                controller: { guards: [JwtAuthGuard] },
                imports: [PrismaModule, AuthModule],
                persistence,
                entitlement: {
                    resolutionConfig: { defaultTrialEntitlementPlan: 'STARTER' },
                },
                catalog: {
                    featureUiRegistry: MYAPP_FEATURE_UI_REGISTRY,
                    strictModeCheckMode: 'blocking',
                },
                tenantBilling: {
                    authGuards: [JwtAuthGuard, TenantGuard],
                },
                subscriptionBundles: true,
                setup: true,
                subscriptionContract: true,
                adminResources: true,
                promoCodes: true,
                quotaProviders: [UsersQuotaProvider, StorageGbQuotaProvider],
                tenantManifest: { guards: [JwtAuthGuard, TenantGuard] },
            }),
        ),

        MyAppDomainModule,
        MyAppAdminContributionModule,
    ],
})
export class AppModule {}
```

Keep this object in an app-owned `saasicat.config.ts` once it grows beyond a
small quickstart. `AppModule` then contains only
`SaaSiCatModule.forRoot(MY_APP_SAASICAT_CONFIG)`. The library owns module
composition; the client file contains only auth, branding and adapter choices
that are inherently application-specific.

`resolutionConfig` answers which plan's entitlements apply when the
subscription's own plan is not the whole story: during a trial, during a pilot,
while an enterprise deal waits on sales — and after a cancellation has taken
effect. That last one grants nothing by default, which is what ending a contract
means. Name a plan to keep a floor instead:

```ts
entitlement: {
    resolutionConfig: {
        defaultTrialEntitlementPlan: 'STARTER',
        // A read-only tier a former customer can still export from. Omit the
        // key and a subscription grants nothing once its cancellation lands.
        canceledEntitlementPlan: 'FREE',
    },
},
```

This configuration removes the usual app-owned plan resolver, catalog module,
billing module, subscription display mapper and duplicate usage snapshot.
SaaSiCat resolves active plans through the subscription repository and builds
usage from the registered quota providers.

`adminResources: true` mounts the standard tenant list/detail/actions, user,
audit and subscription endpoints. `promoCodes: true` mounts the full
SuperAdmin promo-code CRUD. Both add functionality to the standard API; they
do not remove pages from the Admin UI. Apps with a different schema replace
the single `AdminResourcesPort` while keeping the controllers and pages.

For a database-managed runtime catalog, replace `planCatalog` with the path of
the same file:

```ts
SaaSiCatModule.forRoot({
    // … the rest of your wiring …
    dbCatalog: { path: 'config/saas.yaml' },
});
```

The platform reads the settings — `app`, `currency`, `vatRate`,
`tenantBilling`, `marketing`, `notifications` — from that file itself, and the
plans and features from the read sink. A `plans:` block still in the file is
not read on this path; it is the seed for `saasicat catalog import`. There is
nothing in the option to type a setting into, which is the point: the file
defines them by construction, not by everybody agreeing to forward them.

A relative path is resolved against the directory the process was started in,
not against the file the option is written in — so a service started from its
own subdirectory needs the path it sees from there, or an absolute one. A file
that does not load is reported as `catalog.db-catalog-file-loads`, beside
whatever else the boot found wrong, and the message carries both the path as
written and the reason the read failed.

Use the low-level `CatalogModule`, `EntitlementModule`,
`TenantBillingModule`, `SubscriptionBundleModule` and adapter options only
when the standard behavior does not fit.

## Payment Methods Through a Gateway

A payment method is entered in the payment gateway's own form, and SaaSiCat keeps the gateway's
reference to it for the subscriber, with the details that tell one payment method from another —
the card network, the last four digits, the expiry, a direct debit's mandate reference — and never a
card number or an IBAN. Self-registration takes its payment method this way, and the tenant's plan
page shows the one in use and opens the form for a new one.

**One gateway account belongs to one installation.** Two installations sharing an account is the
arrangement to avoid. Stripe delivers an event to every endpoint registered on the account that
subscribes to that type, with no way to route by application, and recommends an account per
application for exactly that reason (quoted in
[the adapter's README](../../packages/payment-stripe/README.md)); assume the next provider behaves
the same way until its own documentation says otherwise. So each of your installations gets its own
account at the provider, and the accounts in `config/saas.yaml` are that installation's.

A sibling's callback cannot move what matters: a confirmation names its account, its session and its
subject together, so one from the installation next door matches no open setup here — no payment
method changes hands, and no sign-up is activated. What it does instead depends on what each
installation has wired, so these are three separate cases and not a list that stacks.

**Every installation: your log and your tables fill with other people's work.** A sibling's
confirmation for a subscriber is written at error level — with one account per installation that can
only mean a callback naming a subscriber it has no business naming — so four installations on one
account turn three of every four into an error line reading "nothing recorded", in each of them, in
the same words a real defect produces. On the sign-up path the same mismatch is a warning. And an
event this installation can handle is claimed in `payment_event_log` before anything asks whose
subject it is, so a sibling's confirmations become rows of yours.

**An installation that runs sign-ups: an audit trail with strangers in it.** With
`RegistrationModule` wired, a sibling's abandoned sign-up checkout writes a `PAYMENT_FAILED` entry
belonging to no sign-up of yours.

**An installation that does not run sign-ups: it can be taken down by a neighbour's event.** A
callback is answered with an error when nothing here handles what it is about — deliberately, so a
confirmation is retried rather than lost while a module is still being wired. Beside an installation
that does run sign-ups, that fires for events that were never yours: every sibling sign-up event
answered with `500`, a confirmation and an abandoned checkout alike, since what is missing is decided
before the two are told apart, and the message advises wiring `RegistrationModule` — neither your
problem nor your fix. A gateway retries such an event for a long time and then disables an endpoint
that keeps failing; the endpoint it disables is the one carrying your own confirmations. This is the
case that makes the heading a rule rather than a preference.

Name the gateway accounts in `config/saas.yaml`. An account's name is the last segment of its
webhook route, and the account `newPaymentMethods` names is where new payment methods are taken,
with the `methods` its form offers. `returnUrlOrigins` names where the form may send a person back
to — the **browser's** origin, not your API's, because that is where the person lands. A success or
cancel URL at any other origin is refused with `PAYMENT_RETURN_URL_NOT_ALLOWED`, which is what a
front end on a different port than `APP_URL` runs into first:

```yaml
payments:
    newPaymentMethods: main
    returnUrlOrigins: [https://app.example.com]
    accounts:
        main:
            provider: dev
            methods: [card, sepa_debit]
```

A website that offers the plans needs this before anybody reaches a form, so the public catalogue
carries it: `GET /public/marketing-catalog` answers `newPaymentMethods` with whether one is taken
here at all and the methods that form offers, derived from the block above rather than written a
second time on the website. The account and its provider stay inside. `SaaSiCatModule` wires the
catalogue to read it whenever `payments` is configured. A `CatalogModule` you mount yourself is
asked: `publicMarketingCatalog.newPaymentMethodsFrom` takes `PaymentGatewayRegistry`, or `null`
where nothing takes payment methods — required rather than optional, because leaving it out would
publish "none is taken", which is a claim and not silence. Pointed at a registry it cannot reach, it
refuses to start rather than publishing that claim. Where your own sign-up route wants the same
answer, `PaymentGatewayRegistry.forNewPaymentMethods()` from `@saasicat/nest/payments` is where the
catalogue reads it.

**An account's name and its provider are two different things**, and both have to line up with
something. The name — `main` above — is yours to choose, and it is the last segment of that
account's webhook route, so it is what you register at the gateway. The `provider` is the adapter's
own name, and a start refuses an account whose bound adapter calls itself something else. Keep that
in mind if you ever write a down-migration: a backfill that sets `gatewayAccount = provider` is
right for the first run, where every row came from the one account, and wrong for every run after
it — it turns `main` into `dev`.

Bind one gateway adapter per account, built with that account's keys from the environment. The
file refuses a variable named like a credential, which is why the keys are bound here and not
written there. `DevPaymentGateway` from `@saasicat/nest/payments` confirms every payment method on
the spot without a provider behind it, for development and tests, and **its constructor throws
under `NODE_ENV=production`** — the process does not start, rather than the payment function being
switched off:

```ts
defineSaaSiCat({
    // … the rest of your wiring …
    persistence, // supplies `payments` and `entitlement.subscriberRepository`
    tenantBilling: { authGuards: [JwtAuthGuard, TenantGuard] },
    payments: {
        // A factory around the whole map, not around one account, and
        // `gatewayForMain` is the one below.
        gateways: { useFactory: () => ({ main: gatewayForMain() }) },
        // The modules the factory and the guards here resolve from. Set this
        // where `tenantBilling.imports` is what you have: `payments` falls back
        // to the TOP-LEVEL `imports`, never to another feature's.
        imports: [AuthModule],
        // Who holds the billing permission. Without it, the tenant's administrator does.
        // billingPermissionGuards: [AccountingRoleGuard],
    },
});
```

### A value is built at import time; a factory is built when it is resolved

`gateways` takes either, and the difference decides when a bad configuration is found.
`gateways: { main: new DevPaymentGateway() }` reads well and builds the adapter the moment the
module is loaded — before your own checks run, and whatever `provider:` says in the file. Switching
providers then means editing two places. A factory builds at resolution, so one `provider` in the
file can decide.

The factory wraps the **whole map**, not one account: `gateways` is one provider. Written the other
way round, `{ main: { useFactory: … } }` is an object whose `main` is not a gateway, and TypeScript
says so — `'useFactory' does not exist in type 'PaymentGateway'`. Where nothing type-checks the
option it is bound as a value instead, and the start is refused with the bound gateway named
`'undefined'`, which points at the account rather than at the shape. The compile error is the better
half; keep the option typed.

```ts
const gatewayForMain = () =>
    process.env.MYAPP_PAYMENT_PROVIDER === 'stripe'
        ? new StripePaymentGateway({ secretKey, webhookSecret, currency: 'EUR' })
        : new DevPaymentGateway();

// payments.gateways:
{ useFactory: () => ({ main: gatewayForMain() }) }
// and with something to inject:
{ useFactory: (config: ConfigService) => ({ main: gatewayFor(config) }), inject: [ConfigService] }
```

One consequence worth knowing before you switch: with a value, a plain `require` of your compiled
`app.module.js` is enough to find out whether the application can be built at all, because that is
when the adapter is constructed — cheap enough to run **before** your migration step, with no
database and no Nest context. With a factory the throw moves into dependency injection, and such a
check has to build the context and therefore needs the database. Both shapes are fine; the factory
is the one that keeps the provider in one place, and the preflight is the one that keeps a failed
start from landing after a migration.

`payments.imports` is its own list, and its fallback is the top-level `imports` — not another
feature's. An application that puts its modules in `tenantBilling.imports` and nothing at the top
level therefore gives `payments` an empty list, and a guard resolving from a module of yours fails
with `Symbol(saasicat/nest/TenantAuthGuards)` and an unresolvable `TenantGuard`, which does not read
as a missing import.

A gateway adapter implements `PaymentGateway` from `@saasicat/core`: it opens the form for a payment
method, and it reads a callback, verifying it with the account's secret before a single field is
trusted. The session it opens states `confirmableUntil`, the last moment a confirmation of its form
can still arrive — the form's end plus the time the gateway goes on retrying a delivery — or `null`
where the gateway states neither: a sign-up's promo code slot is held until then. When the provider
fails, opening the form or reading a callback back, throw its error as it came: the request is
answered with `PAYMENT_GATEWAY_FAILED` and 502, and the error's kind, `code`, `statusCode` and
`requestId` go to the server log — its message and stack only when it carries no `statusCode`, so a
failure of the adapter's own can be traced. A callback whose signature does not verify throws
`PaymentCallbackRejectedError` instead. `config/saas.yaml` names the provider each account is at,
and a start refuses an adapter that names another.

For a real one, `@saasicat/payment-stripe` is shipped:

```ts
import { StripePaymentGateway } from '@saasicat/payment-stripe';

payments: {
    gateways: {
        main: new StripePaymentGateway({
            secretKey: process.env.STRIPE_SECRET_KEY,
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            currency: 'EUR',
        }),
    },
},
```

The account is `provider: stripe` in the file, its webhook endpoint at Stripe points at the route
below and is subscribed to `checkout.session.completed` and `checkout.session.expired`, and the
keys stay in the environment. `stripe` is a peer dependency of that package, so install it beside.

Two things there that nothing on this side can check for you. Every method the account lists in
`methods` has to be live at **that Stripe account**: the list travels to Stripe as one, so a method
the account has not been cleared for takes the whole session down with it, and the first sign is a
customer who cannot enter a payment method at all. And `STRIPE_SECRET_KEY` is read off the dashboard
by a person, because no API creates an API key — Stripe advises a restricted key over a secret one.
(The webhook secret is not in that boat: creating the endpoint through the API returns it.)
[Its README](../../packages/payment-stripe/README.md) has both, and the rest.

What `payments` mounts and asks of the application:

- **`POST ${globalPrefix}/webhooks/payment/<account>`** — where each account's callbacks arrive.
  Register that URL at the gateway. The route is public, because a gateway has no session, and it
  verifies against the exact bytes that arrived, so create the application with `rawBody: true`,
  and let a global authentication guard return early for `isSaaSiCatPublicRoute(reflector,
context)`. A callback that does not verify is refused with `PAYMENT_CALLBACK_REJECTED`, and one
  for an account the file does not name with `PAYMENT_GATEWAY_ACCOUNT_UNKNOWN`.
- **One transaction per callback.** The event is claimed in `PaymentEventLog`, unique per account,
  and what it changes is written on the same transaction. A failure rolls both back, and the
  gateway's retry is handled; a delivery that arrives again after a commit is a duplicate and
  changes nothing. A gateway that reports one session through more than one event is a duplicate
  too: a session is confirmed once, which the log holds whether the two arrive after one another or
  together. A confirmation that changed nothing — a setup nobody opened, a sign-up that is not
  waiting — gives the session back on that same transaction, so the event that does belong to it is
  still handled.
- **`GET /billing/payment-method`** and **`POST /billing/payment-method/setup`** — the tenant's
  payment method, with `tenantBilling` enabled. Both sit behind `tenantBilling.authGuards` and the
  billing permission, reading included; a user without the permission is refused with
  `BILLING_PERMISSION_REQUIRED`. The setup takes `successUrl` and `cancelUrl` and answers the form's
  `redirectUrl`; nothing changes until the gateway confirms, and the confirmed payment method
  replaces the one in use, which stays as history. Opening the form records the setup, and a
  confirmation is recorded only for the account, session and subscriber of an open setup — a
  callback that names another subscriber changes nobody's payment method. Such a callback is logged
  at error level and leaves its setup open, which is where it is found afterwards: the tenant keeps
  the payment method it had, so a gateway adapter that reports a session under a name of its own
  shows up as changes that never arrive.
- **`GET /billing/details`** and **`PATCH /billing/details`** — whom the tenant's subscription is
  billed to, behind the same guards and permission. The tenant changes the address and the invoice
  email; the street, postal code, city, country and invoice email can be replaced but not cleared
  (`SUBSCRIBER_DETAIL_INVALID` names the field), and a legal name or tax identifier in the body is
  refused with `SUBSCRIBER_IDENTITY_NOT_A_CONTACT` — the operator corrects those. The request DTO
  declares those three fields so that a `ValidationPipe` with `whitelist` passes them through to the
  refusal instead of stripping them into a silent success. `TenantBillingSection` in
  `@saasicat/ui-vue-tenant` is the page for both routes and the payment method.
- **Row-level security and the callback.** A callback arrives with no session and no tenant. If your
  `subscriber_payment_methods` and `subscriber_payment_method_setups` carry a policy, the callback
  sees no row, `completeSetup` matches nothing, and the gateway is answered with an error for a
  callback that was correct. Put the bypass on the controller class,
  `PaymentWebhookController`, rather than on a path — the route moves with the account name, the
  class does not. What stops a stranger's callback is not the tenant scope but the open setup,
  which names the account, the session and the subscriber together.
- **At start**, the application refuses to boot when the bound gateways and the accounts in the file
  disagree, when a payment method in use belongs to an account the file no longer names, and when
  a sign-up is still waiting for its payment method at such an account — each named in the message.
  An account stays listed until nothing in use belongs to it. Those checks read platform-wide,
  before anything is served: the platform wraps them in `RlsBypassPort`, and an implementation of
  that port which needs a request context, or answers with the caller's tenant scope, turns the
  check that exists to refuse into one that passes.

## The Subscriber's Account

The journal of what each subscriber owes: one charge per contract line and period — the plan, each
add-on booking, a discount — derived from the contract in force, the billing windows and the
bookings, and written once. A charge is net, with its currency and its period, and names the
contract line it came from; its tax is decided when it is invoiced. Nothing here updates or deletes
a charge.

It needs frozen contracts, because a charge points at a contract line: configure it beside
`contractFreeze`, adopt `prisma-fragments/15-subscriber-ledger.prisma` and run
`sql/1.0-a-subscriber-account-records-its-charges.postgres.sql` once.

```ts
tenantBilling: {
    authGuards: [JwtAuthGuard, TenantGuard],
    contractFreeze: {
        sourcePort: MyContractFreezeSource,
        subscriptionContractRepository: persistence.entitlement!.subscriptionContractRepository!,
        subscriberRepository: persistence.entitlement!.subscriberRepository!,
    },
    chargeJournal: {
        ledgerRepository: persistence.entitlement!.subscriberLedgerRepository!,
    },
},
```

The platform brings an account up to date where it writes a change itself: after onboarding and
after an add-on booking. Your application calls it where it writes one — when it activates a
subscription, and from the job that renews billing periods:

```ts
import { SubscriberChargeService } from '@saasicat/nest/billing';

@Injectable()
export class RenewalJob {
    constructor(private readonly charges: SubscriberChargeService) {}

    async renew(tenantId: string): Promise<void> {
        // What the ending window owes, before it moves — a throw stops the renewal here.
        await this.charges.recordDueCharges(tenantId);
        // … roll the subscription's and the bookings' windows forward, then:
        await this.charges.recordDueCharges(tenantId);
    }
}
```

`recordDueCharges` is safe to call as often as you like, from as many places at once as you like: a
charge is written once for its contract line, period and origin. A period your job skipped is
charged on the next call, one cycle at a time from where the account left off, at the price of the
contract in force when it started. Nothing is charged during a trial, without a contract, before a
period starts, or from the date a cancellation takes effect. A promo code's or a promotion's
discount is charged for the periods it was concluded for, at the amount resolved then, counted from
the first period the concluded contract prices.

An account with no charge yet begins with the window its subscription is in. Where the paid periods
began is recorded nowhere a charge could be derived from — a contract may be concluded during a
trial — so nothing before that window is guessed. That is why the job above charges before it moves
a window: a window that moved on before anything charged it is not charged afterwards. An add-on is
charged from its booking, but not from before the account begins. Where writing the contract failed
after a booking, the next call writes it again, so that the booking has a contract line to be
charged under.

What it does not do yet: charge what an immediate plan change adds, collect anything, or show the
account on a screen.

## Admin Module

`SaaSiCatModule` owns `PlatformAdminModule`, `AdminManifestModule` and the
optional `AdminStatsModule`. Configure them in `saasicat.config.ts`:

```ts
export const MY_APP_SAASICAT_CONFIG = defineSaaSiCat({
    // ...core options...
    includeManifestController: false, // the app owns the guarded route
    adminManifestExtraProviders: [AdminManifestConfigFactory],
    adminManifestConfig: {
        useFactory: (factory: AdminManifestConfigFactory) => factory.build(),
        inject: [AdminManifestConfigFactory],
    },
    adminStats: {
        extraProviders: [
            PrismaSubscriptionStatsPort,
            PrismaPromoCodeStatsPort,
            PrismaAuditStatsPort,
        ],
        subscriptionStatsPort: { useExisting: PrismaSubscriptionStatsPort },
        promoCodeStatsPort: { useExisting: PrismaPromoCodeStatsPort },
        auditStatsPort: { useExisting: PrismaAuditStatsPort },
    },
});
```

The app-owned `AdminModule` now contains only project controllers, services
and manifest contributions:

```ts
// admin/admin.module.ts
@Global()
@Module({
    controllers: [AdminController, AdminManifestController],
    providers: [AdminService],
    exports: [AdminService],
})
export class AdminModule implements OnModuleInit {
    constructor(private readonly manifest: AdminManifestService) {}

    onModuleInit(): void {
        this.manifest.register(MYAPP_CORE_MANIFEST_CONTRIBUTION);
        this.manifest.register(PROMO_CODES_MANIFEST_CONTRIBUTION);
        // … more contributions
    }
}
```

## Manifest Contributions

A contribution describes _what your app contributes to the SuperAdmin UI_ — which
capabilities it has, which standard pages are on/off, which KPI cards, which
tenant actions, which project pages (your own pages under `/admin/...`).

```ts
// admin/manifest-contributions/myapp-core.manifest.ts
import type { ManifestContribution } from '@saasicat/core';

export const MYAPP_CORE_MANIFEST_CONTRIBUTION: ManifestContribution = {
    capabilities: {
        'dashboard.read': true,
        'tenants.read': true,
        'plans.read': true,
        'plans.write': true,
        'discovery.read': true,
    },

    navigation: {
        standardPages: {
            subscriptions: { enabled: false, requiredCapability: 'subscriptions.read' },
        },
        projectPages: [
            {
                id: 'myapp.report',
                path: '/admin/report',
                label: 'Reports',
                icon: 'analytics',
                requiredCapability: 'reports.read',
                component: 'MyAppReportPage', // resolved in the UI via lazy loader
            },
        ],
    },

    dashboard: {
        kpiCards: [
            {
                id: 'platform.tenants.active',
                label: 'Active tenants',
                endpoint: '/api/v1/admin/stats/dashboard',
                displayHint: { type: 'value+delta', icon: 'business' },
                slotPriority: 90,
                requiredCapability: 'dashboard.read',
            },
        ],
    },

    tenantActions: [
        {
            id: 'myapp.tenants.export',
            label: 'Export data',
            endpoint: '/api/v1/admin/tenants/:slug/export',
            method: 'POST',
            requiresMfa: true,
            requiredCapability: 'tenants.export',
        },
    ],
};
```

## Custom `AdminManifestController` with Caching + MFA

Disable the standard controller (`includeManifestController: false`) and write your
own that hooks in your app guards and does ETag caching:

```ts
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard, MfaGuard)
@UseInterceptors(AdminBypassRlsInterceptor)
export class AdminManifestController {
    constructor(private readonly manifest: AdminManifestService) {}

    @Get('manifest')
    @Header('Cache-Control', 'private, max-age=60, must-revalidate')
    async getManifest(@Headers('if-none-match') ifNoneMatch?: string) {
        const m = await this.manifest.getManifest();
        const etag = `"${m.build.manifestHash}"`;
        if (ifNoneMatch === etag) throw new HttpException('', HttpStatus.NOT_MODIFIED);
        return m;
    }

    @Post('manifest/reload')
    @RequireMfa()
    reload() {
        return this.manifest.rebuild();
    }
}
```

## Declaring Capabilities / Features / Quotas in Code

On your app's controllers:

```ts
// dms/dms.controller.ts
import { ImplementsCapability, EnforceQuota } from '@saasicat/nest/discovery';
import { RequireFeature } from '@saasicat/nest/billing';

@Controller('dms')
@UseGuards(JwtAuthGuard)
export class DmsController {
    @Post('upload')
    @ImplementsCapability('dms.upload', {
        label: 'Upload a document to the DMS',
        feature: 'DMS',
        kind: 'endpoint',
        owner: 'dms',
    })
    @RequireFeature('DMS')
    @EnforceQuota('storageGb')
    async upload(@CurrentUser() user: AuthenticatedUser, @Req() req: FastifyRequest) {
        return this.dmsService.upload(user, req);
    }
}
```

On the quota providers:

```ts
// modules/platform-adapters/quota-providers.ts
@Injectable()
@DefinesQuota({
    key: 'storageGb',
    label: 'Belegter Speicher (GB)',
    unit: 'gigabyte',
    policy: 'hard',
    feature: 'DMS',
})
export class StorageGbQuotaProvider implements QuotaProvider {
    constructor(private readonly prisma: PrismaService) {}
    async count(tenantId: string): Promise<number> {
        const r = await this.prisma.dmsFile.aggregate({
            where: { tenantId },
            _sum: { sizeBytes: true },
        });
        return Number(r._sum.sizeBytes ?? 0) / 1024 / 1024 / 1024;
    }
}
```

> After adding/changing any decorator, the app must restart so the
> discovery snapshot is rewritten. Only then do the entries appear on the
> SuperAdmin discovery page.

## `AdminManifestConfigFactory`

Builds the static configuration for the manifest from the settings in `config/saas.yaml`, the
environment and `package.json`. The plans and features are not part of it: `AdminManifestService`
reads them from `PLAN_CATALOG_SOURCE_TOKEN` on every request, so a plan the operator publishes
reaches the plan editor without a restart.

```ts
@Injectable()
export class AdminManifestConfigFactory {
    constructor(
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN) private readonly settings: PlanCatalogSettings,
    ) {}

    build(): AdminManifestConfig {
        return {
            project: {
                key: this.settings.app.name,
                displayName: this.settings.app.name,
                label: this.settings.app.label,
                icon: this.settings.app.icon,
                logoUrl: this.settings.app.logoUrl,
                environment: this.resolveEnvironment(),
                availableLocales: this.settings.marketing?.availableLocales,
                defaultLocale: this.settings.marketing?.availableLocales?.[0],
            },
            build: {
                platformPackageVersion: readPackageVersion(
                    require.resolve('@saasicat/core/package.json'),
                ),
                appVersion: process.env.MYAPP_VERSION ?? '0.0.0',
            },
        };
    }
    // …
}
```

---

## First-Run Setup (SuperAdmin Bootstrap via the Admin UI)

On the very first start there is no SUPER_ADMIN yet — so there's also nobody who could log in or
create an admin via CLI (chicken-and-egg). The `SetupModule` solves this with a **public,
self-locking** bootstrap endpoint that the shared login page automatically shows as a wizard.

**Security model (two barriers, both must be satisfied):**

1. **Self-disable** — setup runs only while `provisioningPort.countSuperAdmins() === 0`. After the
   first SUPER_ADMIN is created, the endpoint permanently responds with `409 SETUP_ALREADY_DONE`.
2. **Setup token** — a secret set by the operator (env var, default `SETUP_TOKEN`). Without the var
   set, setup is completely disabled (`403 SETUP_DISABLED`); the comparison is timing-safe.

This way, even with a publicly reachable app, nobody can "guess/grab" the first admin.

**You need exactly one app adapter** — the `SuperAdminProvisioningPort` (2 methods). A full
`UserManagementPort` adapter (CLI) satisfies it too, so it can be shared:

```ts
import { Injectable } from '@nestjs/common';
import {
    PlatformUserExistsError,
    type CreateSuperAdminCliInput,
    type PlatformUserDto,
    type SuperAdminProvisioningPort,
} from '@saasicat/core';

@Injectable()
export class PrismaSuperAdminProvisioningAdapter implements SuperAdminProvisioningPort {
    constructor(private readonly prisma: PrismaService) {}

    countSuperAdmins(): Promise<number> {
        return this.prisma.user.count({ where: { role: 'SUPER_ADMIN', deletedAt: null } });
    }

    async createSuperAdmin(input: CreateSuperAdminCliInput): Promise<PlatformUserDto> {
        const email = input.email.toLowerCase();
        const existing = await this.prisma.user.findUnique({ where: { email } });
        // IMPORTANT: throw the shared error — the SetupService maps it to
        // 409 EMAIL_EXISTS (otherwise 500). The guard is `code`-based (realm-safe).
        if (existing) throw new PlatformUserExistsError(email, existing.role);
        const user = await this.prisma.user.create({
            data: { email, passwordHash: await hash(input.password), role: 'SUPER_ADMIN' /* … */ },
        });
        return toPlatformUserDto(user); // password hashing stays app-specific (argon2/bcrypt)
    }
}
```

**Wiring (`AppModule`)** — `SetupModule` MUST come **after** `AdminModule.forRoot` (it injects its
global `MfaService` for MFA enrollment):

```ts
SetupModule.forRoot({
  global: true,
  provisioningPort: {
    useFactory: (prisma: PrismaService) => new PrismaSuperAdminProvisioningAdapter(prisma),
    inject: [PrismaService],
  },
  setupTokenEnvVar: 'SETUP_TOKEN',   // Default; the operator sets the env var
  mfaIssuer: 'MeineApp',             // shown in the authenticator
}),
```

This mounts three public routes under `${apiBase}` (e.g. `/api/v1/admin`):

| Route                      | Purpose                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET …/setup/status`       | `{ needsSetup }` — the login page queries this on mount                                              |
| `POST …/setup`             | creates the first SUPER_ADMIN + MFA enrollment → `{ userId, qrDataUrl, secret, generatedPassword? }` |
| `POST …/setup/confirm-mfa` | verifies the TOTP code (token-protected)                                                             |

When authentication is registered as a global `APP_GUARD`, it must return
early for `isSaaSiCatPublicRoute(reflector, context)`. SaaSiCat marks these
setup endpoints itself; the setup token and automatic self-disable remain the
protection for first-run provisioning.

The **QR code is generated server-side** as a data URL (`qrDataUrl`) — the frontend only renders
`<img>`, no QR dependency needed.

**Frontend:** Nothing to do if the app uses the shared `SuperAdminLoginPage` (see
[app bootstrap](build-the-admin-frontend.md#app-bootstrap)). On mount it calls `setup/status` and,
when `needsSetup`, renders the `SuperAdminSetupWizard` instead of the login form. Apps **without**
`SetupModule` get `404` → the wizard stays off, normal login.

> **Prerequisite & order:** `AdminModule.forRoot` imported globally; global `ValidationPipe` active
> (for the setup DTOs); `apiBase` in the admin UI = mount prefix of the `SetupController`.
