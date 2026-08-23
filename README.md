# SaaSiCat

**From code capability to enforced customer contract.**

**SaaSiCat** connects what your application can do with what customers can
buy and use. Declare capabilities in a [NestJS](https://nestjs.com) app,
discover them automatically, package them into plans and bundles, turn a
purchase into an immutable contract, and enforce that contract on every
request.

It runs inside your application. You keep your database, authentication and
HTTP stack.

> **Status: 0.x — early.**
> The API is **not yet stable** and may change between minor releases.
> SaaSiCat was extracted from a production system powering two commercial SaaS products — the code is battle-tested, the public packaging is new.

## The product loop

| Step               | What happens                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **1. Capability**  | Your code declares a concrete capability or quota with `@ImplementsCapability(...)` and `@DefinesQuota(...)`.              |
| **2. Discovery**   | SaaSiCat scans those declarations at boot and presents new entries for review. No second feature list to maintain.         |
| **3. Packaging**   | Accepted features and quotas become plans, bundles, prices and public catalog entries. Published versions stay fixed.      |
| **4. Contract**    | Checkout freezes the selected offer into an immutable customer contract. Later catalog edits do not rewrite what was sold. |
| **5. Enforcement** | `@RequireFeature(...)` and `@EnforceQuota(...)` apply the active contract at runtime with structured, predictable errors.  |

Read the full [capability-to-contract guide](docs/capability-to-contract.md)
or run the [NotesApp reference implementation](examples/notesapp/).

## What you get around the loop

- **Versioned plans and bundles** with drafts, publishing and immutable sold
  versions.
- **A public marketing catalog** with translated labels, highlights, prices
  and promotions for your pricing page.
- **Runtime feature and quota checks** with optional upgrade offers in denied
  responses.
- **Billing lifecycle hooks, checkout offers, contracts and promo codes** with
  payment-provider connections behind integration ports today and built-in
  provider integration planned.
- **A ready-to-use SuperAdmin UI** for discovery, catalog, plans, contracts,
  tenants and audit.
- **Operational building blocks** including tenant administration, TOTP MFA,
  audit logging, first-run setup and CLI checks.

With the canonical Prisma schema, your application owns only what SaaSiCat
cannot know: authentication, product capabilities, quota counters, its tenant
model and custom UI contributions. Custom schemas can still replace any port.

## Packages

| Package                         | Purpose                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@saasicat/spec`                | The language-neutral contract: OpenAPI, JSON Schemas, Prisma fragments, CLI conventions.                                                                                                                               |
| `@saasicat/core`                | The contract both sides share: DTO types — generated from the spec schemas where the spec defines a payload — plus the runtime rules backend and admin UI must agree on (plan diffing, promo evaluation, error codes). |
| `@saasicat/nest`                | The backend core: NestJS modules, services, guards and decorators.                                                                                                                                                     |
| `@saasicat/adapter-prisma`      | The Prisma + PostgreSQL persistence adapter: `prismaPersistence()` bundle plus individual adapters for every shipped port, targeting the canonical schema.                                                             |
| `@saasicat/adapter-drizzle`     | The Drizzle + PostgreSQL persistence adapter for the core slices, verified by the shared persistence contract.                                                                                                         |
| `@saasicat/persistence-testing` | Executable persistence contract — the node:test suite every adapter must pass against a real database (locks, rollback, atomic promo claims, …).                                                                       |
| `@saasicat/cli`                 | nest-commander command flows to embed in your application CLI.                                                                                                                                                         |
| `@saasicat/ui-vue`              | Vue 3 + Quasar SuperAdmin pages, Pinia stores and composables.                                                                                                                                                         |
| `@saasicat/ui-vue-tenant`       | Vue 3 components for the tenant-facing side: plan section, plan-change wizard, onboarding configurator and bundle store, rendered inside your own application.                                                         |
| `create-saasicat-admin`         | Scaffolder — `pnpm create saasicat-admin` produces a ready-to-run admin frontend.                                                                                                                                      |
| `saasicat`                      | Pointer package — it reserves the unscoped name, holds no code, and points at the one of these you actually want.                                                                                                      |

All packages are released in lockstep and share one version number.

## Architecture in three lines

SaaSiCat is **embeddable, not hosted**: your application keeps its own
database, authentication and HTTP stack. SaaSiCat provides the product loop
from discovery to enforcement and defines narrow **ports** for persistence,
MFA, audit, RLS bypass and plan resolution. Prisma provides the complete
standard bundle; Drizzle currently provides the core persistence slices.

The standard Prisma path is one composition:

```ts
SaaSiCatModule.forRoot(
    defineSaaSiCat({
        planCatalog,
        controller: { guards: [JwtAuthGuard] },
        imports: [AuthModule, PrismaModule],
        persistence: prismaPersistence({
            client: PrismaService,
            adminResources: { tenantMetrics: ['users'] },
        }),
        entitlement: {},
        catalog: { featureUiRegistry },
        tenantBilling: { authGuards: [JwtAuthGuard, TenantGuard] },
        subscriptionBundles: true,
        adminResources: true,
        promoCodes: true,
        quotaProviders: [UsersQuotaProvider],
        tenantManifest: true,
    }),
);
```

The low-level modules and individual adapter ports remain available for
custom schemas or product rules.

## Reference implementation

[`examples/notesapp`](examples/notesapp/) is a small runnable NestJS app that
shows the complete loop: code-declared capabilities, discovery output,
Starter and Pro packaging, tenant entitlements and verified 402/403
enforcement. Its complete SuperAdmin UI remains enabled, including discovery,
catalog, plans, bundles, tenants, users, audit, subscriptions and promo-code
CRUD. Start there if you prefer reading code over docs.

## Getting started

Add the backend packages to an existing multi-tenant NestJS app (Prisma + PostgreSQL + JWT auth):

```bash
pnpm add @saasicat/nest @saasicat/core @saasicat/spec \
         @saasicat/adapter-prisma @saasicat/cli
```

Scaffold the SuperAdmin frontend in one command:

```bash
pnpm create saasicat-admin admin --project-key=myapp --brand-name=MyApp
```

Then follow the **[quickstart](docs/quickstart.md)** — 10 steps from an
existing CRUD backend to a discovered, packaged and enforced feature in about
30 minutes and under 100 lines of app-owned code. The
[handbook](docs/handbook.md) is the in-depth reference behind it, and the
[design guide](docs/design-guide.md) is what you read before writing an admin
page of your own: the page recipe, the colour roles, the scales and the dark
theme that comes with them. Coming from a 0.x release? [Migrating to 1.0](docs/migrating-to-1.0.md) is one
command and a table of what changed.

> The Admin UI ships German and English messages; users switch in the header.
> Apps choose which of them to offer and can add languages of their own — the
> platform brings no domain vocabulary. APIs, error codes and documentation use
> English.

## Requirements

- Node.js ≥ 24, pnpm
- NestJS 11 backend; Prisma + PostgreSQL for the ready-made adapters (other stacks via custom port adapters)
- Vue 3 + Quasar + Vite for the admin frontend

## Contributing

Issues and pull requests are welcome at [github.com/uelker70/saasicat](https://github.com/uelker70/saasicat). Packages are published under the [@saasicat](https://www.npmjs.com/org/saasicat) scope on npm.

## License

[PolyForm Shield 1.0.0](LICENSE) — source-available, not OSI open source.

Reading, running, changing and redistributing it are all permitted, as is building and
selling your own SaaS on top of it. The restriction is one sentence, and it is quoted
here rather than summarised so that nothing is lost on the way:

> Any purpose is a permitted purpose, except for providing any product that competes with the software or any product the licensor or any of its affiliates provides using the software.

Note the second half: it covers the applications the author builds with SaaSiCat, not
only SaaSiCat itself.

Versions up to and including 0.26.1 were published under Apache-2.0 and stay under it.
