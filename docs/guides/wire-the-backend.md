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
    orderlyRetirement:
        termsConfirmed: false
marketing:
    availableLocales: [de, en]
```

`tenantBilling:` is required, member by member — the notice period per rhythm, the
plans self-service may not reach or leave, and whether your terms allow you to retire
a version for the subscriptions already on it. Each has a money or a legal
consequence, so the file states them rather than defaulting them; see
[the settings section of the upgrade guide](upgrade-to-1.0.md#the-settings-that-cost-money-live-in-configsaasyaml)
and [Retiring a Version for Running Subscriptions](#retiring-a-version-for-running-subscriptions).

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
import { aesGcmSecretSealer, defineSaaSiCat, SaaSiCatModule } from '@saasicat/nest/platform';

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
                adapters: { secretSealer: aesGcmSecretSealer(process.env.SECRET_SEALER_KEY) },
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

### The SuperAdmin's second factor is sealed

The TOTP secret behind a SuperAdmin's second factor guards the accounts that can
change every tenant's plan, codes and contracts. Stored as it is, whoever holds a
dump, a backup or a replica of the database holds it too, and the second factor
adds nothing against them. So the platform seals it before `MfaPort` stores it
and opens it after it is read (`SC-SEC-016`), under a key your installation keeps
outside that database. The boot stops while no sealer is bound
(`core.secret-sealer-bound`).

- **`aesGcmSecretSealer(key)`** seals with AES-256-GCM. The key is 32 random
  bytes, base64 —
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
  Pass `process.env.…` as it is: a key that is unset, or of any other length,
  stops the boot with a message saying which.
- **`storeSecretsInPlainText()`** stores the secret as it is, for an
  installation that decides so on purpose — a development database, or a store
  that encrypts the column itself.
- **A sealer of your own** implements `SecretSealer` from `@saasicat/core`:
  `seal(plain)` and `open(sealed)`, where `open` throws for anything it did not
  seal. A key management service fits here, or the field encryption your
  application already has.

The persistence bundle does not supply one: the bundle is the database, and the
key is the one thing that must not come from there. A CLI that wires
`AdminModule.forRoot` itself binds the same sealer under the same key, since
`admin mfa-setup` seals there and the application opens. A changed or lost key leaves
every stored secret unreadable. The platform then turns the code away rather than
accepting it, logs which user it could not check, and that administrator enrols
again with `<app> admin mfa-setup --force`.

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
  refusal instead of stripping them into a silent success. Both answer `business` as the operator
  keeps it and, where a tax adapter decides, `readiness`: what holds the next contract back
  ([the tax adapter](#the-tax-adapter)). `TenantBillingSection` in `@saasicat/ui-vue-tenant` is the
  page for both routes and the payment method.
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

## The Tax Adapter

Where `config/saas.yaml` names a tax adapter, the application binds its factory the way it binds a
payment gateway, and every rate comes from the adapter
([ADR 0013](../explanation/adr/0013-tax-law-is-an-adapter.md)):

```ts
import { germanTaxAdapterFactory } from '@saasicat/tax-de';

SaaSiCatModule.forRoot({
    // …
    tax: { adapter: germanTaxAdapterFactory() },
});
```

```yaml
timeZone: Europe/Berlin
tax:
    adapter: '@saasicat/tax-de'
    options:
        smallBusiness: false
```

What the operator declares — `smallBusiness` — lives in the file; what only code can give — the
`fetch` that reaches VIES, its timeout — goes to the factory. The start refuses a name the file and
the factory do not share, `vatRate` beside `tax`, and an unknown time zone. The adapter decides the
rate a contract is concluded at from its subscriber's origin, and the rate the pricing page and the
configurator show for a subscriber in the issuer's country; `TAX_TREATMENTS_TOKEN` from
`@saasicat/nest/billing` answers the same for code of your own. What the German adapter decides is
in its [README](../../packages/tax-de/README.md); the steps for an existing installation are in the
[upgrade guide](upgrade-to-1.0.md#a-tax-adapter-decides-the-rate-of-every-contract).

A sign-up asks the adapter in step 4 ([self-registration](self-registration.md)). Where your
application creates a subscriber itself — an onboarding of its own, an operator's screen — ask first,
before the transaction that creates it:

```ts
import { contractTaxPeriod } from '@saasicat/nest/billing';

// The first period of the contract the subscriber will have.
const period = contractTaxPeriod({ effectiveFrom: new Date(), billingCycle: 'MONTHLY' });
const assessed = await subscribers.assessNewSubscriber(details, period);
await subscribers.createForTenant(tenantId, assessed, tx);
```

It answers the details with the check of the VAT number attached where the treatment depends on
one, which `createForTenant` records with the subscriber on the transaction you pass; assessed
details are refused without one, whether or not a check was needed. It refuses a case the adapter
cannot treat with `422 TAX_TREATMENT_NOT_SUPPORTED`, and a number it could not check just now with
`503 TAX_VAT_ID_CHECK_NOT_COMPLETED`. It reaches an outside service, so never call it inside a
transaction.

With an adapter, a contract names its subscriber only with the whole address an invoice names —
street and number, postal code, city and country. Every way a contract comes about refuses a
subscriber without it, naming the empty fields: `422 SUBSCRIBER_IDENTITY_INCOMPLETE`, `params.missing`.
A sign-up always has it; a subscriber your application created another way — a backfill, a migration
of existing tenants — gets it through `SubscriberService.changeContactOfTenant`.
`SubscriberService.readinessFor({ tenantId })` answers what holds a subscriber's next contract back,
computed from the record and the adapter as they are then — the empty fields, and the adapter's
sentence where it supports no treatment — and `null` without an adapter.

With `adminResources` on and a subscriber repository composed, the operator sees the same beside the
tenant: `GET admin/tenants/:slug/subscriber` answers the subscriber's address and tax details with
its standing, and `GET admin/subscribers/attention?tenantId=…` — up to 200 tenants, the parameter
repeated — which of them are held back and why. Both run behind the guards of the other tenant
routes of the administration and inside `RlsBypassPort`, and the manifest announces them as
`subscribers.read`; it adds `subscribers.attention` only where an adapter decides, and the tenant
list and the subscription list of `@saasicat/ui-vue` ask only then. Your own `SubscriberRepository`
implements `listForTenants`, which reads them in one go, and your own `AdminResourcesPort` gives each
row of `listSubscriptions` its `tenant.id`.

Beside the view the operator corrects the subscriber, announced as `subscribers.correct`:
`POST admin/tenants/:slug/subscriber/identity` corrects the legal name, the VAT number and the tax
number of the same legal entity, and `…/business-status` whether it acts as a business — each with a
written reason and behind the second factor, recorded with what it replaced and who made it.
`…/vat-id-check` checks the number held again without it, and `GET …/history` lists the
corrections, the changes of country and business status, and the checks, the latest first. A VAT
number a correction gives is checked with the adapter's service right after it is written, and the
check is kept whether the service found it valid, invalid or did not answer. Your own code does the
same in three steps — `SubscriberService.correctIdentity`, which writes only, then whatever records
the correction, then `checkCorrectedVatId(correction)` outside any transaction — and checks the
number held with `checkVatIdOf`. `TenantDetailPage` offers all of it beside the subscriber.

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

The platform brings an account up to date where it writes a change itself: after onboarding, an
immediate plan change and an add-on booking. Your application calls it where it writes one — when
it activates a subscription, and from the job that renews billing periods:

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
discount is charged for the periods it was agreed for, at the amount resolved then, counted from the
account's first plan period that ends after it was agreed: where an offer was concluded, or where a
code redeemed at onboarding was recorded in the first contract after it. Each discount counts from
the earliest contract that records it, so one your application copies into contracts it writes
itself does not start again. A window an earlier contract prices — one written during a trial
before the code was redeemed — is that contract's, and the discount starts with the next period. A
code redeemed at onboarding during a trial is recorded by the contract your application writes when
it activates the subscription, through `ContractFreezePort.freezeOnPlanChange`: the platform writes
none when a trial ends.

An account with no charge yet begins with the window its subscription is in. Where the paid periods
began is recorded nowhere a charge could be derived from — a contract may be concluded during a
trial — so nothing before that window is guessed. That is why the job above charges before it moves
a window: a window that moved on before anything charged it is not charged afterwards. An add-on is
charged from its booking, but not from before the account begins; your freeze source names each
booking's bundle version as `sourceVersionId` on its line, which is how the journal finds it. Where
writing the contract failed after a booking, the next call writes it again, so that the booking has
a contract line to be charged under.

An immediate upgrade is charged as its preview quoted it (`SC-PRIC-059`). In the same rhythm that
is the difference for the rest of the period, beside the period's own charge. Into a longer rhythm
it is the new period less the unused rest of the one it replaces. A discount stays with the rhythm
it was agreed in; at the first change of rhythm after it was agreed, what is left of it comes off
the new period, once (`SC-PRIC-060`).

With `adminResources` on as well, the operator reads an account beside its tenant. The platform
serves `GET admin/tenants/:slug/charges` behind the same guards as the other tenant routes of the
administration and announces it in the manifest as `charges.read`; `TenantDetailPage` then shows the
charges newest first — each with the title of its contract line, its period, what made it arise,
when it became due and its net amount — and whose account it is, by customer number and legal name
(`SC-ADM-028`). There is no total: without invoices and payments, a sum would be read as what is
owed. Without the journal, neither the route nor the section exists.

An operator's request is scoped to no tenant, so the platform reads the account inside
`RlsBypassPort`. If `subscriber_ledger_entries`, your subscriptions, contracts or subscribers carry
a row-level policy, your implementation of that port has to lift it there, as it does for the
other reads the administration makes.

What it does not do yet: collect anything, or show a tenant its own account.

## Invoices

The charges of the journal, issued as invoices: one invoice for the charges booked together under a
contract — the charges a billing period opens with, or one that arises later in the period — numbered
without gaps in one range per year (`SC-PRIC-072`). Invoicing ships switched off. **Switch it on for
real customers only from the release that brings the cancellation invoice** (`1.0.0-rc.28`): an
issued invoice is never edited (`SC-PRIC-025`), so until then a wrong one cannot be corrected. This
release issues the invoice as a record; its document, the archive and the mail follow.

It needs the charge journal above, a tax adapter, and the issuer in `config/saas.yaml`. Adopt
`prisma-fragments/20-subscription-invoice.prisma`, run
`sql/1.0-an-invoice-is-issued.postgres.sql` once, name the range and the payment term, and wire the
repository beside the journal:

```yaml
# config/saas.yaml
invoicing:
    numberPrefix: AHP # AHP-2026-000123
    paymentTermDays: 14 # due 14 days after the issue date
```

```ts
tenantBilling: {
    // … contractFreeze as above
    chargeJournal: {
        ledgerRepository: persistence.entitlement!.subscriberLedgerRepository!,
        invoices: {
            invoiceRepository: persistence.entitlement!.subscriptionInvoiceRepository!,
        },
    },
},
```

The start refuses the wiring without the `invoicing` block, the block without the wiring where tenant
billing is configured, either without a tax adapter or an issuer, and a `numberPrefix` other than
the one the invoices already issued carry (`SC-PRIC-024`). The prefix is letters and digits; the
number puts the year and the sequence behind it, each after a hyphen.

`SubscriptionInvoiceService.issueDue(now)` issues what is owed, and the platform runs it every
quarter of an hour, which needs `ScheduleModule` in your application. With
`invoices.includeCron: false` the platform leaves the run to your own scheduler, which calls
`issueDue`. Each invoice is put together from what holds on its issue date:

- **the subscriber** as its record stands, with its customer number;
- **the issuer** of the contract its charges belong to — the file's, address and all, while the file
  names the entity the contract was concluded with or a correction of it the operator declared
  (`SC-PRIC-026`); the contract's own copy otherwise;
- **the treatment** the tax adapter decides for the subscriber now (`SC-PRIC-043`), recorded with
  the adapter's name and version, and **the tax** by the adapter's rule, once per rate
  (`SC-PRIC-041`);
- **its days** in the installation's `timeZone`: the issue date, each line's period, and the due
  date, the issue date plus `paymentTermDays` (`SC-PRIC-045`, `SC-PRIC-046`);
- **its lines** in the order of the contract's lines, each naming its charge and its contract line
  (`SC-AUD-013`) and titled as the contract line is.

A billing period whose charges are all zero issues no invoice; a charge of zero beside one that is
not stays on its invoice (`SC-PRIC-048`). The adapter checks the content before the number is drawn
(`SC-PRIC-027`), and the store draws it in the transaction that writes the invoice, so an invoice
that is refused or fails leaves no gap.

An invoice that cannot be issued yet waits, and its charges with it: a subscriber whose invoice
address has gaps (`SC-PRIC-032`), one the adapter supports no treatment for, a contract whose
parties a migration copied or that names no issuer, or content the adapter finds missing. Each run
logs it, and the audit log records it once per process as `SUBSCRIPTION_INVOICE_HELD` by the actor
`job:platform:subscription-invoices`, with the refusal's code and what it names. Once what held it is
put right, the next run issues it under the next number.

The run reads and writes across tenants inside `RlsBypassPort`. If the invoice tables, the journal,
your contracts or subscribers carry a row-level policy, your implementation of that port has to lift
it there.

One installation is the range of exactly one issuer, and an issuer keeps one range: a second
application issuing for the same issuer is not supported.

## Telling Subscribers of a Newer Version

A subscription keeps the plan version it was sold, and a newer one sits beside the plan as an offer
(`SC-SUB-040`). With version notices on, the tenant's administrators also hear of it once, in your
words (`SC-SUB-022`): when the offer appears — not when the version is published — so a version
whose window opens later is told when it opens, and a subscription with a change still to land is
told once it has landed. Each newer version is told once per subscription. There is no reminder,
because doing nothing costs the subscriber nothing.

The platform decides when a notice is due and keeps a record of each: what it said, when it went out,
to whom and how (`SC-SUB-023`). Your application decides who the administrators are, what the
message says and how it travels. Adopt `prisma-fragments/17-subscription-notice.prisma`, run
`sql/1.0-a-subscriber-is-told-once.postgres.sql` once, and bind a port:

```ts
import { Injectable } from '@nestjs/common';
import type {
    SubscriptionNotice,
    SubscriptionNoticeDelivery,
    SubscriptionNoticePort,
} from '@saasicat/core';

@Injectable()
export class VersionNoticeMailer implements SubscriptionNoticePort {
    constructor(
        private readonly users: UsersService,
        private readonly mail: MailService,
    ) {}

    async deliver(notice: SubscriptionNotice): Promise<SubscriptionNoticeDelivery> {
        const admins = await this.users.activeAdministratorsOf(notice.tenantId);
        for (const admin of admins) {
            if (notice.kind === 'version-offered') {
                // Both versions side by side, the kind of offer, when a switch takes effect.
                await this.mail.send(admin.email, 'plan-version-offered', { offer: notice.offer });
            } else if (notice.kind === 'version-retired') {
                // A retirement: see "Retiring a Version for Running Subscriptions" below.
                await this.mail.send(admin.email, 'plan-version-retired', { retirement: notice });
            } else if (notice.kind === 'bundle-version-retired') {
                // An add-on version's retirement: see "Retiring an Add-on Version" below.
                await this.mail.send(admin.email, 'add-on-version-retired', { retirement: notice });
            } else if (notice.kind === 'bundle-version-offered') {
                // A newer version of a booked add-on: see "Offering a Newer Add-on Version" below.
                await this.mail.send(admin.email, 'add-on-version-offered', {
                    offer: notice.offer,
                });
            } else {
                // Its one reminder, 14 days before the date, where staying put costs something.
                await this.mail.send(admin.email, 'plan-version-reminder', { reminder: notice });
            }
        }
        return { recipients: admins.map((admin) => admin.email), channel: 'email' };
    }
}
```

```ts
tenantBilling: {
    authGuards: [JwtAuthGuard, TenantGuard],
    versionNotices: {
        port: {
            useFactory: (mailer: VersionNoticeMailer) => mailer,
            inject: [VersionNoticeMailer],
        },
    },
    extraProviders: [VersionNoticeMailer],
    imports: [UsersModule, MailModule],
},
```

The record comes from `persistence.tenantBilling.subscriptionNotices`, which both shipped bundles
provide; a start with version notices and no record is refused
(`version-notices.requires-notice-record`). A `SubscriptionUsagePort` of your own needs
`listBoundToEarlierVersions`, and the plan repository `findVersionById`, or the start is refused
as well — without them the platform cannot find whom to tell.

- **Resolve with to whom and how.** The platform keeps it as the record. An empty list records that
  nobody could be told, and the notice is not tried again.
- **Throw where it could not be sent.** The next run tries again.
- **Answer within a minute.** An answer that takes longer is still awaited: the notice stays held,
  so no other run sends it meanwhile, and the answer is recorded when it comes — or, where it is a
  failure, the notice is let go for the next run.
- **Two cases send a notice twice:** your process stops after the message went out and before the
  platform recorded it, or your port takes longer than a quarter of an hour to answer, after which
  another run may take the notice on.
- **Where the run comes from.** The platform runs every quarter of an hour, which needs
  `ScheduleModule` in your application, and pauses while the application is locked for
  maintenance. Set `versionNotices.includeCron: false` to call `VersionNoticeService.sendDue` from a
  scheduler of your own instead.
- **Across tenants.** A run reads every tenant's subscription and writes the record inside
  `RlsBypassPort`, and your port is called inside it too, so it can read the administrators of any
  tenant.

## Retiring a Version for Running Subscriptions

A subscription keeps its version (`SC-SUB-024`). Sometimes an operator cannot keep a version
running — it costs more to serve than it brings in, or a whole plan is being phased out. Retiring a
version is the orderly way out: the subscriptions on it are told that they continue on a
replacement the operator names, each at the end of one of its terms at least three calendar months
after its notice reached an administrator (`SC-SUB-035`), and may leave without notice until then
(`SC-CANC-023`). A price increase is a
retirement whose replacement costs more: publish the new version first, let it start, then retire
the old one.

**It rests on your terms.** A customer agreed to a version; moving them to another needs a clause in
the terms they accepted. Confirm that your terms carry one, and only then:

```yaml
tenantBilling:
    orderlyRetirement:
        termsConfirmed: true
```

Without it the administration does not offer the action, and the server refuses it with
`RETIREMENT_TERMS_NOT_CONFIRMED`. The setting is a business setting like the notice periods: the
settings page shows it, and a change to it is recorded and reported (`SC-CFG-009`).

**Wiring.** It needs version notices (the section above) and a place to keep each announcement.
Adopt `prisma-fragments/18-version-retirement.prisma` and run
`sql/1.0-a-retirement-is-announced.postgres.sql` once; both shipped bundles then provide
`persistence.tenantBilling.versionRetirements`, and the platform writes on its own transaction
runner. Confirmed terms with nowhere to keep an announcement refuse the start, naming the setting.
A `SubscriptionUsagePort` of your own needs `listBoundToVersion` — both shipped adapters have it —
and has to return each subscription's `pendingChangeVersionId` with it: without it, a subscriber
who took a newer version's offer is reached as if they stayed. A `TenantSubscriptionWritePort` of
your own honours `keepsPendingChange`, which the move passes so that a change the subscriber
scheduled survives it — `scheduledChangeAfterWrite` in `@saasicat/core` says what the columns
become — and `restoresQuotedVersion`, which binds the version named whether or not it still takes
bookings: a move or a switch whose contract cannot be written is put back with it, onto a version
that is off sale. An `AuditPort` of your own accepts the platform job's actor, whose `userId` is
`null`.

**What the operator does.** In the plan cockpit, a version no longer on sale offers "Retire…". The
operator picks the plan the subscriptions continue on — its version on sale is the replacement, of
the same plan or another — and reads the preview before anything is sent: the replacement's prices
beside the retired version's, how many subscriptions move on which date, and the ones it does not
reach and why (`SC-SUB-026`). The announcement asks for the second factor, and it is refused where
the version is still on sale, the replacement is not or has no price in the rhythm a subscription is
billed in, nobody would be reached, or a subscription was reached by another retirement within
twelve months (`SC-SUB-025`, `SC-SUB-028`). The routes are
`GET` and `POST /admin/catalog/plan-versions/:id/retirement` and `GET /admin/catalog/version-retirements`.

**What your port is handed.** One `version-retired` notice per subscription, recorded with the
announcement in one transaction and then sent through the same `SubscriptionNoticePort` as an offer
(`SC-SUB-029`). It carries both versions side by side with their prices, quotas and features
(`retired`, `replacement`, `changes`), the `billingCycle` it is billed in when the retirement takes
effect, the `effectiveAt` instant and `lastDayToCancel` — the last whole calendar day, in UTC,
before that instant, on which it may cancel without notice. A notice your port could not send is
sent by the next quarter-hourly run. A subscription hears of a version's retirement once: a second
announcement of the same version skips the ones the first one told. The tenant's plan section
shows the same notice beside the plan (`SC-SUB-030`).

**Nothing happens before the notice arrives.** A retirement counts from its notice reaching at least
one administrator (`SC-SUB-038`). Until then it moves nothing, reminds nobody, offers no switch,
shows nothing beside the plan and changes no charge. For a retirement notice, an answer from your
port with no recipients counts as not sent: the run tries again every quarter of an hour and says so
in the log once a day, so a tenant without an administrator is told once one exists. A notice that
goes out late names the date counted from then — the first end of a term at least three calendar
months after its sending (`SC-SUB-035`) — and its last day to cancel with it. A subscription that
left the version before its notice could go out is not sent one. A subscription is told of one
retirement in twelve months, of a plan version or of an add-on version, counted from delivery
(`SC-BUN-041`): a notice still waiting holds no announcement back, and when it can go out at last it
waits instead while another was told within the twelve months, until those are over. A notice that
waited is sent only while the replacement's plan can carry the add-ons the subscription holds at the
date (`SC-SUB-037`), counting the versions they were told they continue on; it waits while it
cannot. The plan cockpit counts the subscriptions not told yet beside the retired version, and the
replacement cannot be terminated while any of them waits:
`PLAN_TERMINATE_WHILE_NOTICES_UNDELIVERED`.

**The one reminder.** Where staying put costs a subscription something — the replacement is
dearer in the rhythm it is billed in at the date, or takes a feature away or lowers a quota — the
same run reminds it once, 14 days before the date (`SC-SUB-034`). Your port is handed a
`version-retirement-reminder` notice: what the retirement notice said — its `billingCycle` the
rhythm billed at the date, read again as the subscription stands when it is reminded — and
`switchTerms`, what a switch taken now would cost, or `null` where the subscription cannot switch
now. A price that rises only in another rhythm is no reason to remind. A run that did not
happen on the day is caught up until the date. Nobody is reminded who has cancelled, switched, or
leaves the version by the date through a change of their own. The plan cockpit counts the reminded
subscriptions beside the retired version.

**What happens at the date.** The quarter-hourly run that sends version notices also moves every
subscription whose date has come and that is still on the retired version onto the replacement,
keeping its period and its term (`SC-SUB-031`). A run that did not happen is caught up by the next.
A subscription that has ended by its date is left alone, and so is one whose own scheduled change
takes it off the version by then; a change scheduled for later survives the move. The move writes a
successor contract, and the charge journal charges every period from the date at the replacement's
price once that contract exists, however late it comes (`SC-PRIC-062`). Each move is audited as
`PLAN_VERSION_RETIREMENT_MOVE` by the actor `job:platform:retirement-moves`. A move and its contract
are one: where the contract cannot be written, the move is put back. A move that cannot be made is
audited once as `PLAN_VERSION_RETIREMENT_MOVE_FAILED`, tried again by every run, and shown as
overdue beside the retired version in the plan cockpit, with the ones moved, waiting and ended
(`SC-SUB-033`); of the ones not told yet it says why each notice waits — the retirement no longer
reaches them, the replacement's plan could not carry their add-ons at the date, the twelve-month
limit, or nobody has been reached yet, each counted by the first that holds it back (`SC-SUB-039`).
With `versionNotices.includeCron: false`, call
`VersionRetirementService.sendUndelivered(new Date())`,
`RetirementReminderService.remindDue(new Date())` and `RetirementMoveService.moveDue(new Date())`
from your own scheduler, as you call `VersionNoticeService.sendDue`. The first sends the notices an
announcement could not send at once; a scheduler without it leaves those retirements waiting for
their notice.

**Switching early.** Until the date, the plan section offers the switch to the replacement
(`SC-SUB-032`, `POST /billing/retirement/switch`, for the tenant's administrators). It takes effect
at once and keeps the term. Where the replacement costs more, the subscriber goes on paying what
they paid until the date: the contract the switch writes records the difference as a discount line
"Price held until …" (`SC-PRIC-063`). The switch opens after a trial and not while a change is
scheduled, and it ends the right to cancel without notice, which rests on the version being retired.
It is the one way to the replacement while the retirement reaches the subscription: the version
offer leaves the replacement to it, and offers nothing that takes something away until the move has
been made; a newer version that applies at once is offered beside the notice (`SC-SUB-040`). In a
trial the replacement waits for the trial to end, as the switch does.

**Ending the replacement.** A version subscriptions still move onto cannot be terminated before the
day after the last of their dates; the catalogue refuses with
`PLAN_TERMINATE_BEFORE_RETIREMENT_MOVES` and names the first day it may end (`SC-PLAN-029`). While a
move onto it is past its date and not made, it cannot be terminated at all:
`PLAN_TERMINATE_WHILE_MOVES_OVERDUE`, with how many are waiting.

## Retiring an Add-on Version

An add-on version can be retired the way a plan version is, and for the same reasons. The bookings
on it continue on the add-on's version on sale — a version of the same add-on, so each stays the
same booking with the same term (`SC-BUN-038`).

**Wiring.** It needs the wiring of the section above, the same confirmed terms, and a place to keep
each announcement: adopt `prisma-fragments/19-bundle-version-retirement.prisma` and run
`sql/1.0-an-add-on-retirement-is-announced.postgres.sql` once. Both shipped bundles then provide
`persistence.tenantBilling.bundleVersionRetirements`, and the bookings come from
`persistence.entitlement.subscriptionBundleRepository`. Without either, the administration does not
offer retiring an add-on version and its routes do not exist; retiring plan versions is unaffected.
A `SubscriptionBundleRepository` of your own needs `listOfVersion` and `moveToVersion`, and a
`SubscriptionUsagePort` of your own `listByIds` — both shipped adapters have them — or a start with
confirmed terms is refused, naming the method. With `versionNotices.includeCron: false`, call
`BundleVersionRetirementService.sendUndelivered(new Date())` and
`BundleRetirementMoveService.moveDue(new Date())` from your scheduler as well.

**What the operator does.** On the add-ons page, the status of a version no longer on sale offers
"Retire…". There is nothing to choose: the replacement is the add-on's version on sale. The preview
shows both versions' list prices — each booking is told the price for its own plan, overrides
included — how many bookings move on which date, and the ones it does not reach and why
(`SC-BUN-039`). The announcement asks for the second factor, and it is refused where the version is
still on sale, the replacement is not or is a version of another add-on, nobody would be reached, a
booking runs at its date, or after it, beside a plan the replacement cannot run beside in its rhythm
— the plan at the date counts a scheduled change and a retirement of the plan version told to take
effect by then, and every plan the subscription is set to move to after it counts too (`SC-BUN-044`)
— or a subscription was told of a retirement — of its plan version or of an add-on version — within
twelve months (`SC-BUN-041`). After the announcement, every plan change asks the replacement too:
the tenant's own change, a plan version's retirement onto another plan and its early switch are
refused where the version a booking continues on could not run beside the plan the subscription
moves to (`SC-BUN-044`): while that date is ahead and the booking is not cancelled yet,
`BUNDLE_REPLACEMENT_DOES_NOT_FIT_TARGET_PLAN`, or
`RETIREMENT_SWITCH_BUNDLE_REPLACEMENT_CANNOT_FOLLOW` for the switch, names that version and its
date, since cancelling it then ends it before the date and the change goes through; otherwise the
refusal names the day the booking can end. A booking that ends by that date, or whose subscription
does, is not asked about it. The add-on's prices follow the plan, as they do for every booking. The
routes are `GET` and `POST /admin/catalog/bundle-versions/:id/retirement` and
`GET /admin/catalog/bundle-version-retirements`. The add-on page shows beside the retired version
how far its retirement has come (`SC-BUN-053`), and of the bookings not told yet why each notice
waits (`SC-BUN-052`). The add-on cannot be deleted while bookings still move onto one of its
versions: `BUNDLE_DELETE_WHILE_RETIREMENT_MOVES_PENDING` says how many (`SC-BUN-051`).

**When it takes effect.** At the first end of the booking's own period — in the rhythm the booking
is billed in — at least three calendar months after its notice reached an administrator; a booking
without a period of its own counts the plan's (`SC-BUN-040`). Until that day the booking may be
cancelled without its minimum term, and the cancellation lands at the end of the period running
(`SC-BUN-045`). A booking cancelled to end by its date is not reached, and it is not reactivated on
the retired version: `BUNDLE_RETIREMENT_REINSTATE_REFUSED` names the version to book and the day it
can be booked from: the one the cancelled booking ends on, or the next where it ends during one
(`SC-BUN-048`). Where the subscription ends by then as well,
`BUNDLE_RETIREMENT_REINSTATE_SUBSCRIPTION_ENDS` says so instead, and where that version cannot run
beside the plan the subscription is on then, or one it is set to move to after it,
`BUNDLE_RETIREMENT_REINSTATE_REPLACEMENT_CANNOT_RUN` does. A booking whose cancellation has landed
is answered by the booking route, as any other. A booking a retirement reached and then cancelled to
end by its date — or whose subscription was — no longer shows the retirement. At its date, the
quarter-hour run moves the booking onto the replacement, keeping its period, its terms and its
rhythm, and binds the replacement whatever its sale by then (`SC-BUN-049`, `SC-BUN-051`). The move
writes the contract with the booking's line on the replacement, marked with the retirement, and the
charge journal charges the booking's periods from the date from that line only, however late the
move came; where that contract cannot be written, the booking goes back and the next run makes both
(`SC-BUN-050`). A booking that has ended by the time a run comes, or whose subscription has, is not
moved, even past its date: it ran on the retired version until it ended, its periods from the date
are charged at that version, and the run asks the journal for them once. Each move is audited as
`BUNDLE_VERSION_RETIREMENT_MOVE` by the actor `job:platform:add-on-retirement-moves`, and one that
cannot be made once as `BUNDLE_VERSION_RETIREMENT_MOVE_FAILED`. Your
`ContractFreezeSourcePort.loadBookedBundles` sees the moved booking on the replacement and prices
that version for the plan, as it does any booking; a contract it hands no line for the replacement
is refused, and the booking goes back.

**Switching early.** Until its date, the add-on's notice — in the plan section and on
`MySubscriptionBundlesPage` — offers the switch to the replacement (`SC-BUN-054`,
`POST /billing/subscription-bundles/:id/retirement/switch`, for the tenant's administrators, naming
the version the page showed). It takes effect at once and keeps the booking, its period, its terms
and its rhythm; its contract marks the add-on's line as the move's does, so the run at the date
finds nothing left to do. Where the replacement costs more for the plan the add-on runs beside, in
the booking's rhythm, the subscription goes on paying what it paid until the date: the contract
records the difference as a discount line "Price of … held until …", taken off each of the booking's
periods before the date (`SC-BUN-055`). The difference is priced from the catalogue for the plan the
subscription is on, so the switch opens only while neither that plan nor its rhythm changes before
the date — by a scheduled change, or by a told retirement onto another plan — and refuses otherwise
with `BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES`. Once agreed, the difference stays: a change of plan
after the switch prices the add-on anew and takes the same difference off. It opens after a trial,
for a booking that runs past the date, and it ends the cancellation without the minimum term, which
rests on the booking being on the version retired. The booking list carries `retirementSwitch` —
what switching now costs, in the rhythm the booking is billed in now — beside `retirement`, null
where the booking may not switch.

**What your port is handed.** One `bundle-version-retired` notice per booking, recorded with the
announcement in one transaction and sent through the same `SubscriptionNoticePort` (`SC-BUN-042`).
It carries the booking (`subscriptionBundleId`), the plan the add-on runs beside at the date
(`planKey`), both versions with their prices for that plan (`retired`, `replacement`, `changes`),
the rhythm the booking is billed in (`billingCycle`), `effectiveAt` and `lastDayToCancel`. A port
that tells the kinds apart has to know this one. As for a plan version, an answer with no recipients
counts as not sent: the retirement waits for its notice, and its date counts from the notice
reaching somebody (`SC-BUN-043`). A notice that waited is sent only while the replacement can run
beside every plan the booking would meet from its date (`SC-BUN-044`). The tenant's plan section and
`MySubscriptionBundlesPage` show the same notice beside the add-on, which the booking list carries
as `retirement` (`SC-BUN-046`).

**The reminder.** 14 days before a booking's date, the quarter-hour run reminds it once where
staying put costs it something (`SC-BUN-056`): the replacement takes a feature away or lowers a
quota, or is dearer for the plan the add-on runs beside at the date, in the rhythm the booking is
billed in then — or not sold in it. Your port is handed a `bundle-version-retirement-reminder`: the
notice again, with both versions priced as the catalogue holds them for that plan when it is sent,
and `switchTerms`, what switching now costs (null where the booking may not switch). A port that
tells the kinds apart has to know this one too. A booking that switched, that has declared a
cancellation, whose subscription ends by the date, or whose notice reached nobody is not reminded —
one whose subscription ends after the date can still cancel or switch, and is; an answer with no
recipients counts as sent, and the reminder is not tried again. The add-on page counts the bookings
reminded beside each retired version. An application that runs the steps from a scheduler of its own
calls `BundleRetirementReminderService.remindDue` beside the others.

## Offering a Newer Add-on Version

A booking keeps the add-on version it was made on, and a newer one of the same add-on sits beside the
booking as an offer (`SC-BUN-057`), in the plan section and on `MySubscriptionBundlesPage`: both
versions side by side, priced for the plan the subscription is on, the kind of offer, and when a
switch taken now would take effect. The kind follows the plan's rule, judged with the price in the
rhythm the booking is billed in and no other. Nothing is configured for it: tenant billing offers it
wherever it reads the bookings (`persistence.entitlement.subscriptionBundleRepository`), and the
booking list carries it as `offer`, null where there is none the booking could take — while the
plan or its rhythm is set to change, while a switch is scheduled, for an add-on in
`selfServiceBlockedBundles`, or where the version cannot run beside the plan in the booking's
rhythm. Beside a retirement told for the version booked, the replacement is left to the early
switch, which holds the price, and nothing that takes something away is offered until the move has
been made; a newer version that applies at once stands beside the notice. A booking that ends by
the retirement's date is not reached by it and is offered as any other; in a trial, the replacement
waits for the trial to end, as the early switch does.

**Taking it.** `POST /billing/subscription-bundles/:id/version-offer/accept` with the version the
page showed (`{ bundleVersionId }`), for the tenant's administrators, audited as
`SWITCH_ADD_ON_VERSION` or `SCHEDULE_ADD_ON_VERSION_SWITCH` (`SC-BUN-058`). An improvement and more
for more apply at once and keep the booking's period, terms, rhythm and minimum term; the contract
the switch writes marks the booking's new line (`metadata.addOnSwitch`), and where the new version
is dearer in the booking's rhythm the journal charges the prorated difference for the rest of the
booking's period, as an entry of origin `bundleChange`, and nothing where it is not. A switch whose
contract cannot be written is put back and refused. In a trial the booking moves and nothing is
charged. A version that takes something away is scheduled for the end of the booking's running term
— the later of its period end and its minimum term, never after the subscription ends — and the
booking carries it as `pendingBundleVersionId`, `pendingVersionEffectiveAt` and, in the list,
`pendingVersion`. A version named that is no longer the one offered is refused with
`BUNDLE_VERSION_OFFER_CHANGED` and the offer as it stands.

**The switch at the end of the term.** The quarter-hour run makes every scheduled switch whose
moment has come (`SC-BUN-059`): it moves the booking, writes its contract, clears the schedule and
audits `BUNDLE_VERSION_SWITCH` by the actor `job:platform:add-on-version-switches`. Until then the
journal charges no period of the booking from that moment; a switch whose contract cannot be
written is put back and recorded once as `BUNDLE_VERSION_SWITCH_FAILED`, and one whose booking or
subscription has ended by the time a run comes is cleared as `BUNDLE_VERSION_SWITCH_LAPSED` — after
the run has asked the journal for the periods the booking ran on past the moment, at the version it
ran on; where the journal cannot record them, the switch stays for the next run to ask again. It
needs the migration `sql/1.0-an-add-on-switch-waits-for-its-term.postgres.sql`, fragments 05 and 11
as they stand, `constraints.postgres.sql` applied after it, and version notices on, whose run makes
the switch: without version notices — or with a `SubscriptionBundleRepository` of your own that
lacks `scheduleVersion`, `unscheduleVersion` and `listScheduledVersionsDue` — a version that takes
something away is not offered, which the start says once in its log. With
`versionNotices.includeCron: false`, call `BundleVersionSwitchRunService.switchDue(new Date())` from
your scheduler after the moves.

**What your port is handed.** With version notices on, one `bundle-version-offered` notice per
booking and version, when the offer appears beside the booking (`SC-BUN-060`): the offer as the
booking list shows it. An application that runs the steps from a scheduler of its own calls
`BundleVersionNoticeService.sendDue(new Date())` beside `VersionNoticeService.sendDue`. A
`SubscriptionBundleRepository` of your own needs `listOfVersion` and a `SubscriptionUsagePort` of your
own `listByIds` for it, or a start with version notices is refused.

**Checkout.** An offer concludes a first contract: `CheckoutOfferService.conclude` refuses a tenant
with a contract in force when the offer's would take effect, or one beginning after it, with
`CHECKOUT_OFFER_CONTRACT_IN_FORCE` (`SC-MKT-028`), and an offer naming another version of an add-on
the tenant has booked with `CHECKOUT_OFFER_ADD_ON_BOOKED_IN_ANOTHER_VERSION` (`SC-MKT-029`).

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
