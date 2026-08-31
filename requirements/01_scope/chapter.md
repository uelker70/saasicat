---
title: The product and its boundary
---

SaaSiCat is a layer inside somebody else's application, not a service they call. This chapter
draws the line: what arrives with the packages, what stays the integrating developer's, and what
SaaSiCat deliberately does not do. A developer evaluating SaaSiCat should be able to answer "will
this fit my application" from this chapter alone.

### SC-SCOPE-001 — SaaSiCat runs inside the integrator's application

🟢 The integrating developer keeps their own database, their own authentication and their own HTTP
stack. SaaSiCat is embedded; it is not hosted, and it does not become the owner of the
application it sits in.

_Source:_ ADR 0007 · `README.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/platform-composition.test.js`
    - the base modules
        - the DB-hydration path builds the catalogue from the sink
        - the app identity comes from the catalogue that is configured
        - an explicit app identity wins over the catalogue
- `packages/nest/tests/saasicat-module.test.js`
    - SaaSiCatModule.forRoot
        - throws when neither planCatalog nor planCatalogReadSink is set
        - quickstart path: planCatalog + 3 adapters are enough
        - Entitlement opt-in: enabled without repos -&gt; error
        - Entitlement active with all repos -&gt; 5 sub-modules
        - accepts empty guards: [] as an explicit choice
        - composes setup, admin stats, checkout offer and subscription contract
        - setup and subscription contract can derive their adapters from persistence
        - the centrally composed optional services resolve in a real Nest container
        - without defaultPlanId & without planResolver: no entitlement stack
        - with defaultPlanId: StaticPlanResolver + Guard + Interceptor auto-registered
        - with quotaProviders: classes become providers + aggregated in the registry token

<!-- END proof -->

### SC-SCOPE-002 — One installation serves one application

🟢 A plan key, a bundle key, a feature key and a quota key are unique for the whole installation.
There is no namespace above them, and retiring a plan does not free its key. Two applications
therefore mean two installations, each with its own database — which is what one subscription per
tenant, installation-wide, has always required anyway.

_Source:_ #236 · `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `tests/a-key-belongs-to-the-installation.test.js`
    - a key belongs to the installation, not to a project
        - the scan reaches the repository
        - the scan reads the shipped DDL, where the column actually lived
        - no tracked file carries the retired identifier without declaring it
        - the rule is not vacuous: it refuses each spelling
        - and it does not refuse a word that merely contains one
        - a declaration excuses the file it is in, and only in its head

<!-- END proof -->

### SC-SCOPE-003 — An installation that does not name its application does not start

🟢 The application's name is what a tenant reads on the sign-in page and what an operator sees in the
administration. An absent name is not a default to fill in: the installation would run identified
by an empty string, and nobody would notice until a customer did.

_Source:_ #236 · `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/platform-configuration-rules.test.js`
    - a catalogue that names no application
        - is a violation of its own, named
        - and so is a blank one, which is the same omission spelled differently
        - a named one passes
        - the DB-hydration path is held to it too
        - and a configuration with no catalogue at all is the other finding, not both
- `packages/ui-vue/tests/login-branding.test.js`
    - resolveLoginBranding — boot values win, app branding fills in
        - a complete boot response is used as-is
        - production is not shown as an environment badge
    - resolveLoginBranding — malformed boot must not take the card down
        - ${name}: falls back instead of throwing
        - without boot and without app branding the card still renders
        - empty strings from boot do not blank the card
    - isProductionBoot — the dev-credentials guard
        - true only for an explicit production environment
        - a malformed payload is not treated as production
        - other environments are not production

<!-- END proof -->

### SC-SCOPE-004 — SaaSiCat does not take payments

🟢 It records what was agreed and what became due. What talks to a bank, a card processor or an
invoice run belongs to the integrating developer, behind an agreed interface. Shipping the
interface and no implementation is what keeps SaaSiCat from becoming a payments product.

_Source:_ #214 · `docs/explanation/capability-to-contract.md`

### SC-SCOPE-005 — Counting usage stays with the application

🟢 For every limit an installation sells, the application answers how much of it a tenant is
currently using. SaaSiCat cannot know that, and does not guess it.

_Source:_ `docs/explanation/capability-to-contract.md`

### SC-SCOPE-006 — Self-registration is a deliberate addition, not part of the standard install

🟢 An installation whose tenants are created by an operator — through the administration, a command,
or the integrator's own form — needs nothing extra. An installation where a stranger with a card
becomes a paying tenant unattended wires that flow itself, and is told so before it starts rather
than three days in.

_Source:_ `docs/guides/self-registration.md`

### SC-SCOPE-007 — The platform is a NestJS application, and a foreign backend mounts it

🟢 The modules SaaSiCat ships are NestJS modules, so an installation runs one whether or not its own
backend is built that way. A developer on another Node framework does not have to move frameworks:
they run the platform standalone and mount it behind what they already have, which is what the
guide on doing so describes and recommends.

What is not offered is a version of the platform without NestJS underneath. Whether that should
exist is an open question, not an oversight.

_Source:_ #175 · `docs/guides/mount-behind-express.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/platform-composition.test.js`
    - every module a composer mounts is also exported
        - with every feature on
        - every declared exception is actually mounted
        - the probe actually mounts something
        - a feature that is off is neither mounted nor exported
    - features are added as composers, not as edits to the assembler
        - the assembler imports no domain module of its own
        - there are composers to speak for
- `packages/nest/tests/saasicat-module.test.js`
    - SaaSiCatModule.forRoot
        - throws when neither planCatalog nor planCatalogReadSink is set
        - quickstart path: planCatalog + 3 adapters are enough
        - Entitlement opt-in: enabled without repos -&gt; error
        - Entitlement active with all repos -&gt; 5 sub-modules
        - accepts empty guards: [] as an explicit choice
        - composes setup, admin stats, checkout offer and subscription contract
        - setup and subscription contract can derive their adapters from persistence
        - the centrally composed optional services resolve in a real Nest container
        - without defaultPlanId & without planResolver: no entitlement stack
        - with defaultPlanId: StaticPlanResolver + Guard + Interceptor auto-registered
        - with quotaProviders: classes become providers + aggregated in the registry token

<!-- END proof -->

### SC-SCOPE-008 — Anything may be built on SaaSiCat except a competitor to it

🟢 Reading it, running it, changing it, redistributing it, and building and selling a SaaS product on
it are all permitted. Providing a product that competes with SaaSiCat, or with a product its
author provides using SaaSiCat, is not. There is no time limit and no reversion.

_Source:_ ADR 0001 · `LICENSE`

### SC-SCOPE-009 — SaaSiCat is source-available and must not be called open source

🟢 The licence is not approved by the Open Source Initiative. Describing the project as open source
is a factual error about its licence, and it is the kind of error that gets repeated.

_Source:_ ADR 0001

<!-- BEGIN proof -->

_Tested by:_

- `tests/license-is-consistent.test.js`
    - every published package ships the same licence as the repository
        - there are packages to check
        - each one has a LICENSE file
        - and it is byte-identical to the one at the root
        - and the license field agrees with the file, everywhere
    - what the docs say about the licence is what the licence says
        - ${file} quotes it verbatim
        - the clause is not trivially short, so the check is not trivially true

<!-- END proof -->

### SC-SCOPE-010 — A published version keeps the licence it was published under

🟢 Rights already granted with a release cannot be withdrawn by a later one. Everything published up
to and including 0.26.1 stays under the earlier permissive licence.

_Source:_ ADR 0001 · release 0.27.0

<!-- BEGIN proof -->

_Tested by:_

- `tests/license-is-consistent.test.js`
    - every published package ships the same licence as the repository
        - there are packages to check
        - each one has a LICENSE file
        - and it is byte-identical to the one at the root
        - and the license field agrees with the file, everywhere
    - what the docs say about the licence is what the licence says
        - ${file} quotes it verbatim
        - the clause is not trivially short, so the check is not trivially true

<!-- END proof -->
