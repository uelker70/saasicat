# SaaSiCat Stakeholder Requirements

This document collects what SaaSiCat promises the people who meet it. Each entry says what holds,
not how it is built. Where a requirement has a reason that is not obvious from the requirement
itself, that reason is written beside it — it is usually the part that would otherwise stay in a
closed issue.

Three documents divide the work between them. `CONTRIBUTING.md` is the
working agreement: how to build, test, version and release. The architecture decision records
under `docs/explanation/adr/` record structural decisions with their alternatives and
consequences. This document is the product one: what SaaSiCat does, what it refuses to do, and
which properties it holds itself to while doing it. Where it and `CONTRIBUTING.md` overlap,
`CONTRIBUTING.md` governs how the work is done and this document governs what the result has to
be.

## Who this is written for

Three roles run through every chapter, and a requirement is written from the side of whichever one
it happens to. Naming them here is not decoration: the same behaviour looks like a promise to one
of them and like an obligation to another, and an entry that does not say which it means has not
said anything.

- **The tenant** — a customer of the application SaaSiCat is built into. They choose a plan, book
  and cancel add-ons, are charged, and live with what they agreed to. They never see SaaSiCat by
  name. Where a chapter is written from the selling side, the same party is called the **customer**;
  it is one role seen from two directions, not two roles.
- **The operator** — whoever runs the installation. They maintain plans, set prices, publish
  versions, issue promotional codes and answer for all of it afterwards, sometimes long afterwards.
  In the administration surface they hold the platform administrator's account.
- **The integrating developer** — whoever builds SaaSiCat into their own application. They keep
  their own database, their own authentication and their own HTTP stack, and they rely on this
  behaving a particular way. Requirements addressed to them are the ones whose breach shows up in
  somebody else's product.

## How an entry is built

Every requirement carries an identifier of the form `SC-<CHAPTER>-<NNN>`, numbered from `001`
within its chapter. Under the heading stands the promise, and under that the `_Source:_` line
naming where the decision came from — an issue number, an architecture decision record, a document
in this repository, or the release the behaviour arrived in. Where the promise is complete in its
heading, there is nothing between the two, and where its reason is not obvious that reason is the
most valuable part of the entry.

## What state an entry is in

An entry says one of four things, and which one it says decides what a reader may do with it. The
question behind the table is always the same: **may somebody rely on this?**

| State                         | Opens with                                     | May somebody rely on it?                |
| ----------------------------- | ---------------------------------------------- | --------------------------------------- |
| 🟢 Current                    | `🟢`                                           | Yes                                     |
| 🟡 Decided, not yet delivered | `🟡 _(Decided, not yet delivered.)_`           | It is settled, and it is not true yet   |
| ⚪ Draft                      | `⚪ _(Draft since YYYY-MM-DD.)_`               | No — not decided, and it may not happen |
| 🔵 Superseded                 | ``🔵 _(Superseded on YYYY-MM-DD by `SC-…`.)_`` | No — follow the successor it names      |
| 🔴 Withdrawn                  | `🔴 _(Withdrawn on YYYY-MM-DD.)_`              | No, and nothing replaces it             |

**Every entry opens with exactly one of these**, the ordinary case included. Marking only the
exceptions would be quieter, and it would mean the ordinary state is read out of a blank — and a
state read out of a blank is a state nobody checked. That is not theory: a marker wrapped across a
line break went a day unnoticed here, and two requirements counted as promises the product keeps
while nothing anywhere said otherwise.

The colour is not the state — the words are, where there are words — and the checker holds the two
together, because a colour is read faster than a sentence and a wrong one misleads whoever trusts
it. Current carries no words because it qualifies nothing: no date, no successor.

Superseded and withdrawn look alike to whoever writes them and not at all alike to whoever reads
them: one hands a reader arriving from an old reference somewhere to go, the other tells them there
is nowhere. That is why they are two states and not one.

A state carries a date because the risk each one runs is time. A draft opened a year ago and never
decided reads exactly like one opened last week, and only one of the two is still somebody's
intention.

Behind the state, an entry may say what a breach of it would cost:

| Mark | What it costs                                        |
| ---- | ---------------------------------------------------- |
| 💰   | Money or law — wrong amounts, wrong dates, wrong tax |
| 🔒   | Tenant separation, access, or somebody's data        |

Most entries carry neither, which is the ordinary case and stays quiet. Three values rather than
five, because a scale nobody can apply is a scale everybody applies differently — and an entry
without a mark is not unassessed, it is ordinary.

Beside its state, an entry that stands may say it is not true yet:

- `🟡 _(Decided, not yet delivered.)_` — the decision is settled and recorded, the implementation is
  not there yet. Only a current entry may say this: a draft is not decided, and a retired one has
  nothing left to deliver. Such entries are listed under the chapter table, because a decision
  nobody can find is a decision that gets taken twice — and because what a product has promised and
  not yet built is a question asked before somebody buys, not while they scroll.

**Identifiers are permanent and a number is never reused.** Somebody outside this repository may
have written one down, and it must never come to mean something other than it did. So a promise is
not edited into a different promise: the entry stays where it is, opens with what became of it, and
the new wording becomes a new entry with the next free number in its chapter.

A correction that leaves the promise intact — a typo, a clearer sentence, a reference following
somebody else's supersession — is made in the entry itself. What decides between the two is whether
what somebody can rely on changes.

Chapters 1 to 16 are functional: what the product does. Chapters 17 to 24 are non-functional: the
properties it has while doing it.

## Chapters and identifiers

| #   | Chapter                                      | Identifiers  | Entries |
| --- | -------------------------------------------- | ------------ | ------- |
| 1   | The product and its boundary                 | `SC-SCOPE-…` | 10      |
| 2   | Capabilities, features and quotas            | `SC-CAT-…`   | 16      |
| 3   | Plans and their versions                     | `SC-PLAN-…`  | 25      |
| 4   | Add-on bundles                               | `SC-BUN-…`   | 33      |
| 5   | Subscriptions, terms and billing periods     | `SC-SUB-…`   | 15      |
| 6   | Changing a plan                              | `SC-CHG-…`   | 18      |
| 7   | Cancelling                                   | `SC-CANC-…`  | 19      |
| 8   | Trials, pilots and negotiated arrangements   | `SC-SPEC-…`  | 9       |
| 9   | Prices, proration, tax and money             | `SC-PRIC-…`  | 21      |
| 10  | What a tenant may do at runtime              | `SC-ENTL-…`  | 21      |
| 11  | Promotional codes                            | `SC-PROMO-…` | 22      |
| 12  | Self-registration                            | `SC-REG-…`   | 20      |
| 13  | The public catalogue, checkout and contracts | `SC-MKT-…`   | 22      |
| 14  | Administration and access to it              | `SC-ADM-…`   | 18      |
| 15  | Working in the interface                     | `SC-UI-…`    | 21      |
| 16  | Configuring and running an installation      | `SC-CFG-…`   | 24      |
| 17  | Accessibility                                | `SC-A11Y-…`  | 12      |
| 18  | Language and wording                         | `SC-LANG-…`  | 13      |
| 19  | Security and keeping tenants apart           | `SC-SEC-…`   | 12      |
| 20  | What is kept, and what is never written down | `SC-PRIV-…`  | 10      |
| 21  | Answering the question afterwards            | `SC-AUD-…`   | 11      |
| 22  | Repeating an operation safely                | `SC-OPS-…`   | 11      |
| 23  | Compatibility and upgrading                  | `SC-COMP-…`  | 15      |
| 24  | Being understandable to a stranger           | `SC-READ-…`  | 8       |

Of 406 entries: 🟢 395 stand today, 🟡 9 decided but not yet delivered, ⚪ 0 drafts, 🔵 2 superseded,
🔴 0 withdrawn.

🟡 **Decided, not yet delivered** — [SC-PLAN-007](#sc-plan-007--publishing-says-what-changed),
[SC-PRIC-018](#sc-pric-018--rounding-happens-once-when-a-charge-is-written),
[SC-PRIC-019](#sc-pric-019--a-tenant-can-see-their-own-account),
[SC-PRIC-020](#sc-pric-020--a-charge-once-written-is-never-edited),
[SC-PRIC-021](#sc-pric-021--an-internal-account-reference-is-never-shown-to-a-customer-as-an-invoice-number),
[SC-CFG-008](#sc-cfg-008--an-operator-can-see-when-the-running-configuration-was-applied-and-from-where),
[SC-CFG-009](#sc-cfg-009--a-configuration-change-is-noticed-and-reported),
[SC-AUD-010](#sc-aud-010--a-charge-names-where-it-came-from-and-which-agreement-line-it-belongs-to),
[SC-AUD-011](#sc-aud-011--a-charge-carries-the-period-it-belongs-to)

🔵 **Superseded** — [SC-ENTL-004](#sc-entl-004--once-a-contract-is-agreed-it-is-the-truth-about-what-the-tenant-may-do),
[SC-MKT-009](#sc-mkt-009--at-most-one-plan-is-marked-as-the-recommended-one)

Generated from `requirements/` — 406 requirements. Do not edit by hand:
`node scripts/requirements/index.mjs --write`.

## 1. The product and its boundary

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

## 2. Capabilities, features and quotas

Before anything can be sold, somebody has to say what the application can do. This chapter covers
the path from a declaration in code to an entry an operator may put in a plan. The point of it is
that there is only ever one list: the code is the source, and the catalogue is a reviewed
projection of it rather than a second thing to keep in step.

### SC-CAT-001 — What the application can do is declared next to the code that does it

🟢 There is no separate spreadsheet or hard-coded feature list to keep in step with the
implementation.

_Source:_ `docs/explanation/capability-to-contract.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/discovery-scanner.test.js`
    - DiscoveryScanner — capability/feature aggregation
        - aggregates capabilities with the same feature into a DiscoveredFeature
        - capabilities without a feature do not end up in feature aggregates
        - snapshot contains no bundles field (bundles only from SuperAdmin UI)

<!-- END proof -->

### SC-CAT-002 — Nothing a developer declares is sold automatically

🟢 New and changed declarations are presented for review. A product owner accepts them into the
catalogue; until then they are visible and not sellable. Discovery is a controlled way to let code
reality into the product, not an automatic one.

_Source:_ `docs/explanation/capability-to-contract.md`

### SC-CAT-003 — Only approved features and quotas may be put in a plan or a bundle

🟢 A key that code declares but nobody has reviewed cannot be sold, and publishing a version that
names one is refused.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-strict-mode.test.js`
    - validatePlanDraft (pure)
        - all present → no warnings
        - unknown feature → PLAN_FEATURE_UNKNOWN
        - unknown quota key → QUOTA_MISSING
        - multiple violations → multiple warnings, sorted by features[]/quotas{}
        - PLAN_FEATURE_UNKNOWN is disjoint from BUNDLE_FEATURE_UNKNOWN
    - PlanVersionsService — strict mode integration
        - warn-only: createDraft with unknown feature → 201 + warnings[]
        - blocking: createDraft with unknown feature → 422
        - blocking: createDraft with unknown quota → 422 with QUOTA_MISSING
        - blocking: all present → 201 + warnings=[]
        - blocking without snapshot source → degrades to warn-only instead of crashing (#25)
        - blocking: marketed-only feature → NO 422 (allowlist)
        - blocking: NON-allowlisted unknown feature → still 422
        - scanner fallback (#25): blocking without token but with DiscoveryScanner enforces
          correctly
        - warn-only without snapshot → no check, warnings=[]
        - blocking: publishPlanVersion runs the strict check on publish too
        - updatePlanDraft in blocking: drift is rejected
- `packages/nest/tests/seed-gate.test.js`
    - validateSeedAgainstSnapshot
        - all seeded features discovered → overall ok
        - plan with an undiscovered feature → PLAN_FEATURE_UNKNOWN + error
        - bundle with an undiscovered feature → BUNDLE_FEATURE_UNKNOWN
        - undiscovered quota → QUOTA_MISSING
        - empty input → ok
        - formatSeedGateReport shows entity + code

<!-- END proof -->

### SC-CAT-004 — A plan may not reference something no code implements

🟢 A feature no code declares and a limit nothing counts cannot be sold. Code is the source of truth
for what exists.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-strict-mode.test.js`
    - validatePlanDraft (pure)
        - all present → no warnings
        - unknown feature → PLAN_FEATURE_UNKNOWN
        - unknown quota key → QUOTA_MISSING
        - multiple violations → multiple warnings, sorted by features[]/quotas{}
        - PLAN_FEATURE_UNKNOWN is disjoint from BUNDLE_FEATURE_UNKNOWN

<!-- END proof -->

### SC-CAT-005 — A marketed non-code feature is the one narrow exception, and is configured explicitly

🟢 Something like a support commitment can be sold without any code implementing it. A feature that
is merely not built yet does not belong there.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-006 — Approval needs a scan to compare against

🟢 An installation that has not yet read its own declarations cannot accept entries into the
catalogue, and says so rather than accepting them blind.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)

<!-- END proof -->

### SC-CAT-007 — A catalogue entry moves along a fixed path

🟢 Discovered, accepted, active, deprecated, retired — or set aside as ignored. A step outside that
order is refused, so the state of an entry always says the same thing to everyone reading it.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)
- `packages/ui-vue/tests/use-discovery.test.js`
    - useDiscovery
        - the endpoint is required — there is no prefix the platform could guess
        - load() adopts the snapshot and remembers the ETag
        - the second load sends the ETag, and a 304 changes nothing
        - reload() drops the ETag, so the server has to answer with a body
        - a failed load lands on `error`, not on a rejection the page has to catch
        - rescan() posts, adopts the new snapshot and accepts 200 as well as 201
        - a failed rescan says rescan, not discovery
        - a client that rejects is reported as it is, not re-wrapped
        - a client that resolves with status 0 never reached the server
        - a client that throws a non-Error still leaves an Error behind
        - autoLoad fetches without being asked

<!-- END proof -->

### SC-CAT-008 — An approved entry whose code definition changes goes back for review

🟢 It flips to outdated by itself rather than continuing to claim an approval that was given for
something else.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)

<!-- END proof -->

### SC-CAT-009 — Bringing a retired entry back is always a person's decision

🟢 The automatic scan at start-up never reactivates one.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)

<!-- END proof -->

### SC-CAT-010 — Labels an operator has written are never overwritten by the scan

🟢 The automatic sync fills empty fields and leaves curated ones alone.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)
- `packages/ui-vue/tests/component/discovery-page-keeps-the-first-edit.test.ts`
    - DiscoveryPage carries a saved translation into the next save
        - the second payload still holds the first edit

<!-- END proof -->

### SC-CAT-011 — Four words with four meanings, kept apart

🟢 A capability is implemented, a feature is marketable, a quota is countable, and a plan or bundle
is sellable. The distinction is what lets an operator repackage the product without a developer,
and a developer refactor the code without repricing anything.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/discovery-scanner.test.js`
    - DiscoveryScanner — capability/feature aggregation
        - aggregates capabilities with the same feature into a DiscoveredFeature
        - capabilities without a feature do not end up in feature aggregates
        - snapshot contains no bundles field (bundles only from SuperAdmin UI)

<!-- END proof -->

### SC-CAT-012 — A new declaration appears for review after the application restarts

🟢 The scan happens when the application starts. An operator who cannot see a colleague's new
capability is waiting for a deployment, not looking in the wrong place.

_Source:_ `docs/guides/wire-the-backend.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-entries-service.test.js`
    - CatalogEntriesService
        - sync creates new capabilities with their code status
        - sync creates new features/quotas as pending
        - a missing capability is retired on sync, a missing feature obsoleted
        - internal capabilities do not appear in the catalog
        - quota without declaredAt → usageProvider null
        - reviewFeature/reviewQuota (#20) › approve persists the approval signature + approvedBy
        - reviewFeature/reviewQuota (#20) › revoking approval (approved → pending) deletes the
          approval fields
        - reviewFeature/reviewQuota (#20) › invalid transition (pending → outdated) is rejected
        - reviewFeature/reviewQuota (#20) › approve without a snapshot is rejected
        - reviewFeature/reviewQuota (#20) › reviewQuota approve uses the quota signature
        - reviewFeature/reviewQuota (#20) › reviewFeature throws on an unknown key
        - drift detection on sync (#20) › approved → outdated when the capability set changes
        - drift detection on sync (#20) › approved stays approved when the signature is stable
        - drift detection on sync (#20) › quota drift: a changed unit flips approved → outdated
        - drift detection on sync (#20) › manual obsolete stays put on sync (no auto-resurrect)
        - drift detection on sync (#20) › a requires change on a capability flips approved →
          outdated (#35)
        - replaced semantics on sync (#39) › a vanished key with a replaces claimant gets
          successorKey + obsolete
        - replaced semantics on sync (#39) › a vanished key without a claimant stays bare obsolete
          (no successorKey)
        - replaced semantics on sync (#39) › a reappearing key loses its successorKey
        - replaced semantics on sync (#39) › quota replaces sets successorKey on the old quota entry
        - replaced semantics on sync (#39) › sync is idempotent: a second run counts no further
          replaced
        - replaced semantics on sync (#39) › repository without setFeatureSuccessor: sync runs
          through without a pointer
        - replaced semantics on sync (#39) › requires/replaces are mirrored into the feature entries
        - setFeatureI18n persists translations
        - onApplicationBootstrap (auto-sync, #12) › syncs the injected snapshot at boot (default on)
        - onApplicationBootstrap (auto-sync, #12) › seeds label/description/icon from the
          FeatureUiRegistry into empty fields (#12)
        - onApplicationBootstrap (auto-sync, #12) › registry does NOT overwrite existing SuperAdmin
          values (#12)
        - onApplicationBootstrap (auto-sync, #12) › seeds label even for an already-existing bare
          row (label==key) (#12)
        - onApplicationBootstrap (auto-sync, #12) › no-op when autoSyncDiscoveryAtBoot=false
        - onApplicationBootstrap (auto-sync, #12) › no-op without an injected snapshot
        - onApplicationBootstrap (auto-sync, #12) › swallows a sync error at boot (no boot crash)
- `packages/nest/tests/discovery-controller.test.js`
    - DiscoveryController — GET /admin/discovery
        - returns the discovery snapshot as the body
        - sets the ETag header with snapshot.hash + scannedAt
        - returns HTTP 304 + null body on an If-None-Match match
        - returns the full snapshot when If-None-Match does not match
        - ignores an empty If-None-Match header

<!-- END proof -->

### SC-CAT-013 — A quota key is named in exactly one place

🟢 The declaration in code. It cannot be introduced in a configuration file, and it cannot contain a
separator that would make it ambiguous where a plan lists it.

_Source:_ release 0.2.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/discovery-scanner.test.js`
    - DiscoveryScanner — Quotas
        - reads @DefinesQuota at the class level
        - cross-references @EnforceQuota on capabilities with the quota

<!-- END proof -->

### SC-CAT-014 — An unsatisfied dependency between features is advice, not a refusal

🟢 A feature that requires another one may have that other one covered by the plan, by a different
bundle, or by something the operator sells separately, and none of that is visible while a draft
is being checked. A bundle naming a plan that does not exist is refused outright, because that one
is decidable.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/discovery-scanner.test.js`
    - DiscoveryScanner — requires/replaces (#35/#39)
        - capability without requires/replaces carries null (default)
        - requires/replaces are deduplicated + sorted through
        - feature aggregation: union of capability requires minus its own featureKey
        - feature aggregation: replaces as union over the capabilities
        - quota carries replaces from @DefinesQuota
        - requires change changes the snapshot hash

<!-- END proof -->

### SC-CAT-015 — A missing scan degrades the check, it does not stop the application

🟢 Where the strictest setting is configured but nothing can be compared against, the installation
warns loudly and keeps running. Crashing there once caused a production outage.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-strict-mode.test.js`
    - PlanVersionsService — strict mode integration
        - blocking without snapshot source → degrades to warn-only instead of crashing (#25)
        - warn-only without snapshot → no check, warnings=[]

<!-- END proof -->

### SC-CAT-016 — The check that runs before a deployment always blocks

🟢 There is no advisory mode in the pre-deployment gate: a violation stops the deployment. The same
check runs before the first write of seeded data.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-strict-mode.test.js`
    - PlanVersionsService — strict mode integration
        - warn-only: createDraft with unknown feature → 201 + warnings[]
        - blocking: createDraft with unknown feature → 422
        - blocking: createDraft with unknown quota → 422 with QUOTA_MISSING
        - blocking: all present → 201 + warnings=[]
        - blocking without snapshot source → degrades to warn-only instead of crashing (#25)
        - blocking: marketed-only feature → NO 422 (allowlist)
        - blocking: NON-allowlisted unknown feature → still 422
        - scanner fallback (#25): blocking without token but with DiscoveryScanner enforces
          correctly
        - warn-only without snapshot → no check, warnings=[]
        - blocking: publishPlanVersion runs the strict check on publish too
        - updatePlanDraft in blocking: drift is rejected
- `packages/nest/tests/preflight.test.js`
    - runPreflight
        - empty catalog → overall=ok, total=0
        - everything present → overall=ok
        - plan with unknown feature → overall=error, kind=plan
        - bundle with unknown feature → kind=bundle, BUNDLE_FEATURE_UNKNOWN
        - findings are deterministically sorted (kind, entityKey, version, code)

<!-- END proof -->

## 3. Plans and their versions

A plan is the thing a customer chooses; a version of it is the offer they actually bought. Almost
every requirement here exists to protect one promise: what a customer was sold does not change
underneath them. That is why a published version freezes once it applies, why a version somebody is
bound to cannot be edited, and why nothing published is ever deleted.

### SC-PLAN-001 — A plan is an identity; a version carries what it costs and includes

🟢 The name a customer recognises stays the same across price changes. What they pay and what they
get belongs to the version they bought.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-helpers.test.js`
    - findPlan returns a plan for a known ID
    - findPlan returns undefined for an unknown ID
    - getPlanOrThrow throws a typed error for an unknown ID
    - getMarketedPlans excludes marketed: false
    - getMarketedPlans treats undefined as marketed=true
    - getPlanPriceNet MONTHLY for a marketed plan
    - getPlanPriceNet YEARLY for a marketed plan
    - getPlanPriceNet for an unknown plan → null
    - getPlanPriceNet for ENTERPRISE (marketed: false) → null
    - getPlanPriceGross MONTHLY = net * 1.19
    - getPlanPriceGross with override vatRate
    - getPlanPriceGross for ENTERPRISE → null
    - getPlanQuota returns a concrete value
    - getPlanQuota returns -1 for unlimited ENTERPRISE quotas
    - getPlanQuota for an unknown plan/key → undefined
    - isFeatureInPlan: true when the feature is directly in the plan
    - isFeatureInPlan: false when the feature is not in the plan
    - isFeatureInPlan: false for an unknown plan
    - getActiveFeatureKeys excludes plannedOnly
    - isFeaturePlannedOnly: true for a declared plannedOnly key
    - isFeaturePlannedOnly: false for a declared production key
    - isFeaturePlannedOnly: false for an unknown key (conservative)
- `packages/nest/tests/plans-service.test.js`
    - PlansService — root operations
        - createPlan + listPlans + getPlan happy path
        - createPlan: duplicate planKey → UnprocessableEntity
        - createPlan: a plan key is taken once for the installation
        - updatePlan changes label + sortOrder
        - updatePlan: NotFound for unknown ID
        - softDeletePlan without versions sets deletedAt + disappears from list
        - softDeletePlan idempotent (second call without throw)
        - softDeletePlan: NotFound for unknown ID
        - softDeletePlan: live version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: superseded version (no live anymore) → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: only draft (nothing published) → allowed
        - hardDeletePlan: without versions → plan is gone from list
        - hardDeletePlan: with draft → 422 PLAN_HAS_DRAFTS
        - hardDeletePlan: with published version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - hardDeletePlan: NotFound for unknown ID
        - listPlans returns every plan of the installation
        - listPlans onlyPublished: only plans with a live version
        - listPlans onlyPublished: superseded version does not count as live

<!-- END proof -->

### SC-PLAN-002 — A plan has at most one unpublished draft at a time

🟢 An operator finishes what they started — publishing or discarding the open draft — before opening
another. Two half-written offers for one plan are a state nobody can explain to a colleague.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — Lifecycle
        - createPlanDraft + listPlanVersions returns v1 with publishedAt=null
        - createPlanDraft: second draft → UnprocessableEntity (max 1 draft)
        - createPlanDraft: unknown plan → NotFound
        - updatePlanDraft: changes features + quotas
        - createPlanDraft: bundles default to [] when not provided
        - createPlanDraft + updatePlanDraft: bundles are persisted
        - updatePlanDraft: published version → UnprocessableEntity
        - publishPlanVersion: first version → publishedAt + nonRegressive=true
        - publishPlanVersion: price 0.00 → 422 PLAN_VERSION_ZERO_PRICE (seed placeholder protection)
        - publishPlanVersion: second version sets previous to supersededAt
        - publishPlanVersion: validFrom must be strictly after predecessor → 422
        - publishPlanVersion: without validFrom → 422 PLAN_VERSION_VALID_FROM_REQUIRED
        - publishPlanVersion: regressive version (feature removed) → 422 without forceRegressive
        - publishPlanVersion: forceRegressive lets regressive version through
        - publishPlanVersion: lowering an installation's own quota → 422
        - publishPlanVersion: raising an installation's own quota publishes
        - publishPlanVersion: forceRegressive lets an own quota's cut through
        - getPlanVersion: NotFound for unknown ID
        - discardPlanDraft: draft → removed, listPlanVersions returns empty list
        - discardPlanDraft: published version → 422 PLAN_VERSION_ALREADY_PUBLISHED
        - discardPlanDraft: NotFound for unknown ID
        - publishPlanVersion: gapless when predecessor has validUntil — successor must start the
          next day
        - terminatePlanVersion: live version gets endsAt set
        - terminatePlanVersion: idempotent — second call overwrites
        - terminatePlanVersion: date in the past → 422 PLAN_TERMINATE_DATE_NOT_FUTURE
        - terminatePlanVersion: draft (publishedAt=null) → 422 PLAN_VERSION_NOT_PUBLISHED
        - terminatePlanVersion: superseded version → 422 PLAN_VERSION_SUPERSEDED
        - terminatePlanVersion: NotFound for unknown ID
        - publishPlanVersion: gapless check not active when predecessor has no validUntil (auto
          succession)
- `packages/nest/tests/version-publish.test.js`
    - assertDraftPublishable
        - accepts a fresh draft
        - null draft → NOT_FOUND
        - published draft → ALREADY_PUBLISHED
        - draft without baseVersionId → NO_BASE_VERSION
- `packages/ui-vue/tests/use-plan-editor.test.js`
    - usePlanEditor — Discovery (availableFeatures)
        - lists all catalog features with correct marker flags
        - featuresByTier groups + sorts by tier order
        - features without tier land in OTHER group at the end
        - manifest without features block: empty but no crash
    - usePlanEditor — toggleFeature
        - toggle add + remove
        - toggle on plannedOnly feature is ignored (no state change)
        - nonRegressive: inherited feature cannot be removed
        - nonRegressive=false: inherited feature may be removed
    - usePlanEditor — validateDraft + snapshot
        - snapshot returns sorted selection
        - validateDraft accepts a clean selection
        - validateDraft throws PlannedOnlyFeatureError when (e.g. via direct set) a plannedOnly key
          is present

<!-- END proof -->

### SC-PLAN-003 — A plan has at most one live version at a time

🟢 Publishing a successor retires its predecessor in the same act, so there is never a moment in
which two versions of one plan are both current and a purchase could land on either.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — Lifecycle
        - createPlanDraft + listPlanVersions returns v1 with publishedAt=null
        - createPlanDraft: second draft → UnprocessableEntity (max 1 draft)
        - createPlanDraft: unknown plan → NotFound
        - updatePlanDraft: changes features + quotas
        - createPlanDraft: bundles default to [] when not provided
        - createPlanDraft + updatePlanDraft: bundles are persisted
        - updatePlanDraft: published version → UnprocessableEntity
        - publishPlanVersion: first version → publishedAt + nonRegressive=true
        - publishPlanVersion: price 0.00 → 422 PLAN_VERSION_ZERO_PRICE (seed placeholder protection)
        - publishPlanVersion: second version sets previous to supersededAt
        - publishPlanVersion: validFrom must be strictly after predecessor → 422
        - publishPlanVersion: without validFrom → 422 PLAN_VERSION_VALID_FROM_REQUIRED
        - publishPlanVersion: regressive version (feature removed) → 422 without forceRegressive
        - publishPlanVersion: forceRegressive lets regressive version through
        - publishPlanVersion: lowering an installation's own quota → 422
        - publishPlanVersion: raising an installation's own quota publishes
        - publishPlanVersion: forceRegressive lets an own quota's cut through
        - getPlanVersion: NotFound for unknown ID
        - discardPlanDraft: draft → removed, listPlanVersions returns empty list
        - discardPlanDraft: published version → 422 PLAN_VERSION_ALREADY_PUBLISHED
        - discardPlanDraft: NotFound for unknown ID
        - publishPlanVersion: gapless when predecessor has validUntil — successor must start the
          next day
        - terminatePlanVersion: live version gets endsAt set
        - terminatePlanVersion: idempotent — second call overwrites
        - terminatePlanVersion: date in the past → 422 PLAN_TERMINATE_DATE_NOT_FUTURE
        - terminatePlanVersion: draft (publishedAt=null) → 422 PLAN_VERSION_NOT_PUBLISHED
        - terminatePlanVersion: superseded version → 422 PLAN_VERSION_SUPERSEDED
        - terminatePlanVersion: NotFound for unknown ID
        - publishPlanVersion: gapless check not active when predecessor has no validUntil (auto
          succession)

<!-- END proof -->

### SC-PLAN-004 — A published version is never deleted

🟢 A customer bound to a retired version keeps being served and billed by it. That is the whole
reason versions exist, and it is why removing one is not an option even when it is old. Discarding
is refused the moment a version is published — unlike rewriting it, which SC-PLAN-005 leaves open
in one narrow case.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/a-catalogue-remembers-its-versions.integration.test.js`
    - discarding a draft
        - a published version is refused — it is what somebody may have booked

<!-- END proof -->

### SC-PLAN-005 — A version somebody has already bought cannot be edited

🟢 💰 Only a draft can be changed, or a published version that is the newest of its line, has nobody
on it, and does not start until some day in the future.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/version-editability.test.js`
    - isVersionEditable
        - drafts remain editable
        - published-but-future is only editable when latest-in-chain without a subscription
        - subscriptionCount undefined blocks fail-closed
        - referenced versions remain frozen
        - non-latest, superseded and already-active versions remain frozen
- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — Lifecycle
        - createPlanDraft + listPlanVersions returns v1 with publishedAt=null
        - createPlanDraft: second draft → UnprocessableEntity (max 1 draft)
        - createPlanDraft: unknown plan → NotFound
        - updatePlanDraft: changes features + quotas
        - createPlanDraft: bundles default to [] when not provided
        - createPlanDraft + updatePlanDraft: bundles are persisted
        - updatePlanDraft: published version → UnprocessableEntity
        - publishPlanVersion: first version → publishedAt + nonRegressive=true
        - publishPlanVersion: price 0.00 → 422 PLAN_VERSION_ZERO_PRICE (seed placeholder protection)
        - publishPlanVersion: second version sets previous to supersededAt
        - publishPlanVersion: validFrom must be strictly after predecessor → 422
        - publishPlanVersion: without validFrom → 422 PLAN_VERSION_VALID_FROM_REQUIRED
        - publishPlanVersion: regressive version (feature removed) → 422 without forceRegressive
        - publishPlanVersion: forceRegressive lets regressive version through
        - publishPlanVersion: lowering an installation's own quota → 422
        - publishPlanVersion: raising an installation's own quota publishes
        - publishPlanVersion: forceRegressive lets an own quota's cut through
        - getPlanVersion: NotFound for unknown ID
        - discardPlanDraft: draft → removed, listPlanVersions returns empty list
        - discardPlanDraft: published version → 422 PLAN_VERSION_ALREADY_PUBLISHED
        - discardPlanDraft: NotFound for unknown ID
        - publishPlanVersion: gapless when predecessor has validUntil — successor must start the
          next day
        - terminatePlanVersion: live version gets endsAt set
        - terminatePlanVersion: idempotent — second call overwrites
        - terminatePlanVersion: date in the past → 422 PLAN_TERMINATE_DATE_NOT_FUTURE
        - terminatePlanVersion: draft (publishedAt=null) → 422 PLAN_VERSION_NOT_PUBLISHED
        - terminatePlanVersion: superseded version → 422 PLAN_VERSION_SUPERSEDED
        - terminatePlanVersion: NotFound for unknown ID
        - publishPlanVersion: gapless check not active when predecessor has no validUntil (auto
          succession)

<!-- END proof -->

### SC-PLAN-006 — Where it cannot be established that nobody is on a version, it stays frozen

🟢 The uncertain case is treated as the dangerous one, so a version is never opened for editing on
the assumption that it is unsold.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/version-editability.test.js`
    - isVersionEditable
        - drafts remain editable
        - published-but-future is only editable when latest-in-chain without a subscription
        - subscriptionCount undefined blocks fail-closed
        - referenced versions remain frozen
        - non-latest, superseded and already-active versions remain frozen
- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — published-but-future editing (Pack 2c)
        - updatePlanDraft allows published-but-future version (latest, 0 subs)
        - updatePlanDraft blocks published-but-future version with subscription
        - updatePlanDraft blocks published version that is not latest-in-chain
        - listPlanVersions annotates isLatestInChain + subscriptionCount on the latest version
        - updatePlanDraft fail-closed without SubscriptionRepository

<!-- END proof -->

### SC-PLAN-007 — Publishing says what changed

🟡 _(Decided, not yet delivered.)_ A version is published with a note describing the change, and an
empty note is refused, because the note is what an operator reads a year later when a customer asks
why their price moved. Today the note is optional in the publish interface and a version carrying
none publishes.

_Source:_ current practice

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-publish.test.js`
    - assertChangeNote
        - accepts a non-empty note (trimmed)
        - rejects an empty note
        - rejects null/undefined
        - rejects whitespace-only

<!-- END proof -->

### SC-PLAN-008 — A price of exactly zero has to be meant

🟢 💰 Publishing a plan version priced at zero is refused unless the operator says explicitly that it
is deliberate. An accidental batch publish at 0.00 once set every tariff to free.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-publish-controller.test.js`
    - PlanVersions.publish passes allowZeroPrice through to the service (#63)
    - PlanVersions.publish: allowZeroPrice stays undefined without the DTO flag
    - BundleVersions.publish passes allowZeroPrice through to the service (#63)
    - BundleVersions.publish: allowZeroPrice stays undefined without the DTO flag

<!-- END proof -->

### SC-PLAN-009 — Publishing something that takes away has to be confirmed

🟢 A version that removes a feature, raises a price or lowers one of the three quotas SC-PLAN-025
names is a change existing customers feel. It publishes only on an explicit confirmation, so it is
never the outcome of a mis-click.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-diff.test.js`
    - classifyPlanDiff — identical versions → no changes, nonRegressive=true
    - classifyPlanDiff — price increase → REGRESSION
    - classifyPlanDiff — price decrease → IMPROVEMENT
    - classifyPlanDiff — feature removed → REGRESSION
    - classifyPlanDiff — feature added → IMPROVEMENT
    - classifyPlanDiff — mixed: 1 improvement + 1 regression → nonRegressive=false
    - classifyPlanDiff — Decimal-like object with toNumber() accepted
    - classifyPlanDiff — quotas
        - a version with no quotas at all → no quota changes
        - limit increase → IMPROVEMENT, nonRegressive=true
        - limit decrease → REGRESSION, nonRegressive=false
        - an installation's own quota lowered → REGRESSION
        - an installation's own quota raised → IMPROVEMENT
        - a quota the successor drops counts as 0 → REGRESSION
        - a quota the successor adds counts from 0 → IMPROVEMENT
        - unlimited replaced by a finite number → REGRESSION
        - a key that names something on Object.prototype is still read as a quota
        - and dropping one is a regression like any other
        - a value written as a string is read as the number it is
        - the same allowance written twice is not a change
        - "-1" is unlimited, and losing it is a regression
        - a value nothing can read is not evidence of an improvement
        - and it reaches the record as what it was, not as nothing
        - every change survives the round trip through a JSON column
        - a number too large to be one is a regression, not the best offer ever
        - a finite number replaced by unlimited → IMPROVEMENT
- `packages/nest/tests/version-publish.test.js`
    - assertDraftPublishable
        - accepts a fresh draft
        - null draft → NOT_FOUND
        - published draft → ALREADY_PUBLISHED
        - draft without baseVersionId → NO_BASE_VERSION

<!-- END proof -->

### SC-PLAN-010 — One regressive change makes the whole version regressive

🟢 A version that improves nine things and lowers one is treated as a change customers feel, because
one of them will.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-diff.test.js`
    - classifyPlanDiff — identical versions → no changes, nonRegressive=true
    - classifyPlanDiff — price increase → REGRESSION
    - classifyPlanDiff — price decrease → IMPROVEMENT
    - classifyPlanDiff — feature removed → REGRESSION
    - classifyPlanDiff — feature added → IMPROVEMENT
    - classifyPlanDiff — mixed: 1 improvement + 1 regression → nonRegressive=false
    - classifyPlanDiff — Decimal-like object with toNumber() accepted
    - classifyPlanDiff — quotas
        - a version with no quotas at all → no quota changes
        - limit increase → IMPROVEMENT, nonRegressive=true
        - limit decrease → REGRESSION, nonRegressive=false
        - an installation's own quota lowered → REGRESSION
        - an installation's own quota raised → IMPROVEMENT
        - a quota the successor drops counts as 0 → REGRESSION
        - a quota the successor adds counts from 0 → IMPROVEMENT
        - unlimited replaced by a finite number → REGRESSION
        - a key that names something on Object.prototype is still read as a quota
        - and dropping one is a regression like any other
        - a value written as a string is read as the number it is
        - the same allowance written twice is not a change
        - "-1" is unlimited, and losing it is a regression
        - a value nothing can read is not evidence of an improvement
        - and it reaches the record as what it was, not as nothing
        - every change survives the round trip through a JSON column
        - a number too large to be one is a regression, not the best offer ever
        - a finite number replaced by unlimited → IMPROVEMENT

<!-- END proof -->

### SC-PLAN-025 — Every quota a version carries counts as a limit that can be lowered

🟢 Not only the three keys the platform once knew by name: which quotas exist is the installation's
decision, and one of its own being lowered is the same event to the customer it belongs to.
Add-on versions are compared the same way.

_Source:_ current practice

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-quota-is-read-one-way.test.js`
    - a quota is read the same way everywhere
        - a number is itself
        - a number written as a string is that number
        - anything that is not a finite number reads as nothing
        - and so does a number too large to be one
        - a record reads what it can and keeps the rest as uncountable
        - a declared quota stays declared, whatever it says
        - and what it reads survives a round trip through a JSON column
        - and anything that is not a record reads as an empty one
        - a key inherited from the prototype is not a quota
- `packages/nest/tests/a-quota-arrives-as-a-number.test.js`
    - a quota arrives as a number or it does not arrive
        - integers are accepted, and so is -1 for unlimited
        - an empty record is accepted — a version may carry no quota at all
        - a numeric string is refused, and the message names the key
        - "-1" is refused too — it is the value that would lock a tenant out
        - a fraction, a negative below -1, null and a nested object are refused
        - an array is not a quota record
        - the update DTO holds the same line, and leaving quotas out is still allowed
        - an add-on version is held to it as well — it is the same comparison
- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — Lifecycle
        - publishPlanVersion: lowering an installation's own quota → 422
        - publishPlanVersion: raising an installation's own quota publishes
        - publishPlanVersion: forceRegressive lets an own quota's cut through
- `packages/nest/tests/version-diff.test.js`
    - classifyPlanDiff — quotas
        - a version with no quotas at all → no quota changes
        - limit increase → IMPROVEMENT, nonRegressive=true
        - limit decrease → REGRESSION, nonRegressive=false
        - an installation's own quota lowered → REGRESSION
        - an installation's own quota raised → IMPROVEMENT
        - a quota the successor drops counts as 0 → REGRESSION
        - a quota the successor adds counts from 0 → IMPROVEMENT
        - unlimited replaced by a finite number → REGRESSION
        - a key that names something on Object.prototype is still read as a quota
        - and dropping one is a regression like any other
        - a value written as a string is read as the number it is
        - the same allowance written twice is not a change
        - "-1" is unlimited, and losing it is a regression
        - a value nothing can read is not evidence of an improvement
        - and it reaches the record as what it was, not as nothing
        - every change survives the round trip through a JSON column
        - a number too large to be one is a regression, not the best offer ever
        - a finite number replaced by unlimited → IMPROVEMENT

<!-- END proof -->

### SC-PLAN-011 — A published version says which day it applies from

🟢 Each successor starts strictly after the one before it, so for any given day there is exactly one
answer to "what was on offer".

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/a-bundle-version-has-a-window.integration.test.js`
    - two versions inside the same moment
        - the one whose window opened later wins
        - a version with no window at all loses to one that has a window it is inside
        - a closed window is excluded even when it is the later one
    - the edges of one window
        - a version is active throughout its last day, and not the next
        - a version is not active before its window opens
        - a bundle with no published version at all answers null, not an error
    - an adapter that does not promise windows
        - does not offer the method, rather than answering from columns it ignores
        - and hands back no window on a version that has one stored
- `packages/core/tests/active-plan-version-query.test.js`
    - buildActivePlanVersionWhere
        - requires publishedAt IS NOT NULL
        - tolerates validFrom IS NULL ("valid since forever") alongside validFrom &lt;= asOf
        - validUntil day-inclusive: &gt;= startOfDay(asOf), not &gt; asOf
        - startOfUtcDay normalizes to 00:00 UTC
        - without withEndsAt: no endsAt clause (CatalogPlanVersion)
        - withEndsAt: adds an endsAt clause (PlanVersion)
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Plans (validFrom tolerance)
        - live plan version with validFrom=NULL appears in the catalog
        - findActivePlanVersion returns the NULL-validFrom version when it is the only live one
        - dated version wins over NULL-validFrom (fallback, not an override)
- `packages/nest/tests/validity-window.test.js`
    - the window a version is published with
        - the publish call wins over the draft for the start
        - the draft carries the start when the call does not
        - an explicit null end means unbounded, not "ask the draft"
        - a silent call still takes the draft’s end
- `packages/ui-vue/tests/newly-published-composables.test.js`
    - the barrels publish all four
        - every one of them arrived
    - attachCause
        - it attaches a cause without the ES2022 constructor option
        - it returns the same error rather than a copy
        - the property stays writable, the way the native one is
    - useMfaPrompt
        - a prompt opens the dialog and waits
        - a second prompt settles the first instead of stranding it
        - closing answers the caller with null
    - the plan wizard state
        - a provided state reaches a descendant
        - without a provider it hands back a fresh, unshared one
        - reset empties the draft
    - useSignOut
        - it ends the session and then goes to the login page
        - a rejecting logout still leaves the protected page
        - with no adapter it navigates anyway
        - the manifest cache is cleared whether or not an adapter ran

<!-- END proof -->

### SC-PLAN-012 — There is no gap and no overlap between two versions of a plan

🟢 Where a version states the last day it is valid, its successor starts the next day. A day on which
a plan exists but has no offer is refused rather than discovered by the first customer to land on
it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/validity-window.test.js`
    - the window a version is published with
        - the publish call wins over the draft for the start
        - the draft carries the start when the call does not
        - an explicit null end means unbounded, not "ask the draft"
        - a silent call still takes the draft’s end
- `packages/ui-vue/tests/version-maps.test.js`
    - useLivePlanVersions
        - the endpoint and the plan list are both required
        - an empty plan list asks nothing
        - the live version is the newest published one that was not superseded
        - two versions activated on the same day are ordered by version number
        - a plan with no published version maps to null, not to a missing key
        - one failing plan does not blank the others
        - an unreadable body is treated as no versions
        - a changed plan list reloads on its own; an unchanged one does not
    - useBundleVersionsMap
        - the endpoint and the bundle list are both required
        - an empty bundle list asks nothing and holds an empty mapping
        - every bundle gets its list, keyed by id
        - a bundle whose versions fail gets an empty list, not a missing key
        - an unreadable body becomes an empty list
        - refreshOne() replaces one entry and leaves the rest as they were
        - a failing refreshOne() leaves the previous entry standing

<!-- END proof -->

### SC-PLAN-013 — A version is still valid on its own last day

🟢 Validity dates are inclusive, so an offer does not go dark on the day it is advertised until.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Plans (validUntil day-inclusive)
        - single-day version (validFrom=validUntil=today) is active today
        - validUntil = yesterday → dark today
        - succession without a dead day: v1 (…–today) active today, v2 (tomorrow–) not yet

<!-- END proof -->

### SC-PLAN-014 — A plan that has ever been published is kept

🟢 It may be withdrawn from sale; it is not removed. Subscriptions reference the versions under it,
and the record has to survive them.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plans-service.test.js`
    - PlansService — root operations
        - softDeletePlan: live version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: superseded version (no live anymore) → 422 PLAN_HAS_PUBLISHED_VERSIONS

<!-- END proof -->

### SC-PLAN-015 — A plan with an open draft is not removed

🟢 The draft is published or discarded first, so no half-written offer disappears without anyone
deciding what it was for.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plans-service.test.js`
    - PlansService — root operations
        - createPlan + listPlans + getPlan happy path
        - createPlan: duplicate planKey → UnprocessableEntity
        - createPlan: a plan key is taken once for the installation
        - updatePlan changes label + sortOrder
        - updatePlan: NotFound for unknown ID
        - softDeletePlan without versions sets deletedAt + disappears from list
        - softDeletePlan idempotent (second call without throw)
        - softDeletePlan: NotFound for unknown ID
        - softDeletePlan: live version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: superseded version (no live anymore) → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - softDeletePlan: only draft (nothing published) → allowed
        - hardDeletePlan: without versions → plan is gone from list
        - hardDeletePlan: with draft → 422 PLAN_HAS_DRAFTS
        - hardDeletePlan: with published version → 422 PLAN_HAS_PUBLISHED_VERSIONS
        - hardDeletePlan: NotFound for unknown ID
        - listPlans returns every plan of the installation
        - listPlans onlyPublished: only plans with a live version
        - listPlans onlyPublished: superseded version does not count as live

<!-- END proof -->

### SC-PLAN-016 — A version can be given an end date, and it lies in the future

🟢 Ending a version stops new bookings on it. It does not move anybody who is already on it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-versions-service.test.js`
    - PlanVersionsService — published-but-future editing (Pack 2c)
        - updatePlanDraft allows published-but-future version (latest, 0 subs)
        - updatePlanDraft blocks published-but-future version with subscription
        - updatePlanDraft blocks published version that is not latest-in-chain
        - listPlanVersions annotates isLatestInChain + subscriptionCount on the latest version
        - updatePlanDraft fail-closed without SubscriptionRepository
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Plans (validUntil day-inclusive)
        - single-day version (validFrom=validUntil=today) is active today
        - validUntil = yesterday → dark today
        - succession without a dead day: v1 (…–today) active today, v2 (tomorrow–) not yet
- `packages/nest/tests/validity-window.test.js`
    - the window a version is refused for
        - no start at all
        - a start that is not a date
        - a start on or before the predecessor’s
        - a start that leaves a gap after a predecessor that ends
        - a predecessor without an end imposes no seam
        - an end that is not a date
        - an end on or before the start
        - the codes come from the caller, so a plan refuses as a plan
        - the gapless refusal says which day it wanted

<!-- END proof -->

### SC-PLAN-017 — Publishing happens in the administration, never in a seed

🟢 Data loaded at set-up may create drafts. Turning a draft into an offer is an act an operator
performs and is recorded as having performed.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/an-operator-runs-the-plan-catalogue.integration.test.js`
    - the plans an operator has on sale
        - a plan is found by its key, and a key nobody took is not
        - listing is ordered by sort order, then by key
        - a retired plan drops out of the list, and comes back when asked for
        - onlyPublished hides a plan whose versions are all still drafts
        - a plan key cannot be claimed twice, so no version lineage is shared
        - a retired plan still occupies its key
        - renaming a plan touches what was named and nothing else
        - renaming a plan that is gone says so instead of writing nothing
        - deleting a plan twice is not an error
    - the versions behind a plan
        - drafts are numbered in order, and listed that way
        - the current draft is the unpublished one, and there is none once it ships
        - the latest live version is the newest unsuperseded one
        - a terminated version is not live any more
        - a draft can be edited, and only the named fields move
        - a version published for a future date can still be corrected
        - editing a version that is gone says so
        - a draft can be discarded, a published version cannot, and a missing one is a no-op
        - publishing the same draft twice fails the second time
    - a tenant's own writes
        - a scheduled change is written, and only while the row is uncancelled
        - an immediate change binds the plan and refuses once a cancellation lands
        - changing to a plan with no live version says so rather than binding nothing
        - an immediate change stays on its own connection when a version is pending
        - accepting a pending version is idempotent, and reports the second call as such
        - accepting when nothing is pending says so
        - a second cancellation returns the first one instead of replacing it
        - an operator ending a contract on the spot flips the status
    - the statements a tenant write sends
        - an ordinary cancellation never names the status column
        - ending a contract on the spot does name it
        - an immediate change locks the row it decides from
    - the subscription a tenant is shown
        - a tenant with no subscription reads as none, not as an error
        - the dates and the plan version a person is shown all come back
        - a pending version comes with what a person needs to decide
        - the version a subscription is billed for cannot be deleted underneath it
- `packages/nest/tests/plan-catalog-importer.test.js`
    - PlanCatalogImporterService
        - importFromYaml: first round → all created
        - importFromYaml: second run → all skipped (idempotent)
        - importFromYaml: plan without monthlyNet → warning + skip PlanVersion
- `packages/nest/tests/seed-gate-runner.test.js`
    - runSeedGateFromFile
        - report-only without snapshot → null + warning, no exit
        - blocking without snapshot → exit 4
        - report-only with violations → report, seed continues
        - blocking with violations → exit 4
        - clean seed → report ok, no exit
- `packages/nest/tests/seed-gate.test.js`
    - validateSeedAgainstSnapshot
        - all seeded features discovered → overall ok
        - plan with an undiscovered feature → PLAN_FEATURE_UNKNOWN + error
        - bundle with an undiscovered feature → BUNDLE_FEATURE_UNKNOWN
        - undiscovered quota → QUOTA_MISSING
        - empty input → ok
        - formatSeedGateReport shows entity + code
- `packages/ui-vue/tests/use-bulk-publish.test.js`
    - useBulkPublish.setItems
        - sets items with default status pending
    - useBulkPublish.run — parallel publishes
        - all successful → success count = 3, done=true
        - single error → success=2, failure=1, done=true
        - empty changeNote → all items failed
        - mfaCode sets X-Mfa-Code header
        - auth token is sent along
    - useBulkPublish — endpoint mapping
        - endpoints are called per kind
        - override endpoints configurable
    - useBulkPublish — progress
        - progress=0 for empty set
        - progress=0 before run, =1 after run

<!-- END proof -->

### SC-PLAN-018 — The version that applies is the one valid on the day of the purchase

🟢 💰 Not the newest one, and not the one the pricing page happened to be showing.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-plan-binding.test.js`
    - Prisma plan binding options
        - the omitted schema preserves every 0.6 plan default
        - normalized mode resolves both directions
    - normalized plan identity across Prisma adapters
        - catalog read uses the catalog delegate and exposes semantic planKey
        - catalog import resolves planKey to UUID and writes only the catalog delegate
        - entitlement and subscription adapters use their delegate and map UUID back
        - active subscription counts use authoritative PlanVersions
        - a subscription that has ended is not an active tenant
        - all subscription operations honor tenantSubscription.delegate, including tx reads
        - bundle booking count is opt-in and uses active cancellation semantics
        - findActive is opt-in, day-inclusive and can include endsAt
        - active lookups prefer a dated version over a legacy NULL validFrom
    - PrismaPlanRepository normalized lifecycle
        - draft fields, active lookup, atomic publish, succession and termination round-trip
        - legacy constructor keeps planKey storage and drops unsupported fields
        - latest live lookup excludes a version whose explicit endsAt elapsed
        - legacy onlyPublished reads the live versions, and a key names one plan
        - legacy onlyPublished omits a plan whose only version is a draft
    - prismaPersistence schema forwarding
        - token factories receive normalized schema options
- `packages/core/tests/active-plan-version-query.test.js`
    - buildActivePlanVersionWhere
        - requires publishedAt IS NOT NULL
        - tolerates validFrom IS NULL ("valid since forever") alongside validFrom &lt;= asOf
        - validUntil day-inclusive: &gt;= startOfDay(asOf), not &gt; asOf
        - startOfUtcDay normalizes to 00:00 UTC
        - without withEndsAt: no endsAt clause (CatalogPlanVersion)
        - withEndsAt: adds an endsAt clause (PlanVersion)
- `packages/nest/tests/a-preview-answers-on-an-older-schema.test.js`
    - a bundle preview on a schema without validity windows
        - answers, using the newest live version for the redundancy hint
        - and the same answer as a schema that does offer the lookup
        - a bundle the plan does not cover gets no redundancy warning either way
        - with no plan repository at all it still answers
        - a repository that offers the lookup and throws inside it is the bug itself
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Plans (validFrom tolerance)
        - live plan version with validFrom=NULL appears in the catalog
        - findActivePlanVersion returns the NULL-validFrom version when it is the only live one
        - dated version wins over NULL-validFrom (fallback, not an override)
- `packages/ui-vue/tests/resolve-plans.test.js`
    - resolvePlans
        - picks the currently valid version as the live one
        - falls back to the next scheduled version when nothing is live
        - gives a plan with only drafts a row without a version
        - marks a plan expired only when nothing is left to come
        - lists sub-rows without repeating the parent
        - sorts by sortOrder, then by key
    - countPlans
        - counts what the tiles above the list show

<!-- END proof -->

### SC-PLAN-019 — Two operators cannot publish the same draft

🟢 The second one is told the draft has already been published rather than publishing it again.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-publish.test.js`
    - assertOptimisticLockHeld
        - accepts exactly 1 update
        - 0 updates → OPTIMISTIC_LOCK_CONFLICT
        - multiple updates → OPTIMISTIC_LOCK_CONFLICT

<!-- END proof -->

### SC-PLAN-020 — A draft built on a version that has since been retired has to be rebased

🟢 Publishing it as it stands would put an offer live that was written against something no longer
current.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-publish.test.js`
    - assertBaseVersionFresh
        - accepts a non-superseded base
        - null base → BASE_NOT_FOUND
        - superseded base → BASE_SUPERSEDED

<!-- END proof -->

### SC-PLAN-021 — A plan that is not sold self-service says so and says who to ask

🟢 A tenant meeting a negotiated plan is pointed at the contract manager rather than at a button that
will not work. A plan may also be one that cannot be left by self-service, which is the same idea
in the other direction.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding throws ForbiddenException for blocked self-service plans

<!-- END proof -->

### SC-PLAN-022 — Everything wrong with an uploaded catalogue is reported at once

🟢 An operator fixing a plan file sees every error in one pass rather than discovering them one round
trip at a time.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/an-operator-runs-the-plan-catalogue.integration.test.js`
    - the plans an operator has on sale
        - a plan is found by its key, and a key nobody took is not
        - listing is ordered by sort order, then by key
        - a retired plan drops out of the list, and comes back when asked for
        - onlyPublished hides a plan whose versions are all still drafts
        - a plan key cannot be claimed twice, so no version lineage is shared
        - a retired plan still occupies its key
        - renaming a plan touches what was named and nothing else
        - renaming a plan that is gone says so instead of writing nothing
        - deleting a plan twice is not an error
    - the versions behind a plan
        - drafts are numbered in order, and listed that way
        - the current draft is the unpublished one, and there is none once it ships
        - the latest live version is the newest unsuperseded one
        - a terminated version is not live any more
        - a draft can be edited, and only the named fields move
        - a version published for a future date can still be corrected
        - editing a version that is gone says so
        - a draft can be discarded, a published version cannot, and a missing one is a no-op
        - publishing the same draft twice fails the second time
    - a tenant's own writes
        - a scheduled change is written, and only while the row is uncancelled
        - an immediate change binds the plan and refuses once a cancellation lands
        - changing to a plan with no live version says so rather than binding nothing
        - an immediate change stays on its own connection when a version is pending
        - accepting a pending version is idempotent, and reports the second call as such
        - accepting when nothing is pending says so
        - a second cancellation returns the first one instead of replacing it
        - an operator ending a contract on the spot flips the status
    - the statements a tenant write sends
        - an ordinary cancellation never names the status column
        - ending a contract on the spot does name it
        - an immediate change locks the row it decides from
    - the subscription a tenant is shown
        - a tenant with no subscription reads as none, not as an error
        - the dates and the plan version a person is shown all come back
        - a pending version comes with what a person needs to decide
        - the version a subscription is billed for cannot be deleted underneath it
- `packages/cli/tests/generated-catalog-loads.test.js`
    - the catalogue init writes is one the platform accepts
        - with a single quota
        - with several, including a camel-cased key
        - and with --skip-hasher, which does not touch the catalogue
        - the check is not vacuous — a hand-broken catalogue is refused
    - either init refuses the input, or the platform accepts the output
        - JSON.stringify(input)
- `packages/nest/tests/plan-catalog-importer.test.js`
    - PlanCatalogImporterService
        - importFromYaml: first round → all created
        - importFromYaml: second run → all skipped (idempotent)
        - importFromYaml: plan without monthlyNet → warning + skip PlanVersion
- `packages/nest/tests/plan-catalog-loader.test.js`
    - loadPlanCatalogFromString accepts valid example
    - loadPlanCatalogFromString rejects schemaVersion != 1
    - loadPlanCatalogFromString rejects missing required fields
    - loadPlanCatalogFromString rejects addons block (#49 — no addon sales)
    - cross-field: plan references unknown featureKey → error
    - cross-field: duplicate plan IDs → error
    - cross-field: plannedOnly:true allows plan reference (roadmap marker)
    - crossFieldChecks: false skips consistency checks
    - loadPlanCatalogFromFile reads YAML file from disk
    - loadPlanCatalogFromFile throws for non-existent file
    - PlanCatalogValidationError contains error list
    - a catalogue without tenantBilling is refused, and the field is named
    - a rhythm nobody named is refused, rather than read as zero
    - a self-service list nobody named is refused too
    - empty lists and zeroes are values, not omissions
    - a negative notice period is refused
    - a fractional notice period is refused — days are whole
    - an unknown member of the block is refused, not ignored

<!-- END proof -->

### SC-PLAN-023 — A catalogue that cannot be read is the caller's mistake, not a server failure

🟢 It is answered as a rejected upload rather than as an internal error. A caller cannot otherwise
tell a bad file from a broken server, and the one they can fix is the one that looked unfixable.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/generated-catalog-loads.test.js`
    - the catalogue init writes is one the platform accepts
        - with a single quota
        - with several, including a camel-cased key
        - and with --skip-hasher, which does not touch the catalogue
        - the check is not vacuous — a hand-broken catalogue is refused
    - either init refuses the input, or the platform accepts the output
        - JSON.stringify(input)
- `packages/nest/tests/plan-catalog-loader.test.js`
    - loadPlanCatalogFromString accepts valid example
    - loadPlanCatalogFromString rejects schemaVersion != 1
    - loadPlanCatalogFromString rejects missing required fields
    - loadPlanCatalogFromString rejects addons block (#49 — no addon sales)
    - cross-field: plan references unknown featureKey → error
    - cross-field: duplicate plan IDs → error
    - cross-field: plannedOnly:true allows plan reference (roadmap marker)
    - crossFieldChecks: false skips consistency checks
    - loadPlanCatalogFromFile reads YAML file from disk
    - loadPlanCatalogFromFile throws for non-existent file
    - PlanCatalogValidationError contains error list
    - a catalogue without tenantBilling is refused, and the field is named
    - a rhythm nobody named is refused, rather than read as zero
    - a self-service list nobody named is refused too
    - empty lists and zeroes are values, not omissions
    - a negative notice period is refused
    - a fractional notice period is refused — days are whole
    - an unknown member of the block is refused, not ignored

<!-- END proof -->

### SC-PLAN-024 — The order plans appear in is set by moving them, not by typing numbers

🟢 An operator drags a row, or moves it with the keyboard, and the platform works out the priorities.
Gaps an operator deliberately left are preserved, and a plan with no live version has no handle to
grab, because there is nothing to order.

_Source:_ release 1.0.0-rc.4

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — comparison matrix (staircase sorting)
        - feature rows: widest coverage first, on a tie the leading plan column
- `packages/ui-vue/tests/reorder-priorities.test.js`
    - reorderedPriorities
        - a move within equal priorities produces the order it promises
        - it keeps the gaps an operator chose
        - rows that keep their value are reported as unchanged
        - no move, no writes
        - a value at the top of the range stays inside it
        - a list already at the ceiling still separates
        - pulling ties apart never goes below zero
        - a move to the end lands at the end
- `packages/ui-vue/tests/resources-plans.test.js`
    - bindResource
        - supplies http and context, leaving the operation its own arguments
        - binds every operation the resource declares, and nothing else
        - reads a context getter per call, so a changed endpoint is picked up
    - plansResource
        - list addresses the plan catalogue
        - list turns an empty response into an empty list, not null
        - tenantCounts has its own path and the same scoping
        - tenantCounts turns an empty response into an empty map
        - create posts to the unscoped collection — the body carries the project
        - update patches the plan by id
        - softDelete and hardDelete are different endpoints
        - a delete tolerates both an empty response and one with a body
    - planVersionsResource
        - reading versions goes through the plan
        - creating a draft goes through the plan too
        - but every mutation of an existing version addresses the version directly
        - discarding a draft deletes the version, not the plan
        - listForPlan turns an empty response into an empty list
    - the shared request policy
        - sends a JSON content type
        - a caller header wins over the default
        - serialises the body — the transport only carries strings
        - sends no body when there is none, rather than the string "undefined"
        - a client that resolved with no status never reads as an answer
        - a 204 and an unparsable 2xx both read as no body
        - a non-2xx throws an AdminError carrying the parsed body and the code
        - what the server said survives — a page must not lose actionable text
        - a validation array is joined here too, not only in the JSON helper
        - a non-2xx without a readable body still reports its status
        - a mutation that answers with nothing is a failure, not a null
        - each empty-body failure names the operation it came from
        - publish with no options sends an empty payload, not nothing
        - a request with no init at all defaults to GET
        - requestJsonBody names the default method when it has no init either
        - a non-string code on the body is not treated as a code
        - a non-2xx whose body is not an object still carries what came back
        - requestJsonBody passes a present body through untouched
- `packages/ui-vue/tests/use-plans.test.js`
    - usePlans — construction
        - refuses to run without an endpoint, because the platform cannot guess it
        - does not load until asked
        - autoLoad fires exactly one request
    - usePlans — load
        - fills the list and clears loading
        - an empty response is an empty list, not a failure
        - a failure lands in error and does not escape
        - tenantCounts failing is swallowed on purpose and leaves an empty map
    - usePlans — mutations keep the list in step
        - create appends what came back
        - update replaces in place, keeping the order
        - softDelete removes the row
        - a rejected delete leaves the row where it was
        - a create that answers with nothing is a failure, not a silent no-op
    - usePlanVersions
        - needs both an endpoint and a plan
        - load fills the versions
        - createDraft appends the nested version, not the whole result
        - publish replaces the version in place
        - discardDraft removes it
        - terminateVersion replaces the version with what came back
        - its errors carry the API name they came from

<!-- END proof -->

## 4. Add-on bundles

An add-on is bought on top of a plan and lives and dies with it. Nearly everything here follows
from that one sentence: the rhythm it may be billed in, when its periods end, what happens when
the plan ends, and why no money ever comes back. The chapter also says what a tenant has to be
told before they buy, because several of these rules are only fair if they are read first.

### SC-BUN-001 — An add-on is bought on top of a plan, never instead of one

🟢 A tenant cannot use an add-on without a plan, so the plan is what an add-on hangs off.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - a tenant books a bundle
        - on a running plan it gets a window on the plan’s day
        - during a trial it is booked, and waits for a window rather than inventing one
        - a plan that has no price for it refuses the booking outright
        - …while a plan the override does not touch books it happily

<!-- END proof -->

### SC-BUN-002 — An add-on's periods end on the day the plan's do

🟢 The alignment is made when the add-on is booked rather than repaired when the plan ends, because a
period that has to be trimmed is one somebody was committed to more of than they received — and
then owed the difference.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - a monthly bundle on a yearly plan ending on the 31st
        - bills the first, short period to the end of February
        - and every month after it to the plan day, landing with the plan
    - a monthly bundle on a yearly plan ending on the 17th
        - runs its first period past the month end, to the plan day
        - and lands on the plan with every month between
    - a bundle booked on the plan day itself
        - gets a whole period rather than an empty one
        - while the day before it gets the short one it is entitled to
    - a plan whose periods do not end at midnight
        - a booking earlier that day still meets the boundary that day
        - a booking after it takes the next month, at the same time of day
        - and every period after it keeps that time
        - the pro-rata denominator keeps it too, so a cycle is a whole cycle
    - a yearly bundle
        - meets the plan on its own boundary, month and day together
        - and takes the following year when booked after that boundary
    - a plan whose anchor is not stored
        - falls back to the day its period ends on
    - rolling a booking on, period after period
        - a period that is over opens the next one, on the anchor
        - a period still running is left alone
        - a booking billed with the plan is left alone
        - a booking made before its plan had a period gets one once the plan does
        - a first window opened late lands after now, not months before it
        - a first window opened promptly is the short one it should be
        - a booking still waiting keeps waiting while the plan has no period either
        - a first window is capped by the plan’s end like any other
        - a window that would end at or before it starts is not opened at all
        - every window it does hand back ends after it starts
        - a job that missed months catches up in one go
        - catching up keeps the anchor rather than losing it to a short month
        - a declared cancellation caps the window it opens
        - a declared cancellation already passed opens nothing at all
        - whichever ends first wins — the plan or the booking
        - a first window is capped by a declared cancellation too
        - a cancelled booking is not given a first window either
        - a landed cancellation of the booking stops it; a declared one does not
        - a plan that has ended takes the booking with it, without a cancellation
        - a plan ending inside the new period cuts it back rather than outliving it
        - a plan ending exactly on the boundary gives the booking that period
        - a booking with no rhythm of its own follows the plan’s
        - a monthly booking beside a yearly plan keeps its own month
    - one answer for the plan’s billing day
        - a stored anchor is the answer
        - without one, the day that opened the window — never the day that closed it
        - without a window either, the day the subscription started
        - with nothing at all it says so, rather than inventing a day
        - a value that cannot be a day of a month is treated as absent
        - the preview and the booking reach the same day for the same subscription

<!-- END proof -->

### SC-BUN-003 — The first period of a booking is short, and charged for exactly that stretch

🟢 💰 It runs from the booking to the next occurrence of the plan's billing day and is charged pro
rata. The fraction is taken against a whole cycle of the add-on's own rhythm, so a monthly add-on on
a yearly plan is not charged a fraction of a year at a monthly price.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - a bundle booked on the plan day itself
        - gets a whole period rather than an empty one
        - while the day before it gets the short one it is entitled to
    - booked anywhere inside a plan period
        - on the first day it runs the whole way to the plan’s next day
        - in the middle it runs to the same day
        - on the last day it still gets a period rather than none
        - a day past the boundary belongs to the next period, not a zero-length one
    - booking one, through the service that writes it
        - a monthly bundle on a yearly plan is stored with the short first period
        - and defaults to the rhythm of the plan when the tenant does not choose
        - while a yearly bundle on a monthly plan is refused outright
        - and a monthly bundle on a monthly plan is not
    - what the short first period costs
        - the cycle it is charged against ends where the first period does
        - a yearly bundle is charged against a year, not a month
        - the anchor survives being walked backwards, the same as forwards
        - stepping back from January lands in December of the year before
        - a leap day retreats to the 28th, and forwards again to the 29th
        - the start it gives back is the boundary that leads to that end

<!-- END proof -->

### SC-BUN-004 — A tenant on a monthly plan cannot book a yearly add-on

🟢 The plan would end twelve times before the add-on's first period did, and each of those is a
moment the tenant could be left committed to something that grants nothing.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - which cycles a bundle may be sold on
        - every combination, not three of the four
        - ${bundle} bundle on a ${plan} plan is ${allowed ? 'allowed' : 'refused'}

<!-- END proof -->

### SC-BUN-005 — A tenant on a yearly plan chooses the rhythm each add-on is billed in

🟢 Preselected to the plan's own rhythm, so a tenant who does nothing gets what they would have got
before. On a monthly plan no control appears: a question with one answer is not a question.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - the request bodies a tenant can send
        - a booking needs a version id, and it must be one
        - the rhythm is one of two words, and nothing else
        - the rhythm is optional — omitting it means the plan’s, and so does null
        - a minimum term is a whole number of months within ten years
        - a preview takes the same rhythm the booking does
        - a preview asks about exactly one thing, and either is optional alone
- `packages/nest/tests/subscription-bundle-preview.test.js`
    - a bundle billed in its own rhythm
        - a monthly bundle on a yearly plan is quoted monthly, over its own month
        - without a cycle it still quotes the plan’s
        - a yearly bundle beside a monthly plan is refused, not quoted
        - a bundle with no price in the asked rhythm is refused, not given away
        - the preview names the day the plan takes the bundle down with it
        - a plan that runs on names no end at all
- `packages/ui-vue/tests/use-tenant-subscription-bundles.test.js`
    - useTenantSubscriptionBundles
        - the endpoint is required — there is no prefix the platform could guess
        - load() maps the wire dates on a record onto Dates
        - the booking’s own period arrives as dates, not as wire strings
        - a booking with no period of its own keeps null, not the epoch
        - a nullable date that is set is mapped too
        - load() keeps the list usable and reports the failure on `error`
        - a 204 to load() is an empty list, not a failure
        - add() prepends the new bundle and sends the token
        - without a token no Authorization header is invented
        - cancel() replaces the row it cancelled
        - a mutation the server answered without a body says the change may have landed
        - a mutation that failed outright is not that — it says check the status
        - autoLoad fetches without being asked
- `packages/ui-vue-tenant/tests/component/a-bundle-is-bought-in-a-rhythm.test.ts`
    - a monthly plan offers no choice
        - no control appears, because there is one legal answer
        - the card quotes the monthly price with the monthly unit
        - buying sends the rhythm rather than leaving it to be guessed
    - a yearly plan offers both
        - the control appears, preselected to the plan — nobody is repriced by an upgrade
        - switching moves the price and the unit together
        - buying sends what was chosen, not what the plan is
    - a bundle that is not sold in the chosen rhythm
        - is not offered, and says why instead of showing a price
        - becomes bookable again when the other rhythm is chosen
        - keeps the reason that actually explains it when it is already booked
    - a plan whose rhythm changes underneath the section
        - an untouched control follows the plan when it turns yearly
        - a rhythm the tenant chose survives a plan change that still offers it
        - a choice the plan took away does not come back as a choice
        - drops a selection the plan no longer offers
    - what a booked bundle says it costs
        - a yearly booking states the yearly charge, not a monthly figure
        - a monthly booking beside a yearly plan reads as monthly
        - a price only an override supplies is shown, though no catalogue price exists
        - a booking from before the rhythm was recorded takes the plan's
        - a price the server did not send is joined from the catalogue in the booking's rhythm
        - a price the server resolved to nothing is shown as nothing

<!-- END proof -->

### SC-BUN-006 — The price an add-on is advertised at is the price it is booked at

🟢 💰 Including its unit. A card saying "per month" beside a yearly plan is the figure a tenant
compares add-ons by, and comparing by the wrong one is a decision made on wrong information even
when the confirmation later shows the right amount.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the price a booking is billed at
        - follows the rhythm the booking was made in
        - a monthly booking beside a yearly plan is billed monthly
        - a booking from before the rhythm was recorded takes the plan’s
        - a plan-specific override is what the tenant on that plan is billed
        - a booking whose version has vanished reports no price rather than a wrong one

<!-- END proof -->

### SC-BUN-007 — An add-on with no price in the chosen rhythm is shown as unavailable

🟢 Rather than as a button the server will refuse.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the prices a store is shown
        - are resolved for the plan, in both rhythms
        - carry an override the public catalogue cannot know about
        - a bundle sold in one rhythm only says so for the other
        - an id nobody knows is left out rather than answered with nulls
        - asking for nothing costs nothing
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - a tenant books a bundle
        - on a running plan it gets a window on the plan’s day
        - during a trial it is booked, and waits for a window rather than inventing one
        - a plan that has no price for it refuses the booking outright
        - …while a plan the override does not touch books it happily
- `packages/ui-vue/tests/use-tenant-billing-catalog.test.js`
    - useTenantBillingCatalog
        - load() reads all three endpoints under the default prefix
        - a trailing slash in the prefix does not become a double slash
        - the wire form of a bundle becomes the shape the page renders
        - the optional wire fields default rather than arriving as undefined
        - a missing /bundles endpoint is not fatal — the plan page still renders
        - a failing /plans clears what it could not load
        - a client that resolves with status 0 fails the load rather than emptying it
        - a client that rejects is reported, not swallowed
        - it loads on its own unless the consumer says otherwise

<!-- END proof -->

### SC-BUN-008 — An add-on carries no commitment unless an operator configures one

🟢 The default is none. A twelve-month commitment nobody asked for is a different product, and it
made "cancellable to the next period end" impossible for eleven of those months.

_Source:_ #239

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/bundle-defaults-are-decided-once.test.js`
    - what a new draft starts from
        - an omitted quota map is empty, not absent
        - an omitted price is null, not zero
        - an unstated bundle is marketed
        - …and an explicit false stays false
        - an omitted change note is empty, and lineage is null
        - everything given is passed through untouched
        - it says nothing about validity windows
    - what a new bundle stem starts from
        - an omitted description or icon is null, not an empty string
        - an unstated sort order is zero, and an explicit zero survives
        - an omitted translation map is empty
        - the identity fields are carried straight over
    - reading a stored stem back
        - dates become ISO strings, because that is what the row type says
        - a retired stem carries its date rather than a flag
        - an i18n map is passed through
        - anything that is not a map becomes one
    - the fields a caller actually gave
        - an omitted field is not in the patch at all
        - an explicit null is kept, because somebody chose it
        - falsy values are values
        - a key that was not asked for is not in the patch
        - an empty patch is empty, not undefined
- `packages/nest/tests/an-add-on-comes-out-at-its-period-end.test.js`
    - a commitment an operator did configure
        - binds inside it, and still cannot outlast the plan
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - what a bundle may commit to
        - never past the parent, when the parent ends first
        - and its own term when that ends first
        - and no term at all where the caller asked for none
        - and the full term where nothing ends the parent

<!-- END proof -->

### SC-BUN-009 — An add-on can be cancelled at any time and ends with the period it is in

🟢 Up to the moment its next period begins. The premise behind it is that no money is ever paid back:
the tenant pays for the period they are in, it ends normally, and no refund arises.

_Source:_ #239 · #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - cancelling one, against its own period
        - a monthly booking ends with its month, not with the plan’s year
        - a booking from before the columns existed still ends with the plan
        - a minimum term still outranks the period when it runs longer
        - and the parent’s end still caps both
- `packages/nest/tests/an-add-on-comes-out-at-its-period-end.test.js`
    - a monthly add-on beside a yearly plan
        - commits to nothing and runs to the plan’s billing day
        - cancelling lands at the end of the period it is in
        - cancelling on the last day of the period still lands on that day
    - a yearly add-on beside a yearly plan
        - commits to nothing and ends with the plan period that pays for it
        - cancelling lands at that same end, not a year after the booking
- `packages/nest/tests/an-add-on-has-no-notice-period.test.js`
    - cancelling an add-on
        - on the last day of the period still ends with that period
        - on the first day of the period ends with the same period
        - a minimum term still binds, because that is what was committed to
        - and the plan ending first caps it, because the add-on cannot outlive it
        - a booking with no period of its own ends when it was declared
- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewCancel
        - effectiveAt = period end when minimum term expired
        - minimum term binds beyond period end → effectiveAt + warning
        - already canceled → blocker
        - foreign subscription → NotFound (no cross-tenant leak)
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — cancelBundleFromSubscription
        - canceledEffectiveAt = currentPeriodEnd when the minimum term has already elapsed
        - canceledEffectiveAt = minimumTermEndsAt when the minimum term is longer than the period
        - second cancellation → 422 SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED
        - unknown ID → 404

<!-- END proof -->

### SC-BUN-010 — The period an add-on ends at is its own, not the plan's

🟢 For a monthly add-on beside a yearly plan those are up to eleven months apart, and reading the
plan's boundary kept a cancelled booking committed and billed until the annual renewal.

_Source:_ #222 · release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - cancelling one, against its own period
        - a monthly booking ends with its month, not with the plan’s year
        - a booking from before the columns existed still ends with the plan
        - a minimum term still outranks the period when it runs longer
        - and the parent’s end still caps both
- `packages/nest/tests/an-add-on-comes-out-at-its-period-end.test.js`
    - a monthly add-on beside a yearly plan
        - commits to nothing and runs to the plan’s billing day
        - cancelling lands at the end of the period it is in
        - cancelling on the last day of the period still lands on that day
- `packages/nest/tests/subscription-bundle-preview.test.js`
    - a bundle billed in its own rhythm
        - a monthly bundle on a yearly plan is quoted monthly, over its own month
        - without a cycle it still quotes the plan’s
        - a yearly bundle beside a monthly plan is refused, not quoted
        - a bundle with no price in the asked rhythm is refused, not given away
        - the preview names the day the plan takes the bundle down with it
        - a plan that runs on names no end at all
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — cancelBundleFromSubscription
        - canceledEffectiveAt = currentPeriodEnd when the minimum term has already elapsed
        - canceledEffectiveAt = minimumTermEndsAt when the minimum term is longer than the period
        - second cancellation → 422 SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED
        - unknown ID → 404

<!-- END proof -->

### SC-BUN-011 — An add-on has no notice period

🟢 Cancelling one takes effect at the end of its own period, or at the end of its commitment where
that runs longer, or at the plan's end where that comes first — whenever it is declared, including
on the last day. An add-on hangs off the plan that pays for it, its commitment is the minimum
term, and a second waiting period on top is one nobody could explain to a customer.

_Source:_ #230 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-add-on-has-no-notice-period.test.js`
    - the bundle path does not consult a notice period
        - no source file on that path names anything that carries one
        - the effective date is decided from the booking alone
    - cancelling an add-on
        - on the last day of the period still ends with that period
        - on the first day of the period ends with the same period
        - a minimum term still binds, because that is what was committed to
        - and the plan ending first caps it, because the add-on cannot outlive it
        - a booking with no period of its own ends when it was declared

<!-- END proof -->

### SC-BUN-012 — An add-on can never be committed past the subscription that pays for it

🟢 Its commitment is capped at the plan's end, read afresh when the cancellation is worked out — a
cap applied at booking cannot see a cancellation that had not happened yet.

_Source:_ #221 · #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-plan-change-cannot-strand-a-bundle.test.js`
    - moving to a shorter cycle with a longer add-on booked
        - a yearly add-on blocks the move to a monthly plan
        - the blocker names the date the add-on runs to, so the tenant can act
        - and says both in either language, not only in the English message
        - the German sentence carries no English cycle word
        - staying on the yearly cycle is not blocked
        - a monthly add-on does not block a monthly plan
        - an add-on with no rhythm of its own follows the plan and blocks nothing
        - no active bookings, nothing to block
        - a consumer without the bundle module is not blocked by bookings it cannot have
        - moving to a LONGER cycle with a monthly add-on is fine
        - the date falls back to the minimum term where no period is stored
- `packages/nest/tests/an-add-on-comes-out-at-its-period-end.test.js`
    - a commitment an operator did configure
        - binds inside it, and still cannot outlast the plan
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - what a bundle may commit to
        - never past the parent, when the parent ends first
        - and its own term when that ends first
        - and no term at all where the caller asked for none
        - and the full term where nothing ends the parent

<!-- END proof -->

### SC-BUN-013 — A commitment of none stays none

🟢 Capping an uncommitted booking at the plan's end would invent a commitment: the booking could then
not be cancelled until the plan ended, which is the opposite of what "no commitment" is for.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/bundle-defaults-are-decided-once.test.js`
    - what a new draft starts from
        - an omitted quota map is empty, not absent
        - an omitted price is null, not zero
        - an unstated bundle is marketed
        - …and an explicit false stays false
        - an omitted change note is empty, and lineage is null
        - everything given is passed through untouched
        - it says nothing about validity windows
    - what a new bundle stem starts from
        - an omitted description or icon is null, not an empty string
        - an unstated sort order is zero, and an explicit zero survives
        - an omitted translation map is empty
        - the identity fields are carried straight over
    - reading a stored stem back
        - dates become ISO strings, because that is what the row type says
        - a retired stem carries its date rather than a flag
        - an i18n map is passed through
        - anything that is not a map becomes one
    - the fields a caller actually gave
        - an omitted field is not in the patch at all
        - an explicit null is kept, because somebody chose it
        - falsy values are values
        - a key that was not asked for is not in the patch
        - an empty patch is empty, not undefined
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - what a bundle may commit to
        - never past the parent, when the parent ends first
        - and its own term when that ends first
        - and no term at all where the caller asked for none
        - and the full term where nothing ends the parent

<!-- END proof -->

### SC-BUN-014 — A tenant who has already cancelled may still book an add-on for the time left

🟢 The commitment is shortened rather than the purchase refused. An add-on is priced per period
rather than per commitment, so a shorter one cannot overcharge them.

_Source:_ #221 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - while the subscription is running
        - a bundle can be booked, priced and reactivated
        - and a cancellation still to come does not close it either
        - and cancelling a bundle still re-freezes, carrying the ending

<!-- END proof -->

### SC-BUN-015 — Ending with the plan is not a cancellation

🟢 No notice is given and none is needed, and the period the add-on is in when the plan ends is not
refunded. The alignment exists so that day is a period boundary in the first place.

_Source:_ #222

### SC-BUN-016 — A tenant reads what a booking commits to before confirming it

🟢 When the first period ends, when the plan it hangs on ends, and plainly that a shortened booking
is not refunded. The no-refund rule is fair only if it is read before the decision rather than
discovered after it, and it is stated as a plain sentence rather than a warning, because it holds
for every booking and a warning that always fires teaches people to skip warnings.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewAdd
        - proration: prorated amount until period end + next-period price
        - YEARLY cycle uses yearlyNet, plan-specific pricing override wins
        - TRIAL: no proration (no paid period yet)
        - the preview quotes no commitment, because a booking makes none
        - the preview quotes a commitment an operator configured
        - redundancy (AK-13): feature already in plan → hint + warning
        - redundancy: feature already in another active bundle → hint with bundleKey
        - requires (#35): uncovered dependency → missingRequires + blocker
        - requires: coverage by plan or active bundle → no blocker
        - requires: without CatalogEntryRepository no check (graceful)
        - self-service policy: sales-only bundle → blocker BUNDLE_NOT_SELF_SERVICE
        - blocker: plan-incompatible + already booked
        - unknown bundle version → NotFound
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - what the dialog promises before the booking
        - states the capped term, not the uncapped one
        - and the full term where nothing ends the parent
- `packages/ui-vue-tenant/tests/component/a-booking-states-what-it-commits-to.test.ts`
    - the first period is named before it is agreed to
        - the date the first period runs to is on the screen
        - a booking with no period to align to says nothing rather than nothing-as-a-date
    - ending with the plan is stated, not left to be discovered
        - a plan that is already ending names the day
        - a plan that runs on shows no end date
        - the no-refund rule holds whether or not the plan is ending
        - a cancellation preview does not repeat the booking terms

<!-- END proof -->

### SC-BUN-017 — An add-on without a price cannot be published

🟢 For every plan the add-on is offered to, a price has to resolve in that plan's rhythm — from the
add-on's own price or from an override set for that plan. A published add-on with no price was
bookable and handed over its features for nothing, and nobody downstream could tell that from a
deliberately free one. Catching it at publication puts the mistake at the operator's desk rather
than at a tenant's checkout.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - a bundle nobody can be charged for is not booked
        - a rhythm the bundle has no price in is refused
        - the rhythm it does have a price in goes through
        - a plan override that resolves nothing is refused as well
        - an override that resolves a price for one plan books for that plan
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - an operator publishes a bundle
        - a base price is enough
        - a price only for one plan is enough — that plan can buy it
        - no price anywhere is refused, and the message says why
        - an explicit zero is refused as a zero, not as a missing price
        - a bundle a compatible plan could not buy is refused, naming plan and cycle
        - …and the same bundle restricted to a monthly-only plan publishes
        - a plan override adds the cycle the base price is missing
        - …and an override that nulls a cycle takes that plan’s price away
        - without a plan repository the catalogue cannot be derived, so nothing is claimed
        - an override that removes the price for one plan still publishes

<!-- END proof -->

### SC-BUN-018 — A yearly price is never derived from a monthly one

🟢 💰 Multiplying by twelve invents a price nobody set. If a yearly price were always twelve monthly
ones, there would be no reason to have two figures.

_Source:_ #222

### SC-BUN-019 — What an add-on costs depends on the plan beside it and the rhythm it is billed in

🟢 💰 Not on the add-on alone. An operator may price the same add-on differently for one plan, or give
it its only price there.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the price a booking is billed at
        - follows the rhythm the booking was made in
        - a monthly booking beside a yearly plan is billed monthly
        - a booking from before the rhythm was recorded takes the plan’s
        - a plan-specific override is what the tenant on that plan is billed
        - a booking whose version has vanished reports no price rather than a wrong one
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - an operator publishes a bundle
        - a base price is enough
        - a price only for one plan is enough — that plan can buy it
        - no price anywhere is refused, and the message says why
        - an explicit zero is refused as a zero, not as a missing price
        - a bundle a compatible plan could not buy is refused, naming plan and cycle
        - …and the same bundle restricted to a monthly-only plan publishes
        - a plan override adds the cycle the base price is missing
        - …and an override that nulls a cycle takes that plan’s price away
        - without a plan repository the catalogue cannot be derived, so nothing is claimed
        - an override that removes the price for one plan still publishes

<!-- END proof -->

### SC-BUN-020 — An add-on whose contents a tenant already has raises a warning, not a refusal

🟢 Whether the overlap comes from the plan or from another booking, the tenant is told they would pay
twice. Where a selection is fully covered by what is already chosen, it is dropped from the price
and from the booking rather than sold.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewAdd
        - proration: prorated amount until period end + next-period price
        - YEARLY cycle uses yearlyNet, plan-specific pricing override wins
        - TRIAL: no proration (no paid period yet)
        - the preview quotes no commitment, because a booking makes none
        - the preview quotes a commitment an operator configured
        - redundancy (AK-13): feature already in plan → hint + warning
        - redundancy: feature already in another active bundle → hint with bundleKey
        - requires (#35): uncovered dependency → missingRequires + blocker
        - requires: coverage by plan or active bundle → no blocker
        - requires: without CatalogEntryRepository no check (graceful)
        - self-service policy: sales-only bundle → blocker BUNDLE_NOT_SELF_SERVICE
        - blocker: plan-incompatible + already booked
        - unknown bundle version → NotFound

<!-- END proof -->

### SC-BUN-021 — An add-on whose own dependencies nothing covers cannot be booked

🟢 If it needs a feature that neither the plan nor another active booking supplies, it would not
work.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewAdd
        - proration: prorated amount until period end + next-period price
        - YEARLY cycle uses yearlyNet, plan-specific pricing override wins
        - TRIAL: no proration (no paid period yet)
        - the preview quotes no commitment, because a booking makes none
        - the preview quotes a commitment an operator configured
        - redundancy (AK-13): feature already in plan → hint + warning
        - redundancy: feature already in another active bundle → hint with bundleKey
        - requires (#35): uncovered dependency → missingRequires + blocker
        - requires: coverage by plan or active bundle → no blocker
        - requires: without CatalogEntryRepository no check (graceful)
        - self-service policy: sales-only bundle → blocker BUNDLE_NOT_SELF_SERVICE
        - blocker: plan-incompatible + already booked
        - unknown bundle version → NotFound

<!-- END proof -->

### SC-BUN-022 — An add-on cannot be booked on a subscription that has already ended

🟢 It would be charged, listed and inert. Reading and cancelling stay open, so somebody whose
subscription has ended can still see what they booked and explain their invoices; what closes is
the till.

_Source:_ #218 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - once the subscription has ended
        - a bundle cannot be booked
        - nor priced
        - nor reactivated, which is buying it again
        - while pricing a cancellation stays open, because that is tidying up
        - but what was booked can still be read
        - and still cancelled
        - without writing a contract that begins after it ended

<!-- END proof -->

### SC-BUN-023 — Only a published, current version of an add-on can be booked

🟢 A draft, a superseded version and one whose validity has not started are not on offer.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/bundle-availability.test.js`
    - missingRequiresFor
        - returns uncovered requires sorted + deduplicated
        - empty when all requires are covered
        - empty when the bundle has no requires
    - resolveBundleAvailability
        - bookable when requires covered and features are new
        - missing-requires grays out bundle on uncovered prerequisite
        - covered when all bundle features are already covered (already included)
        - covered beats missing-requires (fully covered bundle never bookable)
        - partial coverage stays bookable (not covered)
        - bundle without features is never covered
    - coverageExcludingSelf
        - plan ∪ features of the other selected bundles, without the bundle itself
        - excludes own features (otherwise every bundle would be trivially covered)
    - isBundleRedundant
        - Y is redundant when C is already covered by Z
        - Z is not redundant — D is not covered elsewhere
        - redundant when the plan already contains the features
        - single selected bundle is not redundant (self-exclusion)
    - selectChargeableBundles
        - mutual coverage Y={C},Z={C} → exactly ONE bundle remains (deterministically Z)
        - input order irrelevant — sorting determines the kept one (z remains)
        - sortOrder controls which bundle is kept
        - 3-cycle of identical bundles → exactly ONE remains
        - chain of proper subsets X⊂Y⊂Z → only the superset Z remains
        - asymmetric Y={C} ⊂ Z={C,D} → Y discarded, Z kept (regression)
        - bundles covered by the plan are discarded
        - disjoint bundles are all kept
        - empty selection → empty result
        - does not mutate the input
- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - which bundles a tenant may ask the price of
        - a draft is not priced, because it was never on offer
        - a superseded version is not priced either
        - a live version among dead ones still answers
    - a bundle the operator retired
        - is not priced, though its version is still live
- `packages/nest/tests/bundles-service.test.js`
    - BundlesService — Version lifecycle
        - createBundleDraft creates v1 with baseVersionId=null
        - createBundleDraft throws 422 if a draft already exists
        - updateBundleDraft throws 422 on published version
        - publishBundleVersion classifies diff (feature added = IMPROVEMENT)
        - publishBundleVersion blocks regressive version without forceRegressive
        - publishBundleVersion lets regressive version through with forceRegressive
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect

<!-- END proof -->

### SC-BUN-024 — An add-on version somebody has already booked cannot be edited

🟢 Same reason as for a plan version: what was sold does not change underneath the customer.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/a-bundle-version-has-a-window.integration.test.js`
    - two versions inside the same moment
        - the one whose window opened later wins
        - a version with no window at all loses to one that has a window it is inside
        - a closed window is excluded even when it is the later one
    - the edges of one window
        - a version is active throughout its last day, and not the next
        - a version is not active before its window opens
        - a bundle with no published version at all answers null, not an error
    - an adapter that does not promise windows
        - does not offer the method, rather than answering from columns it ignores
        - and hands back no window on a version that has one stored
- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - a bundle the operator retired
        - is not priced, though its version is still live
- `packages/nest/tests/bundles-service.test.js`
    - BundlesService — Version lifecycle
        - createBundleDraft creates v1 with baseVersionId=null
        - createBundleDraft throws 422 if a draft already exists
        - updateBundleDraft throws 422 on published version
        - publishBundleVersion classifies diff (feature added = IMPROVEMENT)
        - publishBundleVersion blocks regressive version without forceRegressive
        - publishBundleVersion lets regressive version through with forceRegressive
    - BundlesService — Editability annotation (Pack 2c)
        - listBundleVersions sets isLatestInChain on the highest version
        - publishBundleVersion: without validFrom → 422 BUNDLE_VERSION_VALID_FROM_REQUIRED
        - publishBundleVersion: second version sets previous to supersededAt + auto-succession
          validUntil
        - publishBundleVersion: validFrom must be strictly after predecessor → 422
        - updateBundleDraft allows published-but-future BundleVersion (latest, 0 subs)
        - updateBundleDraft blocks published-but-future validFrom in the past
        - updateBundleDraft blocks validFrom before the predecessor version
        - updateBundleDraft blocks validUntil before validFrom
        - updateBundleDraft blocks published-but-future BundleVersion with subscription
        - discardBundleDraft removes draft + throws on published
        - updateBundleDraft blocks published version that is not latest-in-chain

<!-- END proof -->

### SC-BUN-025 — An add-on may be restricted to particular plans

🟢 Where no restriction is stated, every plan may book it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/bundle-availability.test.js`
    - missingRequiresFor
        - returns uncovered requires sorted + deduplicated
        - empty when all requires are covered
        - empty when the bundle has no requires
    - resolveBundleAvailability
        - bookable when requires covered and features are new
        - missing-requires grays out bundle on uncovered prerequisite
        - covered when all bundle features are already covered (already included)
        - covered beats missing-requires (fully covered bundle never bookable)
        - partial coverage stays bookable (not covered)
        - bundle without features is never covered
    - coverageExcludingSelf
        - plan ∪ features of the other selected bundles, without the bundle itself
        - excludes own features (otherwise every bundle would be trivially covered)
    - isBundleRedundant
        - Y is redundant when C is already covered by Z
        - Z is not redundant — D is not covered elsewhere
        - redundant when the plan already contains the features
        - single selected bundle is not redundant (self-exclusion)
    - selectChargeableBundles
        - mutual coverage Y={C},Z={C} → exactly ONE bundle remains (deterministically Z)
        - input order irrelevant — sorting determines the kept one (z remains)
        - sortOrder controls which bundle is kept
        - 3-cycle of identical bundles → exactly ONE remains
        - chain of proper subsets X⊂Y⊂Z → only the superset Z remains
        - asymmetric Y={C} ⊂ Z={C,D} → Y discarded, Z kept (regression)
        - bundles covered by the plan are discarded
        - disjoint bundles are all kept
        - empty selection → empty result
        - does not mutate the input
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - an operator publishes a bundle
        - a base price is enough
        - a price only for one plan is enough — that plan can buy it
        - no price anywhere is refused, and the message says why
        - an explicit zero is refused as a zero, not as a missing price
        - a bundle a compatible plan could not buy is refused, naming plan and cycle
        - …and the same bundle restricted to a monthly-only plan publishes
        - a plan override adds the cycle the base price is missing
        - …and an override that nulls a cycle takes that plan’s price away
        - without a plan repository the catalogue cannot be derived, so nothing is claimed
        - an override that removes the price for one plan still publishes
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect
- `packages/nest/tests/tenant-subscription-bundles-plan-compat.test.js`
    - add passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID
    - preview passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID

<!-- END proof -->

### SC-BUN-026 — An add-on that is not sold self-service says so and says who to ask

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewAdd
        - proration: prorated amount until period end + next-period price
        - YEARLY cycle uses yearlyNet, plan-specific pricing override wins
        - TRIAL: no proration (no paid period yet)
        - the preview quotes no commitment, because a booking makes none
        - the preview quotes a commitment an operator configured
        - redundancy (AK-13): feature already in plan → hint + warning
        - redundancy: feature already in another active bundle → hint with bundleKey
        - requires (#35): uncovered dependency → missingRequires + blocker
        - requires: coverage by plan or active bundle → no blocker
        - requires: without CatalogEntryRepository no check (graceful)
        - self-service policy: sales-only bundle → blocker BUNDLE_NOT_SELF_SERVICE
        - blocker: plan-incompatible + already booked
        - unknown bundle version → NotFound
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — Self-Service-Policy (#37)
        - sales-only bundle throws 422 BUNDLE_NOT_SELF_SERVICE
        - without a policy the bundle stays bookable

<!-- END proof -->

### SC-BUN-027 — The same add-on cannot be booked twice on one subscription

🟢 Not while the first booking is still running.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/a-booking-outlives-the-request.integration.test.js`
    - what a booking carries
        - a booking with a window keeps every part of it
        - a booking from before those columns keeps null, not an invented window
        - an id nobody booked answers null rather than throwing
        - the list is the subscription’s own, not the neighbour’s
        - a subscription with no bookings lists nothing, rather than everything
    - what counts as active
        - a booking nobody cancelled is active
        - a cancellation still ahead leaves it active
        - a cancellation that has landed ends it
        - the effective date itself is the first moment it is over
        - asking without a moment asks about now
    - undoing a cancellation
        - reactivating clears both dates and the booking is active again
        - cancelling something that is not there says so, rather than doing nothing quietly
        - reactivating something that is not there says so too
    - counting what a catalogue version still owes
        - active bookings of that version are counted, across subscriptions
        - a different version is not counted
        - a booking whose cancellation has landed is not counted
        - a version nobody booked counts zero
- `packages/adapter-prisma/tests/prisma-bundle.repository.test.js`
    - PrismaBundleRepository validity-window schema mode
        - legacy default never requires, writes or exposes validity columns
        - enabled mode round-trips validity dates on create and update
        - enabled mode resolves the active version with inclusive days and deterministic priority
        - enabled publish is internally atomic and applies auto-succession
        - enabled publish refuses a version somebody else published first
        - enabled publish reuses a caller transaction instead of nesting one
- `packages/nest/tests/subscription-bundle-repo.test.js`
    - SubscriptionBundleRepository — lifecycle
        - add + listBySubscription returns the new booking
        - listActiveBySubscription filters canceled bookings with a past effective date
        - cancel: second call throws
        - countActiveByBundleVersionId counts only non-canceled (or future-effective) bookings
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect

<!-- END proof -->

### SC-BUN-028 — A cancelled booking can be reinstated only before its cancellation takes effect

🟢 Afterwards it is booked again rather than revived.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewCancel
        - effectiveAt = period end when minimum term expired
        - minimum term binds beyond period end → effectiveAt + warning
        - already canceled → blocker
        - foreign subscription → NotFound (no cross-tenant leak)
- `packages/nest/tests/subscription-bundle-repo.test.js`
    - SubscriptionBundleRepository — lifecycle
        - add + listBySubscription returns the new booking
        - listActiveBySubscription filters canceled bookings with a past effective date
        - cancel: second call throws
        - countActiveByBundleVersionId counts only non-canceled (or future-effective) bookings
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — cancelBundleFromSubscription
        - canceledEffectiveAt = currentPeriodEnd when the minimum term has already elapsed
        - canceledEffectiveAt = minimumTermEndsAt when the minimum term is longer than the period
        - second cancellation → 422 SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED
        - unknown ID → 404
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - once the subscription has ended
        - a bundle cannot be booked
        - nor priced
        - nor reactivated, which is buying it again
        - while pricing a cancellation stays open, because that is tidying up
        - but what was booked can still be read
        - and still cancelled
        - without writing a contract that begins after it ended

<!-- END proof -->

### SC-BUN-029 — A move to a shorter plan rhythm is refused while a longer add-on is running

🟢 The tenant cancels the add-on first, and the change then goes through. It is refused rather than
converted or ended: ending it early owes the customer the difference, and converting it invents a
price nobody agreed to. The refusal is judged as of the day the change would land, so following
the advice actually works.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - which cycles a bundle may be sold on
        - every combination, not three of the four
        - ${bundle} bundle on a ${plan} plan is ${allowed ? 'allowed' : 'refused'}
- `packages/nest/tests/a-plan-change-cannot-strand-a-bundle.test.js`
    - moving to a shorter cycle with a longer add-on booked
        - a yearly add-on blocks the move to a monthly plan
        - the blocker names the date the add-on runs to, so the tenant can act
        - and says both in either language, not only in the English message
        - the German sentence carries no English cycle word
        - staying on the yearly cycle is not blocked
        - a monthly add-on does not block a monthly plan
        - an add-on with no rhythm of its own follows the plan and blocks nothing
        - no active bookings, nothing to block
        - a consumer without the bundle module is not blocked by bookings it cannot have
        - moving to a LONGER cycle with a monthly add-on is fine
        - the date falls back to the minimum term where no period is stored
- `packages/nest/tests/tenant-subscription-bundles-plan-compat.test.js`
    - add passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID
    - preview passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID
- `packages/nest/tests/the-plan-preview-sees-the-bookings.test.js`
    - the plan-change rule reaches the bookings in a real container
        - a yearly add-on blocks a move to monthly when the module is composed normally
        - it asks as of the day the change lands, not today
        - nothing booked, nothing blocked

<!-- END proof -->

### SC-BUN-030 — An add-on price of exactly zero has to be meant

🟢 💰 A deliberately free add-on leaves its price unset. An explicit zero is refused unless the
operator says it is intended, for the same reason it is on a plan.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-publish-controller.test.js`
    - PlanVersions.publish passes allowZeroPrice through to the service (#63)
    - PlanVersions.publish: allowZeroPrice stays undefined without the DTO flag
    - BundleVersions.publish passes allowZeroPrice through to the service (#63)
    - BundleVersions.publish: allowZeroPrice stays undefined without the DTO flag
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - an operator publishes a bundle
        - a base price is enough
        - a price only for one plan is enough — that plan can buy it
        - no price anywhere is refused, and the message says why
        - an explicit zero is refused as a zero, not as a missing price
        - a bundle a compatible plan could not buy is refused, naming plan and cycle
        - …and the same bundle restricted to a monthly-only plan publishes
        - a plan override adds the cycle the base price is missing
        - …and an override that nulls a cycle takes that plan’s price away
        - without a plan repository the catalogue cannot be derived, so nothing is claimed
        - an override that removes the price for one plan still publishes

<!-- END proof -->

### SC-BUN-031 — An add-on booked against a plan that has no period yet gets no invented one

🟢 During a trial, or while an enterprise deal is still with sales, there is nothing to align to. The
booking is left without a period and without a commitment rather than being given a made-up one,
and it joins the plan's rhythm once the plan has a paid period. Both ends of a period are written
together or neither: a half-stated period is a state no reader can interpret.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - a plan with no period at all
        - gives the bundle no period either, rather than an invented one
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - a tenant books a bundle
        - on a running plan it gets a window on the plan’s day
        - during a trial it is booked, and waits for a window rather than inventing one
        - a plan that has no price for it refuses the booking outright
        - …while a plan the override does not touch books it happily

<!-- END proof -->

### SC-BUN-032 — An add-on's key never changes

🟢 Renaming one means creating a new add-on and retiring the old one, because customers are bound to
the old key.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/bundles-service.test.js`
    - BundlesService — Master operations
        - createBundle creates a new bundle master record
        - createBundle throws 422 on a duplicate bundleKey
        - updateBundle changes label, leaves bundleKey untouched
        - softDeleteBundle is idempotent
        - listBundles filters out soft-deleted
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - a key an operator has retired
        - creating the same key again is refused, with the code that says why
        - a key nobody used is still free

<!-- END proof -->

### SC-BUN-033 — An add-on bought after a contract was agreed takes effect immediately

🟢 It used to grant nothing until something re-froze the contract, and where the optional hook was
not configured that never happened — silently.

_Source:_ release 0.14.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — bundles booked after the contract was signed
        - adds features and quotas of a bundle missing from the contract
        - does not count a bundle already frozen into the contract twice
        - skips a bundle already covered by a contract line item
        - does not grant a plannedOnly feature from a later bundle
        - ignores a booking that is already canceled

<!-- END proof -->

## 5. Subscriptions, terms and billing periods

This chapter is about time: when a term starts, how long it runs, which day of the month a tenant
is billed on, and what renews without anybody doing anything. Most of it is invisible while it
works. It is here because the one case where it did not work — a billing day quietly moving to the
28th and staying there — moved every other date with it.

### SC-SUB-001 — A tenant has one subscription

🟢

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/spec/tests/reference-sql-drift.test.js`
    - the reference schema makes one subscription per tenant impossible to break

<!-- END proof -->

### SC-SUB-002 — The minimum term is the billing period that was chosen, and it starts at activation

🟢 💰 Monthly or yearly. There is no third rhythm, and no commitment separate from the period unless
an operator configures one for an add-on.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - when the term and the period disagree
        - the later of the two decides
        - a subscription with no term at all falls back to the period

<!-- END proof -->

### SC-SUB-003 — A term renews by itself unless it was cancelled first

🟢 💰 The commitment renews with the period, because the commitment is the period.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-renewal.test.js`
    - computeNextPeriod
        - a declared cancellation does not stop the period from rolling
        - a landed cancellation does
        - the renewed period is also the renewed commitment
        - null when currentPeriodEnd null (Trial)
        - null when currentPeriodEnd is in the future
        - rolls MONTHLY period +1 month (daily cron, periodEnd 1 day before now)
        - rolls YEARLY period +1 year
        - cron lag: with several missed periods, jumps to the next future period

<!-- END proof -->

### SC-SUB-004 — A short month does not move the billing day

🟢 💰 A subscription billed on the 31st is billed on 28 February and then on 31 March. One billed on
the 30th is billed on the 30th of October, not the 31st: the day is "the 30th", not "the end of the
month". Reading the next date off the previous one let a single February move a tenant's billing day
permanently three days earlier, and every date derived from it moved too — the renewal, the notice
deadline, and the end date the customer was told about.

_Source:_ #220 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - a subscription billed on the 31st
        - comes back to the 31st after February
        - and without an anchor it never comes back — the case this exists for
    - a subscription billed on the 30th
        - is billed on the 30th in a 31-day month
        - and on the 28th in February, then back to the 30th
    - a yearly subscription starting on a leap day
        - is billed on the 28th in ordinary years and the 29th when one comes round
    - a renewal that has already been through a February
        - rolls back onto the day the customer is billed on
        - and without a stored anchor keeps the day it landed on
    - a yearly subscription billed on the 31st
        - stays on the 31st, because the month is the same one every year
- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - a period boundary on a month end stays on a month end
        - 31 January plus a month is the end of February
        - and in a leap year, the 29th
        - 31 March plus a month is 30 April
        - 29 February plus a year is 28 February
        - a day that exists in both months is untouched
        - December rolls into the next year

<!-- END proof -->

### SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal

🟢 💰 Reading its own previous result is precisely the drift it exists to stop.

_Source:_ #220

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - iterating to the next boundary
        - keeps the anchor across every step it takes
        - and reaches the anchor day itself where the month is long enough
        - and an explicit anchor overrides the start it was given
    - a renewal that has already been through a February
        - rolls back onto the day the customer is billed on
        - and without a stored anchor keeps the day it landed on
    - a subscription billed on an ordinary day
        - is billed on that day in every month, long or short
        - and the first of the month is not confused with the last of the one before
    - a plan change reopens the window
        - and the day the customer is billed on moves with it
    - an anchor that cannot be a day of a month
        - ${impossible} is treated as absent, not as a day
        - while a possible one is used
    - an impossible anchor handed to the iteration
        - is treated as absent for the whole walk, not for each step
- `packages/nest/tests/version-renewal.test.js`
    - computeNextPeriod
        - a declared cancellation does not stop the period from rolling
        - a landed cancellation does
        - the renewed period is also the renewed commitment
        - null when currentPeriodEnd null (Trial)
        - null when currentPeriodEnd is in the future
        - rolls MONTHLY period +1 month (daily cron, periodEnd 1 day before now)
        - rolls YEARLY period +1 year
        - cron lag: with several missed periods, jumps to the next future period

<!-- END proof -->

### SC-SUB-006 — Billing dates do not move when the clock does

🟢 Period boundaries are computed so that a daylight-saving change cannot shift a billing date by a
day.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/billing-period.test.js`
    - initialPeriodWindow MONTHLY — exactly 1 month
    - initialPeriodWindow YEARLY — exactly 1 year
    - initialPeriodWindow DST transition — UTC-stable
    - periodEndAfter MONTHLY — next period after now
    - periodEndAfter YEARLY — skips multiple years
    - periodEndAfter with null startedAt — iterate from now
    - periodEndWithMinLead YEARLY with ≥42d lead — directly currentPeriodEnd
    - periodEndWithMinLead MONTHLY with &lt;42d lead — skips period
    - periodEndWithMinLead — minLeadDays configurable (14d, accepts exactly 14d)
    - periodEndWithMinLead — minLeadDays 15d on same date jumps to next period

<!-- END proof -->

### SC-SUB-007 — A subscription with no period does not renew

🟢 A trial, or a subscription still waiting on a negotiated contract, has nothing to roll forward.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-renewal.test.js`
    - decideRenewal
        - SKIP when no pending version
        - SKIP when EffectiveAt is in the future
        - ROLL_FORWARD when nonRegressive=true
        - ROLL_FORWARD when accepted=true (even if regressive)
        - CLEAR_PENDING when regressive + not accepted (variant B)

<!-- END proof -->

### SC-SUB-008 — A declared cancellation does not stop the renewal until it lands

🟢 💰 Where a notice period pushed the ending into the following period, that period has to exist
before it can end.

_Source:_ release 1.0.0-rc.6

### SC-SUB-009 — A tenant in arrears can still cancel

🟢 💰 A tenant whose payment failed wanting out is the single most important cancellation there is,
and a status check placed one line too early would refuse it.

_Source:_ #218

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a tenant whose payment failed
        - can still cancel, and lands at the same date as anybody else

<!-- END proof -->

### SC-SUB-010 — A subscription that has ended can no longer change plan

🟢 Nor complete onboarding, accept a pending version, or book an add-on.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - activating a subscription that has already ended
        - is refused on the atomic path, which is the preferred one
        - while a running subscription is activated as before
        - and the write carries what the route read, so a late cancellation wins

<!-- END proof -->

### SC-SUB-011 — A subscription with nothing left to run is recorded as ended

🟢 Rather than left looking active for good, because nothing downstream would ever have moved it.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - activating a subscription that has already ended
        - is refused on the atomic path, which is the preferred one
        - while a running subscription is activated as before
        - and the write carries what the route read, so a late cancellation wins

<!-- END proof -->

### SC-SUB-012 — A new version of a plan does not move a customer who already bought one

🟢 It is offered as a pending change instead. A change that only improves things takes effect at the
next renewal; one that takes something away only takes effect if the tenant accepted it, and is
otherwise dropped when its date arrives.

_Source:_ release 1.0.0-rc.6 · `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a plan version published before the customer left
        - does not roll onto a subscription whose term is over
        - while a cancellation still to come stops nothing
        - and an uncancelled subscription rolls as before

<!-- END proof -->

### SC-SUB-013 — Nothing rolls forward onto a subscription whose cancellation has landed

🟢 A version becomes due because a date arrived, not because anybody still wants it.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a subscription that has ended
        - refuses a plan change instead of charging for one
        - while a running one still changes plans
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a plan version published before the customer left
        - does not roll onto a subscription whose term is over
        - while a cancellation still to come stops nothing
        - and an uncancelled subscription rolls as before

<!-- END proof -->

### SC-SUB-014 — Accepting the same pending version twice changes nothing

🟢 And accepting one when none is pending is refused rather than silently accepted.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - accepting a version after the subscription ended
        - is refused rather than recorded against a dead contract
        - while a running subscription accepts as before
- `packages/nest/tests/version-renewal.test.js`
    - clearPendingPlanVersionFields
        - returns all pending fields as null/false

<!-- END proof -->

### SC-SUB-015 — A scheduled change that comes due after the customer has left is declined and recorded

🟢 A change that never happened is something an operator may be asked about later.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a change scheduled before the customer cancelled
        - is declined once the cancellation has taken effect
        - but a cancellation still to come declines nothing
        - and an uncancelled subscription is applied as before
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - accepting a version after the subscription ended
        - is refused rather than recorded against a dead contract
        - while a running subscription accepts as before
- `packages/nest/tests/pending-plan-materialization.test.js`
    - materializes all due pending plan changes and invalidates each tenant
    - defaults to MONTHLY cycle when pendingBillingCycle is null
    - is non-fatal per tenant — one failure does not abort the run
    - no-op when nothing is due

<!-- END proof -->

## 6. Changing a plan

A plan change is where a tenant's money and a tenant's expectations meet, and both can be lost
quietly. The rules here decide two things: whether a change is allowed at all, and when it takes
effect. The second is the one that carries money, which is why the platform decides it rather than
the caller, and why the date a tenant saw is the date they get.

### SC-CHG-001 — The tenant says what to change to; the platform says when

🟢 Handing the timing to whoever is calling let a direct request end a yearly commitment the customer
was still inside. A wizard is not a guard.

_Source:_ #212 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-server-decides-when-a-change-lands.test.js`
    - a plan change is timed by the rules, not by the request
        - a caller asking for "immediately" on a deferred change is scheduled anyway
        - a caller asking for nothing on an immediate change still gets it today
        - the scheduled date is the preview's, not a second computation

<!-- END proof -->

### SC-CHG-002 — An immediate change may improve the service; it may not shorten the commitment

🟢 💰 Everything else waits for the term to end, which is where a shorter period may legitimately
begin.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - an immediate change may not shorten the term
        - the matrix is complete
        - ${label} takes effect ${expected ? 'now' : 'at term end'}

<!-- END proof -->

### SC-CHG-003 — An immediate upgrade extends the running term, it does not restart it

🟢 💰 The customer keeps the period they already paid for, the higher plan runs inside it, and only
the difference is charged for what is left of it. So an immediate upgrade never lengthens the
commitment.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - a plan change reopens the window
        - and the day the customer is billed on moves with it
- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - an immediate change may not shorten the term
        - the matrix is complete
        - ${label} takes effect ${expected ? 'now' : 'at term end'}

<!-- END proof -->

### SC-CHG-004 — A yearly customer moving to a monthly higher plan gets it at the term end

🟢 They may have the monthly plan; they may not have it today, because starting it today would end
the yearly term they are inside. It is offered later rather than refused.

_Source:_ #212 · `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - the deferred upgrade explains itself
        - a yearly customer choosing a monthly higher plan is told why it waits
        - the same upgrade on the same cycle happens now and says nothing

<!-- END proof -->

### SC-CHG-005 — A downgrade takes effect at the end of the term

🟢 💰 Never immediately.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a deferred change waits for the commitment, not just the period
        - the later of period end and minimum term is the effective date
        - without a commitment the period end still decides

<!-- END proof -->

### SC-CHG-006 — A deferred change lands at the later of the period end and the commitment

🟢 💰 A commitment that outlasts the period is what a notice period produces, and a change landing at
the period end would take effect inside it.

_Source:_ #212 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a deferred change waits for the commitment, not just the period
        - the later of period end and minimum term is the effective date
        - without a commitment the period end still decides
- `packages/nest/tests/pending-plan-materialization.test.js`
    - materializes all due pending plan changes and invalidates each tenant
    - defaults to MONTHLY cycle when pendingBillingCycle is null
    - is non-fatal per tenant — one failure does not abort the run
    - no-op when nothing is due

<!-- END proof -->

### SC-CHG-007 — A change scheduled for the term end may take any billing rhythm

🟢 The term ends on that date either way, so the rhythm of the plan that starts there is free.

_Source:_ #212

### SC-CHG-008 — A change that arrives later is the headline, and has to be acknowledged

🟢 Somebody who presses "upgrade" and then sees nothing change for eleven months has been told
something they did not read, and a line among the warnings is exactly where a reader does not
look. An acknowledgement of one date is not an acknowledgement of the next one.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - the deferred upgrade explains itself
        - a yearly customer choosing a monthly higher plan is told why it waits
        - the same upgrade on the same cycle happens now and says nothing
- `packages/ui-vue-tenant/tests/component/a-later-change-is-acknowledged.test.ts`
    - a shorter cycle defers everything, and says so first
        - the block appears, led by what the customer does not get today
        - it offers the alternative rather than only describing it
        - the confirmation is locked until it is acknowledged
        - an ordinary upgrade shows none of it
        - a downgrade is a different sentence, not this one
    - a downgrade names what falls away, and when
        - the heading counts the features and dates the loss
        - every lost feature is listed, not just counted
        - the confirmation is locked until it is acknowledged
        - a downgrade that costs no feature says so instead of counting zero
    - a cycle change is acknowledged too
        - it says the rhythm changes later, and a new term starts then
        - the confirmation is locked until it is acknowledged
    - the dates stand out from the sentence around them
        - the effective date is set in bold, the rest is not
    - keeping the yearly cycle re-asks rather than reusing the answer
        - the block disappears once the preview describes the new choice
- `packages/ui-vue-tenant/tests/component/plan-change-wizard.test.ts`
    - the wizard refuses a step it may not leave
        - no plan chosen: pressing next changes nothing
        - choosing the plan the tenant is already on is not a change
        - a different plan advances
    - the next button says whether it will do anything
        - no plan chosen: the button is disabled
        - the plan the tenant is already on: still disabled
        - a different plan: enabled
        - on the preview step it follows the blockers
    - focus follows the step the tenant is now on
        - advancing moves focus to the new heading
        - a refused move leaves focus alone
    - the progress list says where the tenant is without relying on colour
        - exactly one step is marked current, and it carries a word

<!-- END proof -->

### SC-CHG-009 — The date the tenant was shown is the date the change is made on

🟢 💰 A confirmation quoting a date that has moved since it was shown is refused rather than silently
applied. A wrong date here is a year of somebody's money, and the page can ask again in a second.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-confirmed-date-is-the-one-that-applies.test.js`
    - the confirmed date is the one that applies
        - a matching expectation goes through
        - a stale one is refused, and the answer carries the new date
        - no expectation still works
- `packages/ui-vue-tenant/tests/component/plan-change-wizard.test.ts`
    - the wizard refuses a step it may not leave
        - no plan chosen: pressing next changes nothing
        - choosing the plan the tenant is already on is not a change
        - a different plan advances
    - the next button says whether it will do anything
        - no plan chosen: the button is disabled
        - the plan the tenant is already on: still disabled
        - a different plan: enabled
        - on the preview step it follows the blockers
    - focus follows the step the tenant is now on
        - advancing moves focus to the new heading
        - a refused move leaves focus alone
    - the progress list says where the tenant is without relying on colour
        - exactly one step is marked current, and it carries a word

<!-- END proof -->

### SC-CHG-010 — Every refusal the preview shows is also enforced where the change is made

🟢 A caller that skips the preview meets the same answer. A refusal only the client honours is not
enforcement.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-change-preview.test.js`
    - preview returns UPGRADE STARTER→STANDARD with proration and feature diff
    - preview returns DOWNGRADE STANDARD→STARTER with users blocker when usage too high
    - preview blocks ENTERPRISE as a self-service target
    - the self-service refusal names the plan and says what to do about it
    - preview NOOP when plan and cycle are identical
    - preview returns CYCLE_CHANGE on MONTHLY→YEARLY at the same plan
    - limitsCheck renders the union of quota keys from limits, target plan and usage
- `packages/nest/tests/the-plan-preview-sees-the-bookings.test.js`
    - the plan-change rule reaches the bookings in a real container
        - a yearly add-on blocks a move to monthly when the module is composed normally
        - it asks as of the day the change lands, not today
        - nothing booked, nothing blocked
- `packages/nest/tests/the-server-decides-when-a-change-lands.test.js`
    - a plan change is timed by the rules, not by the request
        - a caller asking for "immediately" on a deferred change is scheduled anyway
        - a caller asking for nothing on an immediate change still gets it today
        - the scheduled date is the preview's, not a second computation

<!-- END proof -->

### SC-CHG-011 — A decision taken against one state is not written into another

🟢 If the subscription changed in between — a cancellation arriving, for instance — the request is
refused and nothing is written, and the caller is told to look again.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a cancellation arriving while a plan change is being decided
        - the immediate change is refused rather than written over it
        - and so is the scheduled one
        - while an unchanged subscription is written as decided
    - a boundary that passes while the request is being decided
        - is refused rather than written a moment late

<!-- END proof -->

### SC-CHG-012 — A tenant cannot move to a plan whose limits their usage already exceeds

🟢 They are told which limit and by how much, and reduce usage first.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-change-preview.test.js`
    - preview returns UPGRADE STARTER→STANDARD with proration and feature diff
    - preview returns DOWNGRADE STANDARD→STARTER with users blocker when usage too high
    - preview blocks ENTERPRISE as a self-service target
    - the self-service refusal names the plan and says what to do about it
    - preview NOOP when plan and cycle are identical
    - preview returns CYCLE_CHANGE on MONTHLY→YEARLY at the same plan
    - limitsCheck renders the union of quota keys from limits, target plan and usage

<!-- END proof -->

### SC-CHG-013 — A change that removes features warns, it does not refuse

🟢 The tenant is told how many they lose, and that existing data is kept and comes back on upgrading.
Somebody deciding whether to downgrade is deciding whether they lose their work, and the answer is
no.

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-014 — Nothing starts after the end, and nothing sells a period the end cuts short

🟢 A change scheduled before a cancellation must not come due after it and restart a term that is
over, and an immediate change on a subscription that is ending opens no fresh period. A
cancellation that has not yet landed refuses nothing, though: a customer who bought a further
period by cancelling late may still choose the plan they spend it on.

_Source:_ #219 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a subscription that has ended
        - refuses a plan change instead of charging for one
        - while a running one still changes plans
    - a cancellation still to come
        - lets the plan change, and does not sell a term it cuts short
        - while an uncancelled subscription does get a fresh term
    - a change scheduled before the customer cancelled
        - is declined once the cancellation has taken effect
        - but a cancellation still to come declines nothing
        - and an uncancelled subscription is applied as before
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a change and a cancellation on the same day
        - the ending wins, exactly at the moment they meet
        - and a minute earlier the change still happens

<!-- END proof -->

### SC-CHG-015 — A cancelled subscription cannot change its billing rhythm

🟢 The plan may still move on the rhythm it was sold in. What may not move is the rhythm the ending
was calculated in.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a cycle change while a cancellation is outstanding
        - the preview says so before the reader has decided anything
        - and an ended subscription is refused outright, not merely locked
        - and says nothing when the cycle stays
        - is refused, because the ending was calculated in the old rhythm
        - while the plan still moves on the cycle it was sold in
        - and an uncancelled subscription may change cycle freely

<!-- END proof -->

### SC-CHG-016 — A plan cannot be changed while onboarding is still running

🟢

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-017 — Choosing the plan and rhythm already in force is refused as no change

🟢 Rather than being applied as one and producing a charge.

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-018 — Every blocker and warning carries values a client can rebuild the sentence from

🟢 The number used, the limit, the quota, the plan name — beside the code rather than inside a
finished English sentence. Without them a client holding the code would have to parse prose for
the numbers.

_Source:_ #243

## 7. Cancelling

Cancelling is the part of a subscription a customer is most likely to dispute, so the rules are
written to be defensible rather than convenient. Two of them read backwards at first: a
cancellation may always be declared even when it cannot take effect soon, and a cancelled
subscription keeps everything until its date arrives.

### SC-CANC-001 — A cancellation may always be declared

🟢 The rules govern when it takes effect, not whether it may be made. A tenant is never told they may
not leave.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with no notice period, which is the default
        - a cancellation lands at the end of the term
        - the last day of the term is still in time

<!-- END proof -->

### SC-CANC-002 — A cancellation takes effect at the later of the period end and the commitment

🟢 💰 They coincide unless a notice period has pushed one past the other.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with no notice period, which is the default
        - a cancellation lands at the end of the term
        - the last day of the term is still in time
    - when the term and the period disagree
        - the later of the two decides
        - a subscription with no term at all falls back to the period

<!-- END proof -->

### SC-CANC-003 — A tenant cannot end a subscription on the spot

🟢 The tenant-facing route offers no immediate termination. Ending a contract on the spot is an
operator's act, through the operator's own path.

_Source:_ #212

### SC-CANC-004 — Where nothing is left to run, the cancellation lands now, never in the past

🟢 Deferring to a period end that has already gone would report a date the reader has to reason about
backwards.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - when nothing is left to run
        - a term already past lands the cancellation now
        - no dates at all is the same answer
- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a cancellation with nothing left to run
        - ends the subscription instead of leaving it active
        - and the date it lands on is the declaration itself
- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a cancellation that lands at once
        - ends the contract now, status and all
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a tenant still waiting on sales
        - cancels immediately, because nothing was ever committed
        - and one that did get a period keeps it

<!-- END proof -->

### SC-CANC-005 — There is no notice period until an installation names one

🟢 💰 Every installation states both numbers in `config/saas.yaml`, and one that states neither does
not start. Zero is what most should write: a cancellation declared on the last day of a period then
still takes effect at the end of that period, which is the reading a customer expects and the one
that generates no disputes. It is written down rather than defaulted, because a notice period is a
commercial decision and an unwritten one is a decision nobody made.

_Source:_ #212 · #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with no notice period, which is the default
        - a cancellation lands at the end of the term
        - the last day of the term is still in time

<!-- END proof -->

### SC-CANC-006 — A notice period belongs to a rhythm, not to an installation

🟢 💰 One number could not be right for both. A fortnight of notice on a yearly contract is unusual;
three months on a monthly one is void against a consumer in Germany. Each rhythm is configured
separately, and neither inherits the other — inferring one from the other would be inventing a
term. A configuration naming only one of them is therefore refused rather than read as zero for
the other; see
[SC-CFG-017](#sc-cfg-017--a-required-setting-is-required-member-by-member-not-as-a-block).

_Source:_ #230 · #217 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - which of the two numbers applies
        - a monthly subscription is owed the monthly notice
        - a yearly subscription is owed the yearly notice
        - an explicit zero is a zero, not an absence

<!-- END proof -->

### SC-CANC-007 — The rhythm that decides the notice is the subscription's, not the plan's

🟢 💰 A customer on a yearly subscription is owed the yearly notice, even where the same plan is also
sold monthly.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-follows-the-contracts-rhythm.test.js`
    - a notice follows the rhythm of the contract
        - one plan, two contracts, two deadlines
        - the yearly contract is owed the longer of the two
- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - which of the two numbers applies
        - a monthly subscription is owed the monthly notice
        - a yearly subscription is owed the yearly notice
        - an explicit zero is a zero, not an absence

<!-- END proof -->

### SC-CANC-008 — No upper limit is placed on a notice period

🟢 The platform does not know whether an installation serves consumers or businesses, so the number
is the operator's to choose and the legal risk is theirs. What it costs is documented rather than
enforced.

_Source:_ #230 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - a year of notice on a yearly contract
        - is served by one step, because a year of period covers it

<!-- END proof -->

### SC-CANC-009 — A missed notice deadline moves the cancellation to the end of the next period

🟢 💰 A hard cut, not a grace period. It costs a customer real money, which is why the period a
cancellation lands in has to be stated before they confirm it.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - a cancellation that arrives after the notice window
        - buys the period the customer is billed for, to its day
        - and without a stored anchor keeps the old, shorter answer
        - while an on-time cancellation does not reach the step at all
- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with a notice period configured
        - before the window closes, nothing changes
        - on the deadline itself, still in time
        - one second later, a whole period later
        - a monthly term moves by a month, not by a year
- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a declaration made after the notice window closed
        - extends the stored commitment to the period it bought
        - so a plan change cannot be scheduled inside that period
- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - a notice shorter than the period behaves as it always did
        - declared in time, it ends with the period
        - declared too late, it ends one period on — which already serves it
        - the deadline is a real date, reachable by declaring earlier
        - no notice at all ends with the period, whenever it is declared
        - a term already over ends now, not at a date in the past

<!-- END proof -->

### SC-CANC-010 — A cancellation lands on the first period end that actually serves the notice

🟢 💰 However long the notice is. Advancing by exactly one period gave a customer between 31 and 60
days of a 60-day notice depending on which day they happened to declare — the operator promised
sixty and the customer received thirty-one. A misconfiguration should cost the customer a longer
wait, not cost the operator a promise the software cannot keep.

_Source:_ #230

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with a notice period configured
        - before the window closes, nothing changes
        - on the deadline itself, still in time
        - one second later, a whole period later
        - a monthly term moves by a month, not by a year
- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - a notice longer than the period is served, not approximated
        - declaring on ${declaredOn} still buys 60 days
        - and it lands on a billing boundary, not sixty days from today
        - the anchor survives the extra steps
    - a port that does not store the billing day
        - the fallback day is read once, not at every step
        - and a single step is unaffected, which is why this hid so long
        - a stored anchor still wins over the fallback

<!-- END proof -->

### SC-CANC-011 — A late cancellation extends the recorded commitment to the period it bought

🟢 💰 Every other reader of the term end looks at the commitment, so a downgrade scheduled meanwhile
would otherwise land inside the period the customer had just paid for.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a cancellation inside a running term
        - leaves the subscription running
        - and does not touch the commitment
    - a declaration made after the notice window closed
        - extends the stored commitment to the period it bought
        - so a plan change cannot be scheduled inside that period

<!-- END proof -->

### SC-CANC-012 — Declaring the same cancellation twice does not move it

🟢 The second press reports the existing cancellation and writes nothing. Where a notice period is
configured, re-deciding after the deadline pushed an on-time declaration a whole period further
out: the customer pressed the same button twice and bought a year.

_Source:_ #212 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-declared-once.test.js`
    - cancelling twice does not move the date
        - the second request writes nothing and returns the first answer
        - a first cancellation still writes
- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a cancellation that was already recorded
        - is repaired on the next attempt rather than reported and left

<!-- END proof -->

### SC-CANC-013 — Two cancellations arriving at once produce one

🟢 The second one reads back what the first wrote rather than replacing an on-time date with one a
period later.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - two declarations arriving at once
        - the second one reports the first one rather than replacing it

<!-- END proof -->

### SC-CANC-014 — A repeated cancellation does not explain itself with figures it cannot know

🟢 The deadline and whether the declaration was late come back as unanswered rather than recomputed,
because recomputing them would report a declaration that landed a period late as an on-time one.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-declared-once.test.js`
    - what a repeat may say about the first cancellation
        - the date, and nothing it cannot know
        - while a first cancellation explains itself in full
    - a cancellation older than the fields that describe it
        - stops the renewal
        - and a repeat of it is recognised as one
- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a cancellation older than the fields that describe it
        - still reports when it lands
        - and an uncancelled subscription still reports nothing

<!-- END proof -->

### SC-CANC-015 — A tenant who has cancelled is told from which date

🟢 And the act they have already performed is no longer offered to them. A tenant who cancels in
month three of a year and sees only the word "cancelled" has lost nothing yet and believes they
have.

_Source:_ #219

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - confirming a cancellation that lands immediately
        - is not refused for having read the clock a moment earlier
        - but a date still in the future is refused
- `packages/ui-vue-tenant/tests/component/an-ended-subscription-reads-as-ended.test.ts`
    - a subscription that has ended
        - says so, in the past tense
        - and offers neither of the two acts it no longer has
    - a cancellation still to come
        - runs unchanged, and says that instead
        - and the plan can still be changed
    - a subscription with no cancellation
        - says nothing about one and offers both acts
    - a cancellation older than the fields that describe it
        - is read from the only column it has
    - a card left open across the moment
        - follows the boundary instead of the last render
        - reaches a boundary further away than one hop
        - and asks for no delay the platform would truncate
    - the page around the card
        - shows an ended subscription as cancelled, whatever its status column says
        - and a running one keeps its badge and its billing date
        - offers no pending version to accept once the contract is over
        - while a running subscription is asked about it
    - a cancellation that arrives after the page did
        - is measured from now, not from when the card was created

<!-- END proof -->

### SC-CANC-016 — A subscription is in one of three states, not two

🟢 Running; running with a cancellation still to come; over. The middle one is the one that gets
lost, and it keeps every entitlement it had until the date arrives. A page showing it follows the
effective moment on a timer rather than on the last render.

_Source:_ #219 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - what else ends when the subscription does
        - the frozen contract is ended on the same date
        - and a cancellation already recorded repairs its contract too
        - and a consumer without contracts is unaffected
- `packages/ui-vue-tenant/tests/component/a-cancelled-plan-still-runs.test.ts`
    - while nothing is cancelled
        - the tenant is offered the act
        - and told nothing about a cancellation
    - once it is cancelled
        - the date is shown, not just the word
        - and the subscription is described as unchanged until then
        - the act is no longer offered
        - changing plan still is
- `packages/ui-vue-tenant/tests/component/an-ended-subscription-reads-as-ended.test.ts`
    - a subscription that has ended
        - says so, in the past tense
        - and offers neither of the two acts it no longer has
    - a cancellation still to come
        - runs unchanged, and says that instead
        - and the plan can still be changed
    - a subscription with no cancellation
        - says nothing about one and offers both acts
    - a cancellation older than the fields that describe it
        - is read from the only column it has
    - a card left open across the moment
        - follows the boundary instead of the last render
        - reaches a boundary further away than one hop
        - and asks for no delay the platform would truncate
    - the page around the card
        - shows an ended subscription as cancelled, whatever its status column says
        - and a running one keeps its badge and its billing date
        - offers no pending version to accept once the contract is over
        - while a running subscription is asked about it
    - a cancellation that arrives after the page did
        - is measured from now, not from when the card was created

<!-- END proof -->

### SC-CANC-017 — The period a cancellation lands in is stated before the tenant confirms it

🟢 Not afterwards, and not on a receipt.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - confirming a cancellation that lands immediately
        - is not refused for having read the clock a moment earlier
        - but a date still in the future is refused

<!-- END proof -->

### SC-CANC-018 — The agreed contract ends when the subscription does, not when the customer declares

🟢 Both mistakes are available and both are wrong. Leaving it in force forever outlives the
agreement; ending it on declaration removes it from every lookup while the customer is still under
contract and still paying, so the invoicing side stops finding it.

_Source:_ #218 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a cancellation that lands at the end of the term
        - leaves the contract findable until that date
        - and not one moment past it
    - a cancellation that lands at once
        - ends the contract now, status and all
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - what else ends when the subscription does
        - the frozen contract is ended on the same date
        - and a cancellation already recorded repairs its contract too
        - and a consumer without contracts is unaffected

<!-- END proof -->

### SC-CANC-019 — Recording a cancellation is never blocked by something that follows it

🟢 If the contract could not be closed or the record of the act could not be written, the
cancellation still stands. A tenant is not left uncancelled because a secondary step failed.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a cancellation inside a running term
        - leaves the subscription running
        - and does not touch the commitment
- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a tenant with no contract at all
        - is not an error

<!-- END proof -->

## 8. Trials, pilots and negotiated arrangements

Not every subscription is an ordinary paid one. A trial commits to nothing, a pilot is a granted
arrangement, and an enterprise deal may sit with sales for weeks. Each of them answers the
questions in the previous chapters differently, and this chapter says how — because the failure
mode is a rule written for the ordinary case being applied to one of these.

### SC-SPEC-001 — A trial commits to nothing, so a plan change during one takes effect at once

🟢 Deferring an upgrade to the end of a trial withholds the very thing the customer asked to try.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/codegen-drift.test.js`
    - Q.4 Codegen drift gate
        - every schema has a generated file, and every generated file a schema
        - a schema with no title is refused rather than generated as undefined
        - ${genFile} is in sync with ${file}
- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a trial commits to nothing, so nothing is deferred to protect it
        - the matrix asks more of a trial than of a term
        - on trial, ${label} takes effect ${expected ? 'now' : 'at term end'}

<!-- END proof -->

### SC-SPEC-002 — Cancelling during a trial ends the trial, and no sooner

🟢 It lands when the trial does. Ending it on the spot would take the trial away as the price of
saying they do not want to convert; treating it as a term meant a customer cancelling a
yearly-cycle trial bought a year.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - a trial has an end, not a term
        - the cancellation lands when the trial does
        - a notice period does not buy a billing cycle
        - and a paid term five days out still does
        - a trial with no dates at all still lands now

<!-- END proof -->

### SC-SPEC-003 — A notice period never applies to a trial

🟢 The window exists so a term cannot be left at the last moment, and a trial has no term to leave.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - a trial has an end, not a term
        - the cancellation lands when the trial does
        - a notice period does not buy a billing cycle
        - and a paid term five days out still does
        - a trial with no dates at all still lands now

<!-- END proof -->

### SC-SPEC-004 — Switching plans during a trial carries the remaining trial time over

🟢 The time already used is deducted rather than restarted, and repeated switches do not accumulate
or lose days. Where the plan being moved to has no trial, the trial end stays where it was.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/trial-carryover.test.js`
    - carries remaining trial time to a target plan with a longer trial
    - is drift-free across repeated switches (reconstructs trial start)

<!-- END proof -->

### SC-SPEC-005 — A trial grants the trial's entitlements, not the booked plan's

🟢 And it opens no billing period; the agreement is frozen when the subscription becomes a paid one.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-plan-resolution.test.js`
    - resolveEntitlementPlan — Trial / Pilot / Pending
        - Default: no override → subscription.plan
        - Pilot: pilotEntitlementPlan overrides
        - Pilot without config: falls back to subscription.plan
        - TRIAL: subscription.trialEntitlementPlan wins
        - TRIAL without trialEntitlementPlan: falls back to defaultTrialEntitlementPlan
        - TRIAL with no config at all: falls back to subscription.plan
        - PENDING_SALES: pendingSalesEntitlementPlan overrides
        - Pending plan change: takes effect once pendingEffectiveAt is in the past
        - Pending plan change: does NOT take effect while pendingEffectiveAt is in the future
        - Pilot beats pending plan change: Pilot dominates
        - TRIAL beats pending plan change: Trial dominates

<!-- END proof -->

### SC-SPEC-006 — A pilot arrangement outranks every other way of resolving what a tenant may do

🟢 Ahead of trial, ahead of a pending negotiation, ahead of a scheduled change.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-plan-resolution.test.js`
    - resolveEntitlementPlan — Trial / Pilot / Pending
        - Default: no override → subscription.plan
        - Pilot: pilotEntitlementPlan overrides
        - Pilot without config: falls back to subscription.plan
        - TRIAL: subscription.trialEntitlementPlan wins
        - TRIAL without trialEntitlementPlan: falls back to defaultTrialEntitlementPlan
        - TRIAL with no config at all: falls back to subscription.plan
        - PENDING_SALES: pendingSalesEntitlementPlan overrides
        - Pending plan change: takes effect once pendingEffectiveAt is in the past
        - Pending plan change: does NOT take effect while pendingEffectiveAt is in the future
        - Pilot beats pending plan change: Pilot dominates
        - TRIAL beats pending plan change: Trial dominates

<!-- END proof -->

### SC-SPEC-007 — Granting, withdrawing or extending a pilot is a deliberate operator act

🟢 It needs a second factor and an explicit confirmation, and it is recorded.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/pilot-dialogs.test.ts`
    - PilotCreateDialog
        - blocks submitting while required fields are missing
        - draws the plan picker from the options passed in
        - derives the slug from the name
    - PilotEditDialog
        - adopts plan, end date and note from the row
        - draws the same plan picker as the create dialog
        - offers preset buttons for the end date

<!-- END proof -->

### SC-SPEC-008 — A negotiated arrangement is expressed as limits set for that tenant

🟢 Limits set for the tenant replace the plan's; features set for the tenant are added to the plan's.
The two behave differently on purpose: a negotiated limit is a substitution, a negotiated feature
is an addition.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - applyCustomLimits
        - null/undefined custom: no change
        - quotas override overwrites field by field
        - features override adds
        - mutation of the input is forbidden (pure function)

<!-- END proof -->

### SC-SPEC-009 — A subscription waiting on a negotiated contract falls back to a named interim plan

🟢 It has no billing period, and cancelling it takes effect immediately, because there is nothing
running to see out.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-plan-resolution.test.js`
    - resolveEntitlementPlan — Trial / Pilot / Pending
        - Default: no override → subscription.plan
        - Pilot: pilotEntitlementPlan overrides
        - Pilot without config: falls back to subscription.plan
        - TRIAL: subscription.trialEntitlementPlan wins
        - TRIAL without trialEntitlementPlan: falls back to defaultTrialEntitlementPlan
        - TRIAL with no config at all: falls back to subscription.plan
        - PENDING_SALES: pendingSalesEntitlementPlan overrides
        - Pending plan change: takes effect once pendingEffectiveAt is in the past
        - Pending plan change: does NOT take effect while pendingEffectiveAt is in the future
        - Pilot beats pending plan change: Pilot dominates
        - TRIAL beats pending plan change: Trial dominates
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a tenant still waiting on sales
        - cancels immediately, because nothing was ever committed
        - and one that did get a period keeps it

<!-- END proof -->

## 9. Prices, proration, tax and money

Money is the one area where an error is both invisible and unforgivable. This chapter fixes how
part-periods are calculated, what happens when arithmetic goes the wrong way, and which facts
about an amount are recorded rather than re-derived later. Some of it is decided and not yet
built; those entries say so.

### SC-PRIC-001 — SaaSiCat computes prices; the integrator bills them

🟢 💰 Nothing is stored as an amount that was paid, which is also why no credit can be owed when a
period is shortened.

_Source:_ #222

### SC-PRIC-002 — A part-period is charged by days

🟢 💰 Not by whole months. Plan changes and add-on bookings then answer with the same arithmetic, so
two screens describing one situation cannot quote different figures.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - what the short first period costs
        - the cycle it is charged against ends where the first period does
        - a yearly bundle is charged against a year, not a month
        - the anchor survives being walked backwards, the same as forwards
        - stepping back from January lands in December of the year before
        - a leap day retreats to the 28th, and forwards again to the 29th
        - the start it gives back is the boundary that leads to that end
- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewAdd
        - proration: prorated amount until period end + next-period price
        - YEARLY cycle uses yearlyNet, plan-specific pricing override wins
        - TRIAL: no proration (no paid period yet)
        - the preview quotes no commitment, because a booking makes none
        - the preview quotes a commitment an operator configured
        - redundancy (AK-13): feature already in plan → hint + warning
        - redundancy: feature already in another active bundle → hint with bundleKey
        - requires (#35): uncovered dependency → missingRequires + blocker
        - requires: coverage by plan or active bundle → no blocker
        - requires: without CatalogEntryRepository no check (graceful)
        - self-service policy: sales-only bundle → blocker BUNDLE_NOT_SELF_SERVICE
        - blocker: plan-incompatible + already booked
        - unknown bundle version → NotFound

<!-- END proof -->

### SC-PRIC-003 — This platform never pays money back

🟢 💰 A prorated fee is floored at zero. Where a change lowers the price, the upgrade is free rather
than producing a credit, and a cancellation is never refunded pro rata — the booking stays active
and paid to the end of its period.

_Source:_ #212 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a prorated upgrade never asks for less than nothing
        - a cheaper target after a price cut is free rather than a credit
        - an ordinary upgrade still costs what it costs
        - a change that costs exactly nothing is not a free upgrade

<!-- END proof -->

### SC-PRIC-004 — "Free upgrade" and "costs nothing" are two different sentences

🟢 💰 A change that is free because the arithmetic went negative is not the same as one that costs
nothing because the two plans are priced alike, and somebody deciding is owed the difference.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a prorated upgrade never asks for less than nothing
        - a cheaper target after a price cut is free rather than a credit
        - an ordinary upgrade still costs what it costs
        - a change that costs exactly nothing is not a free upgrade

<!-- END proof -->

### SC-PRIC-005 — There is no proration during a trial

🟢 💰 There is no paid period to take a fraction of.

_Source:_ release 1.0.0-rc.6

### SC-PRIC-006 — The preview and the booking describe the same contract

🟢 💰 A tenant who was quoted a price and a term gets that price and that term.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-change-preview.test.js`
    - preview returns UPGRADE STARTER→STANDARD with proration and feature diff
    - preview returns DOWNGRADE STANDARD→STARTER with users blocker when usage too high
    - preview blocks ENTERPRISE as a self-service target
    - the self-service refusal names the plan and says what to do about it
    - preview NOOP when plan and cycle are identical
    - preview returns CYCLE_CHANGE on MONTHLY→YEARLY at the same plan
    - limitsCheck renders the union of quota keys from limits, target plan and usage
- `packages/ui-vue-tenant/tests/component/a-preview-in-flight-blocks-the-confirmation.test.ts`
    - while a replacement preview is on the wire
        - the answer to the abandoned question is taken off the screen
        - and the confirmation cannot be given
    - when the answers come back out of order
        - the outdated one does not install itself

<!-- END proof -->

### SC-PRIC-007 — An amount a tenant sees is the amount that is charged

🟢 💰 Money is held to two decimal places and never as a floating-point number, and the same
arithmetic produces the same figure in the backend, the tenant's page and the administration.
Discounts, part periods and tax do not accumulate a difference between what a page shows and what is
billed.

_Source:_ `docs/explanation/data-model.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue-tenant/tests/component/a-bundle-is-bought-in-a-rhythm.test.ts`
    - a monthly plan offers no choice
        - the card quotes the monthly price with the monthly unit
    - a yearly plan offers both
        - switching moves the price and the unit together

<!-- END proof -->

### SC-PRIC-008 — Gross, net and tax are one calculation, stated once

🟢 💰 Gross follows from net and the configured rate, and the tax contained in a gross amount follows
from the same rate. Both are rounded once and mean the same thing everywhere they appear.

_Source:_ release 1.0.0-rc.7

### SC-PRIC-009 — An installation sells in one currency and applies one tax rate, both named once

🟢 💰 The tax rate is required even when it is zero, so nobody is left wondering whether it was
forgotten. Changing the currency after contracts exist is a migration rather than an edit, because
a currency change must not silently relabel history.

_Source:_ #217 · #214

### SC-PRIC-010 — A yearly price is a price per year, not a monthly price with a discount attached

🟢 💰 Whatever a pricing page chooses to display.

_Source:_ `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the prices a store is shown
        - a bundle sold in one rhythm only says so for the other

<!-- END proof -->

### SC-PRIC-011 — A plan that is not marketed has no list price

🟢 💰 It is sold by negotiation, and no page invents a figure for it.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-catalog-controller.test.js`
    - listPlans returns only marketed plans in the generic format
    - a plan sold by negotiation is left out even when a figure is on file

<!-- END proof -->

### SC-PRIC-012 — A contract mixing rhythms totals one period of its own rhythm

🟢 💰 A monthly add-on beside a yearly plan counts as often as it falls due within that year, not
once.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a yearly contract holding a monthly add-on
        - counts the add-on as often as it falls due
        - a yearly add-on beside a yearly plan is counted once
        - a monthly contract adds a monthly add-on as it stands
- `packages/nest/tests/tenant-subscription-bundles-refreeze.test.js`
    - add re-freezes the contract with an unchanged plan
    - cancel re-freezes the contract
    - without a ContractFreezePort, add works unchanged
    - freeze error is non-fatal — the mutation result still comes back
    - a failed mutation triggers no freeze

<!-- END proof -->

### SC-PRIC-013 — Amounts of money cross the wire exactly, not as approximations

🟢 💰 So that nothing is lost between the system that computed a figure and the one that shows it.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/canonical-rows-become-records.test.js`
    - a line item row becomes a line item record
        - an amount arrives with the cent it left with

<!-- END proof -->

### SC-PRIC-014 — The number of decimal places follows the currency

🟢 💰 Two for euros, none for yen. That is a property of the currency, not a formatting preference.

_Source:_ #105

### SC-PRIC-015 — An amount records the currency it was booked in

🟢 💰 Even though only one is configured at a time. The record is not for selling in two currencies;
it is so that a row written in 2026 still means what it meant.

_Source:_ #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/canonical-rows-become-records.test.js`
    - a line item row becomes a line item record
        - the currency and the tax come back as the row recorded them
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - what a frozen line records about its money
        - every line names the currency and the rate the installation applies
        - and the tax it names closes the gap between its own net and gross
        - a rate of zero is recorded as zero, not left to be read as absent
        - a currency other than the euro is the one that is recorded
- `packages/nest/tests/subscription-contract-service.test.js`
    - the money facts a contract inherits from its offer
        - a rate the offer states as a fraction is recorded in per cent
        - and the rate it records explains the tax it records
        - every line names the currency the offer froze
        - and the tax on each closes the gap between its own net and gross
        - the discount the offer implies carries a negative tax, not a positive one
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a line item learns the money it was booked with
        - the values come from the contract the line belongs to

<!-- END proof -->

### SC-PRIC-016 — A tax rate has a validity window

🟢 💰 A contract concluded at 19 % is charged 19 % for its term, whatever the rate later becomes.

_Source:_ #217 · #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-contract-service.test.js`
    - the money facts a contract inherits from its offer
        - a rate the offer states as a fraction is recorded in per cent
        - and the rate it records explains the tax it records
        - every line names the currency the offer froze
        - and the tax on each closes the gap between its own net and gross
        - the discount the offer implies carries a negative tax, not a positive one
- `packages/nest/tests/validity-window.test.js`
    - the window a version is refused for
        - no start at all
        - a start that is not a date
        - a start on or before the predecessor’s
        - a start that leaves a gap after a predecessor that ends
        - a predecessor without an end imposes no seam
        - an end that is not a date
        - an end on or before the start
        - the codes come from the caller, so a plan refuses as a plan
        - the gapless refusal says which day it wanted

<!-- END proof -->

### SC-PRIC-017 — The tax rate and the tax amount are recorded, not re-derived

🟢 💰 Storing net and gross leaves the rate living in the ratio between them, and a ratio cannot be
reproduced for a rounded gross, cannot express an exempt or reverse-charge line, and does not
survive a rate change.

_Source:_ #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/canonical-rows-become-records.test.js`
    - a line item row becomes a line item record
        - the currency and the tax come back as the row recorded them
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - what a frozen line records about its money
        - every line names the currency and the rate the installation applies
        - and the tax it names closes the gap between its own net and gross
        - a rate of zero is recorded as zero, not left to be read as absent
        - a currency other than the euro is the one that is recorded
- `packages/nest/tests/subscription-contract-service.test.js`
    - the money facts a contract inherits from its offer
        - a rate the offer states as a fraction is recorded in per cent
        - and the rate it records explains the tax it records
        - every line names the currency the offer froze
        - and the tax on each closes the gap between its own net and gross
        - the discount the offer implies carries a negative tax, not a positive one
    - reading the unit an offer states its VAT rate in
        - a fraction beside totals that agree with it becomes a percentage
        - a percentage beside totals that agree with it is left as it is
        - zero is zero under either reading
        - totals that prove nothing fall to the unit this platform produces
        - a total of nothing is still read as the fraction it is
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a line item learns the money it was booked with
        - the values come from the contract the line belongs to
        - a rate no reading brings inside 0-100 stops the migration and is named
        - a free plan frozen from the catalogue keeps its rate as it stands

<!-- END proof -->

### SC-PRIC-018 — Rounding happens once, when a charge is written

🟡 _(Decided, not yet delivered.)_ 💰 The written figure is the truth from then on.

_Source:_ #214

### SC-PRIC-019 — A tenant can see their own account

🟡 _(Decided, not yet delivered.)_ 💰 Balance, what is open, and the history. An open balance a
customer cannot see is a surprise at the moment it becomes a problem; one they can see is something
they can act on.

_Source:_ #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/tenant-billing-controller.test.js`
    - getEntitlement returns EffectiveLimitsSnapshot generically (quotas map)
    - getUsage joins Subscription + Limits + Usage and fills missing quotaKeys with 0
    - getUsage passes packageSnapshot + checkoutOfferId through 1:1 (P11.4)
    - getUsage returns packageSnapshot=null when the Subscription has no snapshot
    - getUsage throws NotFoundException when the Subscription is missing
    - the tenant is taken from the session, not from what the caller sent
    - and a session that names none is refused rather than falling back
    - getUsage throws NotFoundException when tenantIdResolver yields no ID
    - ComposedTenantAuthGuard chains guards in order — all ok = true
    - ComposedTenantAuthGuard short-circuits on the first false
    - ComposedTenantAuthGuard throws 403 without configured guards

<!-- END proof -->

### SC-PRIC-020 — A charge, once written, is never edited

🟡 _(Decided, not yet delivered.)_ 💰 A correction is a counter-entry. A record that can be rewritten
answers what somebody thinks today, not what happened.

_Source:_ #214

### SC-PRIC-021 — An internal account reference is never shown to a customer as an invoice number

🟡 _(Decided, not yet delivered.)_ Invoice numbering is sequential, gapless and legally constrained
per country, and an identifier a customer has already seen on a screen cannot become one later
without confusion.

_Source:_ #214

## 10. What a tenant may do at runtime

Everything above decides what was sold. This chapter is about the moment it is applied: a request
arrives, and the answer has to be the one the contract gives. These are the requirements an
integrating developer relies on most directly, because a mistake in them is either a customer
paying for something they cannot use or using something they did not pay for.

### SC-ENTL-001 — What a tenant may do is their plan plus the add-ons they booked

🟢 Features are the union; limits add up.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - aggregateLimits — main aggregator
        - plan default without bundles
        - plan + bundle quotas sum additively
        - bundle features add to the features set
        - plannedOnly features are consistently hidden
        - customLimits.quotas overrides plan + bundles
        - canceled bundles (canceledEffectiveAt &lt; now) are not included
        - bundle quota in a quota dimension the plan does not have is passed through
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — deriveLimits + Resolution
        - TRIAL: uses trialEntitlementPlan via DB lookup
        - Pilot with config: pilotEntitlementPlan overrides
- `packages/nest/tests/entitlement-subscription-bundle-aggregation.test.js`
    - SubscriptionBundle aggregation (P11.7.3)
        - filterActiveSubscriptionBundles: canceled with a past effective date are dropped
        - aggregateSubscriptionBundleQuotas: Σ per key, -1 dominates
        - collectSubscriptionBundleFeatures: set union
        - aggregateLimits: bundle quotas add to plan quotas + bundle features are included
        - aggregateLimits: canceled bundle is ignored
        - aggregateLimits: -1 in a bundle quota makes the total quota unlimited
        - aggregateLimits without subscriptionBundles → plan-only behavior unchanged

<!-- END proof -->

### SC-ENTL-002 — An unlimited allowance beats any number, and an absent one counts as none

🟢 So a single unlimited grant cannot be diluted by adding numbers to it, and a limit nobody set is
not silently generous.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - aggregateLimits — main aggregator
        - plan default without bundles
        - plan + bundle quotas sum additively
        - bundle features add to the features set
        - plannedOnly features are consistently hidden
        - customLimits.quotas overrides plan + bundles
        - canceled bundles (canceledEffectiveAt &lt; now) are not included
        - bundle quota in a quota dimension the plan does not have is passed through
- `packages/nest/tests/entitlement-subscription-bundle-aggregation.test.js`
    - SubscriptionBundle aggregation (P11.7.3)
        - filterActiveSubscriptionBundles: canceled with a past effective date are dropped
        - aggregateSubscriptionBundleQuotas: Σ per key, -1 dominates
        - collectSubscriptionBundleFeatures: set union
        - aggregateLimits: bundle quotas add to plan quotas + bundle features are included
        - aggregateLimits: canceled bundle is ignored
        - aggregateLimits: -1 in a bundle quota makes the total quota unlimited
        - aggregateLimits without subscriptionBundles → plan-only behavior unchanged

<!-- END proof -->

### SC-ENTL-003 — A feature declared as not yet rolled out is never granted

🟢 Wherever it comes from — a plan, an add-on, or a negotiated arrangement. It can be advertised in
the catalogue and still not be handed over.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - filterPlannedOnlyFeatures
        - plannedOnly features are filtered out
        - unknown features (not in catalog) stay in
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — a feature the catalog says is not built yet
        - a contract snapshot that carries it grants everything else instead
        - a contract line item that carries it is treated the same
        - a successor reached through a replaces chain does not slip past it
        - a successor that is built is still granted through the same chain
        - a contract keeps everything the catalog does say is built
        - a feature the catalog has never heard of is left alone

<!-- END proof -->

### SC-ENTL-004 — Once a contract is agreed, it is the truth about what the tenant may do

🔵 _(Superseded on 2026-08-31 by `SC-ENTL-021`.)_ Catalogue edits do not reach a running contract.

_Source:_ `docs/explanation/capability-to-contract.md` · `README.md`

### SC-ENTL-021 — A commercial edit does not reach a running contract; a feature losing its code does

🟢 What was sold stays sold: a price, a quota or a feature set changed in the catalogue leaves an
agreed contract alone. The one edit that does reach it is a feature marked as not yet rolled out,
because that is not a statement about the offer but about whether the capability exists —
`SC-ENTL-003` holds there too, and granting a feature with no code behind it would only weaken the
guard in front of it.

_Source:_ `docs/explanation/capability-to-contract.md` · `README.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - toEffectiveLimitsSnapshot
        - set becomes sorted array (deterministic)
        - snapshot is independent of the original quota object (deep copy)
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — deriveLimits + Resolution
        - TRIAL: uses trialEntitlementPlan via DB lookup
        - Pilot with config: pilotEntitlementPlan overrides
    - EntitlementService — V3 ContractLineItems
        - reads entitlements from active contract snapshot without catalog join
        - Contract entitlementSnapshot wins over line-item aggregation

<!-- END proof -->

### SC-ENTL-005 — A request for something the contract does not include is refused

🟢 🔒 And the refusal may carry what would unlock it, so the tenant is told how to proceed rather than
only that they may not. Where several features would each admit the request, having any one of
them is enough.

_Source:_ `README.md` · `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - hasFeature / hasAnyFeature
        - hasFeature matches
        - hasAnyFeature: at least one is enough
        - hasAnyFeature: empty list → false
- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — annotation evaluation
        - lets routes without @RequireFeature pass unchecked
        - @RequireFeature with an empty array passes unchecked
    - FeatureGuard — feature set matching
        - lets the tenant through when the feature is active in the plan
        - blocks with ForbiddenException when the feature is missing
        - Logical OR: multiple features, one suffices (second matches)
        - Logical OR: none match → Forbidden with all keys in the message
        - Class-level annotation applies when the handler has none
        - Handler annotation overrides class annotation

<!-- END proof -->

### SC-ENTL-006 — A missing feature and an exhausted limit are told apart

🟢 They are two different answers, and a client can act differently on each. An exhausted limit says
which limit and where the tenant stands against it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/feature-guard.test.js`
    - StaticFeatureGuard — FEATURE_NOT_LICENSED body
        - emits the full FeatureNotLicensedBody with empty offers
- `packages/nest/tests/limit-exceeded-filter.test.js`
    - LimitExceededFilter
        - responds with HTTP 402 + standard body shape
        - carries the quota dimension correctly from the exception
        - lets floating-point `used`/`max` pass through for storage
        - robust when method/url are missing from the request

<!-- END proof -->

### SC-ENTL-007 — Two simultaneous requests cannot both take the last remaining unit of a limit

🟢 🔒 Counting and then writing happens as one indivisible step per tenant; otherwise two requests
that each fit both go through and the limit an operator sold is not the limit that applies.

_Source:_ `docs/explanation/data-model.md` · `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - the read that decides takes the row lock
        - enforcing a limit reads the subscription locked, never plainly
        - the count and the write happen while it is still held
    - EntitlementService.enforceLimit — forwards tx to lookup ports (#70)
        - contract, bundle and bundle-version lookups receive the runner tx

<!-- END proof -->

### SC-ENTL-008 — A single large action can be refused by a limit it would cross in one go

🟢 The check is against what the action would consume, not against a single unit, so one ten-gigabyte
file does not fit under a one-gigabyte allowance.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService.enforceLimit — a limit nobody can read
        - a dimension the plan does not declare is a misconfiguration
        - a declared quota that cannot be read lets the request through

<!-- END proof -->

### SC-ENTL-009 — The declarative check is a guard, not a guarantee

🟢 Applied to a route it is deliberately a soft check and can be raced. Where a limit must hold
exactly, the transactional path is the one to use, and the difference is stated rather than
implied.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — annotation evaluation
        - lets routes without @RequireFeature pass unchecked
        - @RequireFeature with an empty array passes unchecked

<!-- END proof -->

### SC-ENTL-010 — A limit nothing can count does not block anybody

🟢 The request goes through and the gap is reported for review, rather than a tenant being refused
because an installation has not finished wiring a counter.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService.enforceLimit — a limit nobody can read
        - a dimension the plan does not declare is a misconfiguration
        - a declared quota that cannot be read lets the request through
- `packages/nest/tests/saasicat-module.test.js`
    - StaticEntitlementService (via StaticPlanResolver)
        - snapshot returns features+quotas from the plan catalog
        - hasFeature + quotaLimit as convenience methods
        - snapshot with an unresolved plan = empty set

<!-- END proof -->

### SC-ENTL-011 — Enforcing a limit nobody declared is the installation's fault, not the tenant's

🟢 It is answered as a misconfiguration rather than as a refusal the tenant could do something about.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService.enforceLimit — a limit nobody can read
        - a dimension the plan does not declare is a misconfiguration
        - a declared quota that cannot be read lets the request through
- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — config hooks
        - tenantContextRunner wraps the computeLimits call (RLS consumers)
        - userRoleResolver allows a project-specific role source
        - tenantIdResolver can fetch tenantId from an alternative field

<!-- END proof -->

### SC-ENTL-012 — A cancellation that has taken effect grants nothing

🟢 🔒 No features, no limits. Until this rule existed, a subscription cancelled eight months earlier
was granted exactly what it was granted while active.

_Source:_ #219 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-landed-cancellation-ends-what-it-granted.test.js`
    - once the cancellation has taken effect
        - nothing is granted
        - the plan is still named, so a page can say which one ended
        - a configured floor is granted instead
        - and the floor does not inherit what was bought on top
        - a contract signed earlier does not outlive it

<!-- END proof -->

### SC-ENTL-013 — A cancellation that is merely declared changes nothing

🟢 A subscription cancelled in month three of a year runs, is billed and keeps everything until the
term ends.

_Source:_ #219

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a cancellation still to come
        - lets the plan change, and does not sell a term it cuts short
        - while an uncancelled subscription does get a fresh term
- `packages/nest/tests/a-landed-cancellation-ends-what-it-granted.test.js`
    - while a subscription is running
        - it is granted its plan
        - and a cancellation still to come changes nothing
- `packages/ui-vue-tenant/tests/component/a-cancelled-plan-still-runs.test.ts`
    - while nothing is cancelled
        - the tenant is offered the act
        - and told nothing about a cancellation
    - once it is cancelled
        - the date is shown, not just the word
        - and the subscription is described as unchanged until then
        - the act is no longer offered
        - changing plan still is

<!-- END proof -->

### SC-ENTL-014 — An installation may name a floor a cancelled subscription falls back to

🟢 A read-only tier a former customer can export from, or a free plan, instead of nothing. Add-on
bookings and negotiated limits are not carried into it, because those belonged to the subscription
that ended.

_Source:_ #219 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-landed-cancellation-ends-what-it-granted.test.js`
    - once the cancellation has taken effect
        - nothing is granted
        - the plan is still named, so a page can say which one ended
        - a configured floor is granted instead
        - and the floor does not inherit what was bought on top
        - a contract signed earlier does not outlive it

<!-- END proof -->

### SC-ENTL-015 — The end of a subscription is seen on every enforcement path

🟢 A rule written into one of two paths is enforced in half the applications, and two paths that
disagree about what a cancelled subscription keeps would be worse than either answer alone.

_Source:_ #219

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-landed-cancellation-ends-what-it-granted.test.js`
    - a cancellation older than the fields that describe it
        - is read from the only column it has
        - and a legacy row whose date is still to come keeps everything
- `packages/nest/tests/both-enforcement-paths-see-the-end.test.js`
    - the default enforcement stack
        - grants nothing once the cancellation has landed
        - grants the configured floor instead, where one is configured
        - while a cancellation still to come grants everything
        - and an uncancelled subscription is unaffected
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - what else ends when the subscription does
        - the frozen contract is ended on the same date
        - and a cancellation already recorded repairs its contract too
        - and a consumer without contracts is unaffected

<!-- END proof -->

### SC-ENTL-016 — An answer computed before an end date arrives is not served after it

🟢 A date arriving is not a change anybody makes, so nothing would invalidate a remembered answer by
itself.

_Source:_ #219

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/both-enforcement-paths-see-the-end.test.js`
    - a cached answer at the cancellation boundary
        - is not served past the moment it ends
        - and is still served inside its ordinary lifetime
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — computeLimits + Cache
        - returns plan default limits for STANDARD
        - second call on the same tenant does NOT hit the DB
        - NotFound for unknown tenant
        - invalidateTenant forces a re-read
        - TTL: reloads after &gt;60 s
        - different tenants are cached separately

<!-- END proof -->

### SC-ENTL-017 — A feature that was renamed keeps working for customers who bought the old name

🟢 An existing contract holding a superseded key grants its successors, and keeps the old one too, so
a rename in the catalogue is never a silent downgrade for somebody already paying.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-018 — An offer shown alongside a refusal is one the tenant could actually buy

🟢 Only currently marketed, live add-ons are offered, ranked by how much of what is missing they
cover and then by price. A failure to work out an offer never turns a correct refusal into a
server error.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-bundle-upsell-resolver.test.js`
    - CatalogBundleUpsellResolver
        - returns published+marketed bundles that contain the missing feature
        - non-marketed and draft bundles are not offers
        - without requires data the cheaper price wins
        - requires known (#35): combo bundle with dependency ranks before cheaper single bundle
        - bundle that contains only the dependency (not the feature) is not an offer
        - currency comes from the optional currency token, default EUR
        - priceless bundle (pricing override only) yields priceMonthlyNet null and ranks last
        - empty featureKeys → no offers, no repo access
- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — upsell response (#36)
        - structured 403 body: code, featureKey, featureKeys, offers, message
        - Logical OR: featureKeys carries all required keys, featureKey the first
        - Resolver error degrades to offers: [] instead of 500
        - Resolver is not called for a licensed feature
        - without a resolver: full body with empty offers
    - UPSELL_OFFER_RESOLVER_TOKEN
        - is a Symbol.for token (process-wide registry)

<!-- END proof -->

### SC-ENTL-019 — A platform administrator is not blocked by a tenant's entitlements

🟢 🔒 Support can act on a tenant's behalf without the tenant having bought the feature being used.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — auth paths
        - SUPER_ADMIN bypasses the feature check
        - SUPER_ADMIN via `platformRole` is detected
        - missing user → Forbidden ("Not authenticated")
        - missing tenantId → Forbidden ("No tenant assigned")
        - tenantId from request.tenantId takes precedence over user.tenantId

<!-- END proof -->

### SC-ENTL-020 — Hiding a control is not protection

🟢 🔒 The interface hides what the backend would refuse; the refusal is what protects it. A tenant who
constructs the request by hand gets the same answer.

_Source:_ `docs/guides/build-the-admin-frontend.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/feature-guard.test.js`
    - FeatureGuard — feature set matching
        - blocks with ForbiddenException when the feature is missing

<!-- END proof -->

## 11. Promotional codes

A promotional code is a discount an operator can hand out without a developer. The requirements
here are mostly limits: what a code may promise, how often it may be used, and what happens when
two people redeem the last one at the same moment. The last group exists because a discount that
half-applies is worse than none.

### SC-PROMO-001 — A code is redeemed at most once per subscription

🟢 Reversing a redemption releases the slot back to the code.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-admin-controller.test.js`
    - standard promo Admin controller exposes list, create, edit and delete
- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.create — validation
        - accepts a valid code
        - rejects a code with an invalid pattern
        - PERCENT must be 0–100
        - ABSOLUTE must be positive
        - ONCE must not have a durationValue
        - MONTHS / BILLING_CYCLES need 1–24 as durationValue
        - rejects the nonRedeemablePlans whitelist (ENTERPRISE)
        - rejects validUntil ≤ validFrom
        - rejects ABSOLUTE ≥ lowest plan gross without allowZeroInvoice
        - accepts an ABSOLUTE discount ≥ plan gross when allowZeroInvoice=true
        - rejects a duplicate code

<!-- END proof -->

### SC-PROMO-002 — A code with a redemption limit cannot be over-redeemed

🟢 However many people try at the same moment. It closes itself once it is full.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-code-pattern.test.js`
    - the code pattern carries exactly the declared bounds
- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.create — validation
        - accepts a valid code
        - rejects a code with an invalid pattern
        - PERCENT must be 0–100
        - ABSOLUTE must be positive
        - ONCE must not have a durationValue
        - MONTHS / BILLING_CYCLES need 1–24 as durationValue
        - rejects the nonRedeemablePlans whitelist (ENTERPRISE)
        - rejects validUntil ≤ validFrom
        - rejects ABSOLUTE ≥ lowest plan gross without allowZeroInvoice
        - accepts an ABSOLUTE discount ≥ plan gross when allowZeroInvoice=true
        - rejects a duplicate code

<!-- END proof -->

### SC-PROMO-003 — A redemption limit can be raised, never lowered

🟢 Lowering it would retroactively invalidate redemptions that already happened.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.create — validation
        - accepts a valid code
        - rejects a code with an invalid pattern
        - PERCENT must be 0–100
        - ABSOLUTE must be positive
        - ONCE must not have a durationValue
        - MONTHS / BILLING_CYCLES need 1–24 as durationValue
        - rejects the nonRedeemablePlans whitelist (ENTERPRISE)
        - rejects validUntil ≤ validFrom
        - rejects ABSOLUTE ≥ lowest plan gross without allowZeroInvoice
        - accepts an ABSOLUTE discount ≥ plan gross when allowZeroInvoice=true
        - rejects a duplicate code

<!-- END proof -->

### SC-PROMO-004 — A code that has been redeemed is never deleted; it is paused

🟢 The redemptions reference it, and a customer's discount has to remain explicable.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - a code that has been redeemed is kept
        - a soft delete is refused while a redemption points at it
        - and pausing it instead is allowed

<!-- END proof -->

### SC-PROMO-005 — A percentage discount is between 0 and 100

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-admin-controller.test.js`
    - standard promo Admin controller exposes list, create, edit and delete
- `packages/ui-vue/tests/component/promo-code-dialogs.test.ts`
    - PromoCodeCreateDialog
        - passes the entered values through to submit
        - reopening starts from an empty form
        - does not submit while the code is malformed
        - keeps a handler error inside the dialog
    - PromoCodeEditDialog
        - adopts the row values into the form
        - sends nothing while nothing has changed
        - sends only the changed fields, with the row id
        - keeps a handler error inside the dialog
    - Shared form body
        - create: typing into the code field lands upper-cased in the form
        - create: the random button fills a valid code
        - edit: the code field shows the code and is disabled
        - the status switch appears on edit only
        - the plan picker writes into the dialog form

<!-- END proof -->

### SC-PROMO-006 — A discount runs for at most 24 months or billing periods

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-public-controller.test.js`
    - preview passes code/plan/billingCycle 1:1 through to the service
    - preview passes email + ipHash + sessionId through to the service
    - preview forwards invalid response 1:1
    - preview works without an authenticated user (sessionId undefined)
    - rate limit 429 carries retryAfterSeconds of the IP window
    - rate limit 429 carries retryAfterSeconds of the session window
- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.preview — eligibility
        - NOT_FOUND when no code exists
        - PLAN_MISMATCH when the whitelist excludes the plan
        - PLAN_MISMATCH on nonRedeemable (ENTERPRISE)
        - NOT_FIRST_TIME_CUSTOMER with firstTimeCustomersOnly + an existing customer
        - valid=true with price preview for PROFESSIONAL/YEARLY/25%

<!-- END proof -->

### SC-PROMO-007 — A one-off discount carries no duration and applies to the first invoice only

🟢 The regular price applies from the second period. The two forms are alternatives, and a code
claiming both describes nothing.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.preview — eligibility
        - NOT_FOUND when no code exists
        - PLAN_MISMATCH when the whitelist excludes the plan
        - PLAN_MISMATCH on nonRedeemable (ENTERPRISE)
        - NOT_FIRST_TIME_CUSTOMER with firstTimeCustomersOnly + an existing customer
        - valid=true with price preview for PROFESSIONAL/YEARLY/25%

<!-- END proof -->

### SC-PROMO-008 — An absolute discount stays below the lowest price it can apply to

🟢 Both when the code is created and when it is redeemed, unless the operator deliberately allows an
invoice of zero. Otherwise a code quietly makes a plan free.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.preview — eligibility
        - NOT_FOUND when no code exists
        - PLAN_MISMATCH when the whitelist excludes the plan
        - PLAN_MISMATCH on nonRedeemable (ENTERPRISE)
        - NOT_FIRST_TIME_CUSTOMER with firstTimeCustomersOnly + an existing customer
        - valid=true with price preview for PROFESSIONAL/YEARLY/25%

<!-- END proof -->

### SC-PROMO-009 — A plan may be marked as not discountable

🟢 A code cannot be created for it and never validates against it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding with promoCode + PromoCodesService redeems atomically
- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.redeem — eligibility
        - enforces firstTimeCustomersOnly also at the final redeem with email
        - blocks firstTimeCustomersOnly at the final redeem without email, fail-closed
        - lets firstTimeCustomersOnly be redeemed for a first-time customer

<!-- END proof -->

### SC-PROMO-010 — A code is for first-time customers unless the operator says otherwise

🟢 💰 That is the default, because it is the common case and the expensive mistake is the other way
round.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.redeem — eligibility
        - enforces firstTimeCustomersOnly also at the final redeem with email
        - blocks firstTimeCustomersOnly at the final redeem without email, fail-closed
        - lets firstTimeCustomersOnly be redeemed for a first-time customer

<!-- END proof -->

### SC-PROMO-011 — Redeeming a code applies the discount and records the redemption, or does neither

🟢 💰 Half-applying it leaves a customer with a discount nobody recorded, or a record of one they
never received.

_Source:_ `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - a redemption and its discount stand or fall together
        - the slot and the record are claimed in one transaction
        - a record that cannot be written takes the slot back with it

<!-- END proof -->

### SC-PROMO-012 — A code only applies to a subscription belonging to the person redeeming it

🟢 💰

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-013 — A code works whatever case the customer typed it in

🟢

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/promotion-helpers.test.js`
    - promoStatus
        - active within the window
        - scheduled before validFrom
        - expired after validTo
    - pickActivePromo
        - highest priority wins on overlap
        - onlyLocales filters
        - billingCycle filters
        - requiresCoupon promotions are not selected automatically
        - non-matching plan → null
        - targetType filters bundle promotions separately from plan promotions
    - applyPromo
        - percent
        - amount
        - amount clamps at 0
        - intro
        - freeMonths
        - null when promotion is missing
- `packages/nest/tests/promo-calculator.test.js`
    - round2 rounds to two decimal places
    - grossFromNet adds VAT
    - computeIncludedVat extracts VAT from gross
    - computeDiscountGross PERCENT 25%
    - computeDiscountGross ABSOLUTE 30 EUR
    - computeDiscountGross accepts a Prisma decimal string
    - computeDiscountedGross subtracts
    - addCycles MONTHLY +3
    - addCycles YEARLY +2
    - computeRegularStartsAt ONCE → one period
    - computeRegularStartsAt MONTHS 6
    - computeRegularStartsAt BILLING_CYCLES 2 (YEARLY)
    - buildLabel ONCE PERCENT
    - buildLabel MONTHS 6 ABSOLUTE
    - buildLabel BILLING_CYCLES 1 YEARLY → "for the first year"
    - buildLabel MONTHS 1 → singular
    - buildLabel without options keeps the de-DE/EUR output it always had
    - buildLabel formats the amount in the given locale
    - buildLabel formats the percentage in the given locale
    - buildLabel uses the given currency, symbol and decimals
    - buildLabel ignores the currency for percentage codes
    - buildLabel keeps non-breaking spaces out of the label
    - buildLabel rejects an unusable locale instead of guessing one
    - but an unknown region on a known language is not unusable
    - buildLabel does not police the currency, and says why
    - and a percentage ignores the currency, as its option says

<!-- END proof -->

### SC-PROMO-014 — A code is 4 to 32 characters of upper-case letters, digits, hyphen and underscore

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/promotion-helpers.test.js`
    - promoStatus
        - active within the window
        - scheduled before validFrom
        - expired after validTo
    - pickActivePromo
        - highest priority wins on overlap
        - onlyLocales filters
        - billingCycle filters
        - requiresCoupon promotions are not selected automatically
        - non-matching plan → null
        - targetType filters bundle promotions separately from plan promotions
    - applyPromo
        - percent
        - amount
        - amount clamps at 0
        - intro
        - freeMonths
        - null when promotion is missing
- `packages/nest/tests/promo-calculator.test.js`
    - round2 rounds to two decimal places
    - grossFromNet adds VAT
    - computeIncludedVat extracts VAT from gross
    - computeDiscountGross PERCENT 25%
    - computeDiscountGross ABSOLUTE 30 EUR
    - computeDiscountGross accepts a Prisma decimal string
    - computeDiscountedGross subtracts
    - addCycles MONTHLY +3
    - addCycles YEARLY +2
    - computeRegularStartsAt ONCE → one period
    - computeRegularStartsAt MONTHS 6
    - computeRegularStartsAt BILLING_CYCLES 2 (YEARLY)
    - buildLabel ONCE PERCENT
    - buildLabel MONTHS 6 ABSOLUTE
    - buildLabel BILLING_CYCLES 1 YEARLY → "for the first year"
    - buildLabel MONTHS 1 → singular
    - buildLabel without options keeps the de-DE/EUR output it always had
    - buildLabel formats the amount in the given locale
    - buildLabel formats the percentage in the given locale
    - buildLabel uses the given currency, symbol and decimals
    - buildLabel ignores the currency for percentage codes
    - buildLabel keeps non-breaking spaces out of the label
    - buildLabel rejects an unusable locale instead of guessing one
    - but an unknown region on a known language is not unusable
    - buildLabel does not police the currency, and says why
    - and a percentage ignores the currency, as its option says

<!-- END proof -->

### SC-PROMO-015 — What a code promised when it was redeemed stays with the redemption

🟢 Later edits to the code do not change what a customer already got.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-calculator.test.js`
    - round2 rounds to two decimal places
    - grossFromNet adds VAT
    - computeIncludedVat extracts VAT from gross
    - computeDiscountGross PERCENT 25%
    - computeDiscountGross ABSOLUTE 30 EUR
    - computeDiscountGross accepts a Prisma decimal string
    - computeDiscountedGross subtracts
    - addCycles MONTHLY +3
    - addCycles YEARLY +2
    - computeRegularStartsAt ONCE → one period
    - computeRegularStartsAt MONTHS 6
    - computeRegularStartsAt BILLING_CYCLES 2 (YEARLY)
    - buildLabel ONCE PERCENT
    - buildLabel MONTHS 6 ABSOLUTE
    - buildLabel BILLING_CYCLES 1 YEARLY → "for the first year"
    - buildLabel MONTHS 1 → singular
    - buildLabel without options keeps the de-DE/EUR output it always had
    - buildLabel formats the amount in the given locale
    - buildLabel formats the percentage in the given locale
    - buildLabel uses the given currency, symbol and decimals
    - buildLabel ignores the currency for percentage codes
    - buildLabel keeps non-breaking spaces out of the label
    - buildLabel rejects an unusable locale instead of guessing one
    - but an unknown region on a known language is not unusable
    - buildLabel does not police the currency, and says why
    - and a percentage ignores the currency, as its option says

<!-- END proof -->

### SC-PROMO-016 — A code past its validity stops working without anybody having to run anything

🟢 It is retired both on a schedule and on the next time somebody asks about it.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-public-controller.test.js`
    - preview passes code/plan/billingCycle 1:1 through to the service
    - preview passes email + ipHash + sessionId through to the service
    - preview forwards invalid response 1:1
    - preview works without an authenticated user (sessionId undefined)
    - rate limit 429 carries retryAfterSeconds of the IP window
    - rate limit 429 carries retryAfterSeconds of the session window

<!-- END proof -->

### SC-PROMO-017 — Failed attempts are recorded as well as successful ones

🟢 Guessing at codes leaves a trail.

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-018 — Guessing at codes is rate-limited, per address and per session

🟢 Checking a code needs no account, so the limit is what stands between a public endpoint and
somebody enumerating the campaign.

_Source:_ release 1.0.0-rc.7

### SC-PROMO-019 — A first-time-only code needs a way to answer who is a first-time customer

🟢 An installation offering one publicly without that answer would show every such code as
unavailable, which is worse than not offering it.

_Source:_ `docs/reference/options.md`

### SC-PROMO-020 — The amount in a discount summary is formatted in the audience's language

🟢 Not in one the platform picked. A German product's customers read "25 % once" in checkout because
the number formatting and the words had been decided separately.

_Source:_ #105

### SC-PROMO-021 — A language the runtime cannot serve is refused rather than quietly replaced

🟢 A well-formed typo would otherwise fall back to the runtime's own default, and an amount would
reach the customer formatted in a language nobody chose.

_Source:_ #105

### SC-PROMO-022 — Creating, changing and removing a code is recorded

🟢

_Source:_ release 1.0.0-rc.7

## 12. Self-registration

Where an installation lets strangers sign themselves up, the flow has to be safe against people
who are not customers yet. This chapter covers the ordering of the steps, what expires, and the
limits on guessing. It applies only to installations that wire the flow deliberately — see
SC-SCOPE-006.

### SC-REG-001 — Starting a registration reveals nothing about who already has an account

🟢 The answer is the same whether or not the address is known, and a failure to send the message is
not surfaced either. Otherwise the flow becomes a way to enumerate customers.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() with active user → no PendingRegistration created
    - start() email normalization: trim + lowercase
    - resendOtp() unknown email → neutral response, no throw

<!-- END proof -->

### SC-REG-002 — A half-finished registration is never counted as a customer

🟢 Not in numbers an operator reads, and not in a check for whether an address is already taken.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() creates PendingRegistration and sends OTP

<!-- END proof -->

### SC-REG-003 — Accepting the terms, the privacy notice and the data agreement is part of step one

🟢

_Source:_ release 1.0.0-rc.7

### SC-REG-004 — Somebody who has already verified their address is not asked to verify it again

🟢 They are sent a link back into where they left off instead of a new code.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() with active user → no PendingRegistration created

<!-- END proof -->

### SC-REG-005 — Restarting an unverified registration issues a new code and keeps the stored data

🟢 The old code stops working, and nothing somebody else typed overwrites what is there.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() with expired PendingRegistration → deletes + creates new
    - start() with existing PENDING_EMAIL_VERIFICATION → OTP is regenerated

<!-- END proof -->

### SC-REG-006 — A verification code expires, and says so

🟢 An expired code is refused with an invitation to request a new one, not with a failure that reads
like a wrong code.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - verifyOtp() expired OTP → OTP_EXPIRED

<!-- END proof -->

### SC-REG-007 — After five wrong verification codes the attempt is locked

🟢 A subsequently correct code no longer works, and the only way on is a new code. The attempt is
counted before the code is compared, so parallel attempts cannot race past the limit.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - verifyOtp() after 5 failed attempts → OTP_LOCKED
    - verifyOtp() correct code after lockout → still OTP_LOCKED
    - verifyOtp() parallel failed attempts with stale counter → atomic increment locks

<!-- END proof -->

### SC-REG-008 — A locked verification tells the person to request a new code

🟢 Not to try again, which is the one thing that will not work.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - verifyOtp() correct code after lockout → still OTP_LOCKED
    - resendOtp() after lockout → new code unlocks (counter reset)

<!-- END proof -->

### SC-REG-009 — Repeated attempts are rate-limited, and the answer says how long to wait

🟢 Where refusing loudly would itself reveal that a registration exists, the request is quietly
dropped instead.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - resendOtp() rate limit kicks in → silently dropped after 3 sends

<!-- END proof -->

### SC-REG-010 — A registration expires, and so does the link that resumes it

🟢 An abandoned one is removed outright rather than kept in a reduced form, so the address becomes
usable again.

_Source:_ `docs/reference/error-codes.md` · release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() with expired PendingRegistration → deletes + creates new
    - runCleanup() deletes expired, leaves active alone
    - resume: resumeWithToken() invalid token → RESUME_TOKEN_INVALID
    - resume: resumeWithToken() token points to deleted Pending → RESUME_TOKEN_INVALID

<!-- END proof -->

### SC-REG-011 — The steps come in order

🟢 A step reached out of order is refused with a message saying so, rather than half-completing a
registration.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() creates PendingRegistration and sends OTP
    - selectPlan() without email verification (PENDING_EMAIL_VERIFICATION) →
      INVALID_REGISTRATION_STATE
    - startCheckout() without plan selection → PLAN_NOT_SELECTED

<!-- END proof -->

### SC-REG-012 — The plan can be changed freely up to the moment of payment

🟢 And it is checked again at that moment, because it may have left the catalogue in between.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - selectPlan() plan change in status PLAN_SELECTED is allowed

<!-- END proof -->

### SC-REG-013 — A plan that does not exist and one that is not on offer answer the same

🟢 Otherwise the difference between the two would tell a stranger which plans an installation has.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding throws ForbiddenException for blocked self-service plans
- `packages/nest/tests/registration-service.test.js`
    - selectPlan() non-catalogued plan → PLAN_NOT_AVAILABLE
    - listPublicPlans() passes the plan list through

<!-- END proof -->

### SC-REG-014 — Prices in the sign-up flow are worked out by the server

🟢 The page displays a breakdown; it does not compute one. A discount can never exceed the amount it
applies to, and no total goes below zero.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - startCheckout() calls provider with correct params

<!-- END proof -->

### SC-REG-015 — A promotional code is re-checked every time the price is shown

🟢 The stored code is only there to be displayed back to the person entering it.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding with promoCode + PromoCodesService redeems atomically

<!-- END proof -->

### SC-REG-016 — The account, the tenant and the subscription are created together or not at all

🟢 Only after payment succeeded, and a partial creation is undone.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - handlePaymentEvent() SUCCEEDED → activated + User/Tenant/Subscription created

<!-- END proof -->

### SC-REG-017 — Add-ons chosen during sign-up never cost somebody their plan

🟢 If one of them cannot be booked, it becomes a warning and the plan still activates.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding throws BadRequestException when plan-change blockers are active

<!-- END proof -->

### SC-REG-018 — Whether a payment confirmation is genuine is the integrator's to verify

🟢 SaaSiCat cannot know the provider or the secret. An unverified callback lets anyone forge a
payment confirmation, so verification sits in front of the route.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - startCheckout() calls provider with correct params
    - handlePaymentEvent() without sessionId → MISSING_SESSION_ID

<!-- END proof -->

### SC-REG-019 — The same payment event applied twice changes nothing

🟢 Providers retry, and a retry must not create a second account or a second charge.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - handlePaymentEvent() duplicate webhook → ALREADY_PROCESSED + no second activation
    - handlePaymentEvent() FAILED → no activation, but event claimed
    - audit: handlePaymentEvent → PAYMENT_RECEIVED + ACTIVATION_COMPLETED, duplicate →
      PAYMENT_DUPLICATE_IGNORED

<!-- END proof -->

### SC-REG-020 — A resumed registration never carries a password or a verification code with it

🟢 What is handed back to a returning person is what they need to continue, and nothing that could be
used against them.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - resume: resumeWithToken() success → returns pending ID + nextStep + snapshot
    - resume: resumeWithToken() invalid token → RESUME_TOKEN_INVALID

<!-- END proof -->

## 13. The public catalogue, checkout and contracts

What a prospective customer sees before they buy, and what happens between choosing and owning.
The single idea running through it: the offer is frozen before money is involved, so what somebody
saw is what they get, and a catalogue edit in between cannot change it.

### SC-MKT-001 — A pricing page reads the published catalogue rather than computing prices

🟢 There is one place prices are decided, and the page is not it.

_Source:_ `docs/explanation/architecture.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-catalog-controller.test.js`
    - listPlans returns only marketed plans in the generic format
    - a plan sold by negotiation is left out even when a figure is on file
    - listFeatureRegistry returns the injected registry 1:1 without a CatalogEntry repo
    - listFeatureRegistry overlays the DB icon over the static registry icon (#13)
    - listBundles returns requiresFeatures from the FeatureCatalogEntries (#35)
    - listBundles without a CatalogEntry repo: requiresFeatures stays empty (graceful)

<!-- END proof -->

### SC-MKT-002 — Only plans an operator marked as marketed appear in self-service

🟢 A negotiated plan is not something a stranger can select for themselves.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/configurator-catalog-builder.test.js`
    - ConfiguratorCatalogBuilder
        - maps marketed live PlanVersions onto models (incl. quota normalization)
        - plan without a marketing entry is hidden
- `packages/nest/tests/registration-service.test.js`
    - listPublicPlans() passes the plan list through

<!-- END proof -->

### SC-MKT-003 — A plan or add-on with no marketing entry, or one marked hidden, is not shown

🟢 Publishing a version and advertising it are two acts.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/configurator-catalog-builder.test.js`
    - ConfiguratorCatalogBuilder
        - maps marketed live PlanVersions onto models (incl. quota normalization)
        - plan without a marketing entry is hidden
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Bundles
        - getCatalog returns empty bundles[] without a BundleRepository
        - getCatalog returns published live bundles with compatiblePlanKeys
        - requiresFeatures (#35): uncovered requires of the bundle features from the
          FeatureCatalogEntries
        - requiresFeatures without a CatalogEntryRepository: empty (graceful)
        - getCatalog filters out non-marketed bundles
        - getCatalog filters out bundles with MarketingProjection visible=false
        - getCatalog ignores drafts (only live = published+not-superseded)
        - i18n: MarketingProjection overrides label + fills description (matching locale)
        - i18n: falls back to DE projection when locale is missing
        - i18n: without a projection the bundle root label applies (description stays empty)
        - bundle promotions are resolved with targetType=BUNDLE

<!-- END proof -->

### SC-MKT-004 — Marketing text belongs to one version and one language

🟢 So a price change and a wording change are separate acts, and a translation cannot silently
describe an offer that is no longer current. There is exactly one entry per version and language.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/marketing-projections-service.test.js`
    - MarketingProjectionsService — master data operations
        - create creates a MarketingProjection (default locale=de)
        - create sets marketing defaults (visible, badge, trial)
        - update changes top features, badge and trial
        - create throws 409 on duplicate creation (same Target+Locale)
        - create accepts multiple locales per target
        - update changes required and marketing fields
        - delete removes the row
        - list filters by targetType + locale
        - getById throws 404 for missing ID

<!-- END proof -->

### SC-MKT-005 — Marketing text falls back to the default language rather than appearing empty

🟢

_Source:_ release 1.0.0-rc.6

### SC-MKT-006 — Marketing edits take effect at once and are not versioned

🟢 They govern what the public catalogue displays, never what a running subscription is owed, so
there is nothing for them to rewrite.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/marketing-projections-service.test.js`
    - MarketingProjectionsService — master data operations
        - create creates a MarketingProjection (default locale=de)
        - create sets marketing defaults (visible, badge, trial)
        - update changes top features, badge and trial
        - create throws 409 on duplicate creation (same Target+Locale)
        - create accepts multiple locales per target
        - update changes required and marketing fields
        - delete removes the row
        - list filters by targetType + locale
        - getById throws 404 for missing ID

<!-- END proof -->

### SC-MKT-007 — Which languages the catalogue is published in is an operator's choice

🟢 Made on the marketing screen, from the pool the installation declared, not in a deployment.

_Source:_ #217 · `docs/reference/options.md`

### SC-MKT-008 — An installation has exactly one set of marketing settings

🟢 A convention resting on a default does not hold against a caller that supplies the value, so it is
a constraint rather than a habit.

_Source:_ `docs/explanation/data-model.md` · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/marketing-projections-service.test.js`
    - MarketingProjectionsService — master data operations
        - create creates a MarketingProjection (default locale=de)
        - create sets marketing defaults (visible, badge, trial)
        - update changes top features, badge and trial
        - create throws 409 on duplicate creation (same Target+Locale)
        - create accepts multiple locales per target
        - update changes required and marketing fields
        - delete removes the row
        - list filters by targetType + locale
        - getById throws 404 for missing ID

<!-- END proof -->

### SC-MKT-009 — At most one plan is marked as the recommended one

🔵 _(Superseded on 2026-08-31 by `SC-MKT-022`.)_

_Source:_ `docs/reference/options.md`

### SC-MKT-022 — A catalogue offers at most one recommended plan, and the language decides which

🟢 The mark belongs to a projection, and a projection belongs to one plan version and one language,
so no single row can keep this promise: two rows in the same language can carry it, and one carried
in the default language reaches another language through the fallback that fills in a missing
translation. The catalogue is where all three — the live versions, the language asked for, and the
fallback — are known at once, so that is where it is decided. A row written for the language that
was asked for wins over one inherited from the default; failing that, the first plan the catalogue
offers. The others keep their card and lose the mark.

_Source:_ #255

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/recommended-plan.test.js`
    - keepOneRecommended
        - one is left alone
        - none stays none, and the answer is null
        - a row written for the language beats one inherited from the default
        - and it wins from anywhere in the list, not only from the front
        - with none written for the language, the first the caller offers wins
        - with every one written for it, the first still wins
        - a plan that is not recommended is never made one
        - an empty catalogue answers null rather than throwing
        - only the mark is touched — every card stays
- `packages/nest/tests/marketing-projections-service.test.js`
    - MarketingProjectionsService — the recommended mark is not decided here
        - a second recommended projection in the same language is accepted
        - and so is recommending one by edit while another already is
- `packages/nest/tests/public-marketing-catalog-plans-pricetag.test.js`
    - PublicMarketingCatalogService — the recommended plan
        - one is one
        - a plan reaching the page through the fallback loses to one written for the language
        - two rows in the same language leave the one the catalogue offers first
        - the one that loses the mark keeps its card
        - a catalogue that recommends nothing recommends nothing
        - a single fallback row still recommends its plan

<!-- END proof -->

### SC-MKT-010 — Exactly one promotion applies to a given plan, language and rhythm

🟢 Where several overlap, the operator's priority decides, and a promotion tied to a code is not
shown as a public one. A promotion runs to the end of its last day, and never pushes a price below
zero.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/promotion-helpers.test.js`
    - pickActivePromo
        - highest priority wins on overlap
        - onlyLocales filters
        - billingCycle filters
        - requiresCoupon promotions are not selected automatically
        - non-matching plan → null
        - targetType filters bundle promotions separately from plan promotions

<!-- END proof -->

### SC-MKT-011 — The public catalogue shows base prices only

🟢 A visitor has no plan, so a price that exists only as an override for one plan cannot be shown
there, and an add-on priced that way reads as having no public price rather than as free.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the prices a store is shown
        - are resolved for the plan, in both rhythms
        - carry an override the public catalogue cannot know about
        - a bundle sold in one rhythm only says so for the other
        - an id nobody knows is left out rather than answered with nulls
        - asking for nothing costs nothing
- `packages/nest/tests/public-marketing-catalog-bundles.test.js`
    - PublicMarketingCatalogService — Bundles
        - getCatalog returns empty bundles[] without a BundleRepository
        - getCatalog returns published live bundles with compatiblePlanKeys
        - requiresFeatures (#35): uncovered requires of the bundle features from the
          FeatureCatalogEntries
        - requiresFeatures without a CatalogEntryRepository: empty (graceful)
        - getCatalog filters out non-marketed bundles
        - getCatalog filters out bundles with MarketingProjection visible=false
        - getCatalog ignores drafts (only live = published+not-superseded)
        - i18n: MarketingProjection overrides label + fills description (matching locale)
        - i18n: falls back to DE projection when locale is missing
        - i18n: without a projection the bundle root label applies (description stays empty)
        - bundle promotions are resolved with targetType=BUNDLE
- `packages/ui-vue/tests/use-tenant-billing-catalog.test.js`
    - useTenantBillingCatalog
        - load() reads all three endpoints under the default prefix
        - a trailing slash in the prefix does not become a double slash
        - the wire form of a bundle becomes the shape the page renders
        - the optional wire fields default rather than arriving as undefined
        - a missing /bundles endpoint is not fatal — the plan page still renders
        - a failing /plans clears what it could not load
        - a client that resolves with status 0 fails the load rather than emptying it
        - a client that rejects is reported, not swallowed
        - it loads on its own unless the consumer says otherwise

<!-- END proof -->

### SC-MKT-012 — The public catalogue answers even when something behind it is unavailable

🟢 It falls back to what it can still say rather than failing, because it is the page a prospective
customer meets first and it requires no account.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-catalog-controller.test.js`
    - listPlans returns only marketed plans in the generic format
    - a plan sold by negotiation is left out even when a figure is on file
    - listFeatureRegistry returns the injected registry 1:1 without a CatalogEntry repo
    - listFeatureRegistry overlays the DB icon over the static registry icon (#13)
    - listBundles returns requiresFeatures from the FeatureCatalogEntries (#35)
    - listBundles without a CatalogEntry repo: requiresFeatures stays empty (graceful)
- `packages/nest/tests/public-route.test.js`
    - SaaSiCat public route metadata
        - ${controller.name} is recognized by global auth guards
        - unmarked controllers stay protected

<!-- END proof -->

### SC-MKT-013 — What a customer selected is frozen into an offer before it becomes a contract

🟢 💰 With an expiry date that runs to the end of its last day. What they saw is what they buy.

_Source:_ `docs/explanation/concepts.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - create creates an open offer
        - update customizes an open offer
        - create requires bundle line items for specific bundle versions
        - create freezes bundle versions, promotions and promo code into the offer
        - create adds the discounted price as a negative discount line item
        - consume freezes the offer
        - consume blocks a no-longer-bookable bundle version
        - update on a consumed offer throws Conflict
        - update on an expired offer throws Conflict
        - double consume throws Conflict
        - getById throws for an unknown offer

<!-- END proof -->

### SC-MKT-014 — An offer that has expired or been used cannot become a contract

🟢 Nor can it be changed once it has been used.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - create creates an open offer
        - update customizes an open offer
        - create requires bundle line items for specific bundle versions
        - create freezes bundle versions, promotions and promo code into the offer
        - create adds the discounted price as a negative discount line item
        - consume freezes the offer
        - consume blocks a no-longer-bookable bundle version
        - update on a consumed offer throws Conflict
        - update on an expired offer throws Conflict
        - double consume throws Conflict
        - getById throws for an unknown offer

<!-- END proof -->

### SC-MKT-015 — An offer whose selection does not cover its own dependencies is refused

🟢 If a chosen feature needs another one, the plan and the selected add-ons together have to supply
it. A customer is not sold a combination that cannot work.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService — requires validation (#35 P6)
        - create throws 422 CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED for uncovered requires
        - create accepts when a second bundle covers the requires
        - create accepts when the plan covers the requires
        - update validates the changed bundle selection against requires
        - without a CatalogEntryRepository no validation happens (graceful)
        - without a PlanRepository the plan line item featuresSnapshot covers (fallback)

<!-- END proof -->

### SC-MKT-016 — An offer cannot be turned into a contract if part of it is no longer on sale

🟢 💰 Every add-on in it has to still be bookable at the moment of purchase.

_Source:_ `docs/reference/error-codes.md`

### SC-MKT-017 — One offer yields at most one contract, and only once its prices are frozen

🟢 💰 Every selected item carries its own frozen line, so what was agreed is legible item by item.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - create creates an open offer
        - update customizes an open offer
        - create requires bundle line items for specific bundle versions
        - create freezes bundle versions, promotions and promo code into the offer
        - create adds the discounted price as a negative discount line item
        - consume freezes the offer
        - consume blocks a no-longer-bookable bundle version
        - update on a consumed offer throws Conflict
        - update on an expired offer throws Conflict
        - double consume throws Conflict
        - getById throws for an unknown offer
- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — V3 ContractLineItems
        - reads entitlements from active contract snapshot without catalog join
        - Contract entitlementSnapshot wins over line-item aggregation
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a yearly contract holding a monthly add-on
        - counts the add-on as often as it falls due
        - a yearly add-on beside a yearly plan is counted once
        - a monthly contract adds a monthly add-on as it stands
- `packages/nest/tests/subscription-contract-service.test.js`
    - SubscriptionContractService
        - createFromOffer creates immutable contract line items from a consumed offer
        - createFromOffer blocks open offers
        - replaceActiveContract closes the old contract and creates a new one
        - create requires a plan line item
        - a line whose tax does not close its own gap is refused
        - a line booked in another currency than its contract is refused
        - and a line whose tax does close it goes through
        - contractLineItemToInvoiceLineItem maps the contract snapshot losslessly to an invoice
        - subscriptionContractToInvoiceSnapshot builds a complete invoice projection from the
          contract
        - getActiveInvoiceSnapshotForTenant returns the invoice projection of the active contract
        - getActiveInvoiceSnapshotForTenant throws without an active contract
- `packages/nest/tests/tenant-subscription-bundles-refreeze.test.js`
    - add re-freezes the contract with an unchanged plan
    - cancel re-freezes the contract
    - without a ContractFreezePort, add works unchanged
    - freeze error is non-fatal — the mutation result still comes back
    - a failed mutation triggers no freeze

<!-- END proof -->

### SC-MKT-018 — A contract has exactly one plan line and at least one line in total

🟢 💰 And it cannot end before it starts.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-contract-service.test.js`
    - SubscriptionContractService
        - createFromOffer creates immutable contract line items from a consumed offer
        - createFromOffer blocks open offers
        - replaceActiveContract closes the old contract and creates a new one
        - create requires a plan line item
        - a line whose tax does not close its own gap is refused
        - a line booked in another currency than its contract is refused
        - and a line whose tax does close it goes through
        - contractLineItemToInvoiceLineItem maps the contract snapshot losslessly to an invoice
        - subscriptionContractToInvoiceSnapshot builds a complete invoice projection from the
          contract
        - getActiveInvoiceSnapshotForTenant returns the invoice projection of the active contract
        - getActiveInvoiceSnapshotForTenant throws without an active contract

<!-- END proof -->

### SC-MKT-019 — A contract that is already closed is not closed again

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-contract-service.test.js`
    - SubscriptionContractService
        - createFromOffer creates immutable contract line items from a consumed offer
        - createFromOffer blocks open offers
        - replaceActiveContract closes the old contract and creates a new one
        - create requires a plan line item
        - a line whose tax does not close its own gap is refused
        - a line booked in another currency than its contract is refused
        - and a line whose tax does close it goes through
        - contractLineItemToInvoiceLineItem maps the contract snapshot losslessly to an invoice
        - subscriptionContractToInvoiceSnapshot builds a complete invoice projection from the
          contract
        - getActiveInvoiceSnapshotForTenant returns the invoice projection of the active contract
        - getActiveInvoiceSnapshotForTenant throws without an active contract

<!-- END proof -->

### SC-MKT-020 — A contract agreed after a cancellation ends when that cancellation does

🟢 Otherwise the ending would last exactly until the next plan change.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a contract frozen after the cancellation
        - inherits the ending rather than starting open
        - while a subscription with no ending freezes open, as before

<!-- END proof -->

### SC-MKT-021 — A tenant can read back the package they were sold

🟢 The frozen selection is visible to them, unchanged, in their own self-service.

_Source:_ release 1.0.0-rc.6

## 14. Administration and access to it

Who may act on the platform, and what has to be true before they can. Most of this chapter is
about the beginning and the end of a session — bootstrapping the first administrator, requiring a
second factor, and the roles that separate a tenant's administrator from a platform one.

### SC-ADM-001 — Only a platform administrator reaches the administration surface

🟢 🔒

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - SuperAdminGuard
        - accepts SUPER_ADMIN
        - rejects TENANT_ADMIN
        - rejects a missing user
- `packages/nest/tests/admin-manifest-module.test.js`
    - AdminManifestModule.forRoot — guard configuration
        - throws when the controller should be registered and `guards` is missing
        - accepts empty `guards: []` as an explicit auth-free choice
        - does NOT throw when `includeManifestController: false`
        - accepts a configured `guards` list
        - additionally accepts `reloadGuards` for MFA protection on reload
        - throws on missing `guards` even without an explicit includeManifestController
- `packages/nest/tests/discovery-controller.test.js`
    - DiscoveryController — GET /admin/discovery
        - returns the discovery snapshot as the body
        - sets the ETag header with snapshot.hash + scannedAt
        - returns HTTP 304 + null body on an If-None-Match match
        - returns the full snapshot when If-None-Match does not match
        - ignores an empty If-None-Match header
- `packages/nest/tests/saasicat-module-escape-hatches.test.js`
    - includeManifestController
        - is passed through to AdminManifestModule
        - defaults to mounting the manifest controller
- `packages/ui-vue/tests/one-way-to-authenticate.test.js`
    - the HttpClient is the only way a request gets its auth
        - there is a corpus to scan
        - no option named `getAuthToken` survives
        - nothing builds a Bearer header by hand

<!-- END proof -->

### SC-ADM-002 — A tenant-facing endpoint with no access rules configured refuses, it does not open

🟢 🔒 Failing loudly is the only safe reading; waving requests through would be silent.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-manifest-module.test.js`
    - AdminManifestModule.forRoot — guard configuration
        - throws when the controller should be registered and `guards` is missing
        - accepts empty `guards: []` as an explicit auth-free choice
        - does NOT throw when `includeManifestController: false`
        - accepts a configured `guards` list
        - additionally accepts `reloadGuards` for MFA protection on reload
        - throws on missing `guards` even without an explicit includeManifestController

<!-- END proof -->

### SC-ADM-003 — The administration requires a second factor

🟢 🔒 A one-time code alongside the sign-in. A code that cannot be checked — malformed, or a stored
secret that is unreadable — is treated as wrong, and the underlying cause is recorded so it can be
diagnosed rather than leaving somebody staring at "code invalid".

_Source:_ `docs/reference/error-codes.md` · `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaGuard — RequireMfa decorator + header check
        - MFA_NOT_SET_UP when port enabled=false
        - MFA_REQUIRED when no X-Mfa-Code header

<!-- END proof -->

### SC-ADM-004 — A one-time code is accepted across a small clock difference

🟢 Half a minute either way, so an administrator with a slightly wrong clock is not locked out.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaService — TOTP setup + verify
        - setup() generates secret + otpauth URI and persists via port
        - verify() rejects when no secret exists
        - verify() rejects an invalid code
        - disable() deletes the secret
        - isEnabled() reflects port state

<!-- END proof -->

### SC-ADM-005 — Actions with lasting consequences need the second factor and an explicit confirmation

🟢 🔒 Suspending or reactivating a tenant, acting as a tenant, exporting their data, cancelling their
subscription, and granting or withdrawing a pilot. The most serious of them ask the operator to
type the tenant's name.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaGuard — RequireMfa decorator + header check
        - SetMetadata decorator sets REQUIRE_MFA_KEY
        - passes through when endpoint is not MFA-required
        - NOT_AUTHENTICATED on missing user
        - MFA_NOT_SET_UP when port enabled=false
        - MFA_REQUIRED when no X-Mfa-Code header
        - MFA_FAILED on invalid code
        - accepts a valid code
        - bypass with SAAS_PLATFORM_SKIP_MFA=1 in non-prod
        - no bypass in production

<!-- END proof -->

### SC-ADM-006 — Two actions require a written reason before they run

🟢 Resetting somebody's password and deactivating a user. The reason is part of the record, which is
why a confirmation can carry a value rather than only a yes.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - AdminAuditService
        - actorTag formats source:email:context
        - log() writes through and appends the actor tag to changes
        - fromWebRequest builds AdminActor with source=web
        - fromWebRequest falls back to "unknown" when there is no session
        - fromCli builds AdminActor with source=cli + hostname

<!-- END proof -->

### SC-ADM-007 — There is no default confirmation that answers yes

🟢 An implementation that approved everything would silently approve every deletion, revocation and
deactivation, so an installation supplies its own or gets none.

_Source:_ release 0.26.0

### SC-ADM-008 — A password that cannot be retrieved again is shown without a way to dismiss it

🟢 Giving that dialog a cancel button would let an operator throw away something they cannot get
back.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/mfa-setup-flow.test.js`
    - MfaSetupFlow.run — first setup
        - returns secret + otpauthUri for SUPER_ADMIN
        - audit log contains issuer in changes
    - MfaSetupFlow.run — re-setup
        - rejects re-setup without confirmation (MFA_SETUP_ABORTED)
        - accepts re-setup with "yes" answer and audits MFA_SETUP_RESET
        - accepts re-setup with force=true without prompt
    - MfaSetupFlow.formatSetupResult
        - returns multi-line instructions with secret + URI

<!-- END proof -->

### SC-ADM-009 — First-run setup stops working the moment an administrator exists

🟢 Whatever token is presented. An installation cannot be taken over after it has been bootstrapped,
and the token is compared in a way that does not leak how close a guess was.

_Source:_ `SECURITY.md`

### SC-ADM-010 — Without a setup token configured, there is no setup route

🟢 That is the correct steady state once an installation is bootstrapped, rather than a route sitting
there refusing people.

_Source:_ `SECURITY.md`

### SC-ADM-011 — The first administrator is set up with a second factor immediately

🟢 Not as a later step somebody might skip.

_Source:_ release 1.0.0-rc.4

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/mfa-setup-flow.test.js`
    - MfaSetupFlow.run — first setup
        - returns secret + otpauthUri for SUPER_ADMIN
        - audit log contains issuer in changes
    - MfaSetupFlow.run — re-setup
        - rejects re-setup without confirmation (MFA_SETUP_ABORTED)
        - accepts re-setup with "yes" answer and audits MFA_SETUP_RESET
        - accepts re-setup with force=true without prompt
    - MfaSetupFlow.formatSetupResult
        - returns multi-line instructions with secret + URI

<!-- END proof -->

### SC-ADM-012 — Test-only bypasses are ignored in production

🟢 🔒 The switches that skip the second factor and the rate limits exist for continuous integration
and are honoured only outside production. An integrator cannot add their own.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaGuard — RequireMfa decorator + header check
        - bypass with SAAS_PLATFORM_SKIP_MFA=1 in non-prod
        - no bypass in production

<!-- END proof -->

### SC-ADM-013 — A tenant-facing action that costs money requires the tenant's own administrator

🟢 🔒 Changing a plan, booking an add-on and cancelling are not things any signed-in user of a tenant
may do. Reading stays open to everyone who is signed in.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-route-that-costs-money-asks-for-the-role.test.js`
    - a route that costs money asks for the role
        - the controller has routes, and each carries its metadata
        - every writing route asks for the tenant administrator
        - the three that cost money are actually among them
        - reading and previewing stay open to every tenant user
- `packages/nest/tests/tenant-billing-controller.test.js`
    - getEntitlement returns EffectiveLimitsSnapshot generically (quotas map)
    - getUsage joins Subscription + Limits + Usage and fills missing quotaKeys with 0
    - getUsage passes packageSnapshot + checkoutOfferId through 1:1 (P11.4)
    - getUsage returns packageSnapshot=null when the Subscription has no snapshot
    - getUsage throws NotFoundException when the Subscription is missing
    - the tenant is taken from the session, not from what the caller sent
    - and a session that names none is refused rather than falling back
    - getUsage throws NotFoundException when tenantIdResolver yields no ID
    - ComposedTenantAuthGuard chains guards in order — all ok = true
    - ComposedTenantAuthGuard short-circuits on the first false
    - ComposedTenantAuthGuard throws 403 without configured guards
- `packages/nest/tests/tenant-manifest.test.js`
    - buildTenantManifestController
        - creates a controller class with the configured path
- `packages/nest/tests/the-cost-routes-require-the-tenant-admin.test.js`
    - the cost-relevant tenant routes
        - the controller declares some, and each one is a real route
        - a caller without a role is refused, with the code the client reads
        - an unauthenticated caller is refused separately
        - the tenant's own administrator is admitted
        - `role` is honoured where `platformRole` is absent
        - a platform operator is admitted too
        - a plain member is refused

<!-- END proof -->

### SC-ADM-014 — An administrator identity may live in the platform's tables or the application's

🟢 The second factor works either way, so an installation that already has an admin user table does
not have to keep a second one.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/whoami-flow.test.js`
    - WhoAmIFlow.run
        - SUPER_ADMIN with MFA → full diagnosis
        - user not found → isSuperAdmin=false, no crash
        - production is detected
        - MFA skip visible in non-prod
        - MFA skip NOT active in production
    - WhoAmIFlow.formatResult
        - shows SUPER_ADMIN checkmark + MFA status
        - shows bypass warning when active
- `packages/nest/tests/admin-guards.test.js`
    - SuperAdminGuard
        - accepts SUPER_ADMIN
        - rejects TENANT_ADMIN
        - rejects a missing user

<!-- END proof -->

### SC-ADM-015 — The administration only offers what the application actually has

🟢 A screen or an action for something the application never declared is not shown at all.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/admin-resources-mapping.test.js`
    - the mapping
        - defaults to exactly the names that used to be hardcoded
        - a partial mapping leaves the rest at the defaults
    - a mapped delegate that does not exist fails at construction
        - and names what the client does have
        - and does not offer $connect as a candidate
        - the adapter refuses to be built with it
        - but an unmapped adapter is built even without those delegates
    - an app that calls everything something else
        - the tenant list queries and reads the mapped names
        - the detail route addresses the tenant by the mapped slug
        - suspending writes the mapped flag
        - the user list filters and reads the mapped names
    - an app that matches the convention is unaffected
        - no mapping means the same queries as before
    - the mapping reaches the two places it used to stop short of
        - the relation counter defaults to the mapped users relation
        - an explicit tenantMetrics still wins
        - the subscription list selects and reads the mapped tenant columns
        - and an unmapped app still selects slug and name
    - the two relations that live on the app models
        - the tenant list reads the mapped subscription relation
        - the detail route reads it as well
        - the user list filters and reads the mapped tenant relation
        - an unmapped app is unaffected in all three
- `packages/adapter-prisma/tests/prisma-admin-resources.test.js`
    - PrismaAdminResourcesAdapter serves every standard Admin resource
- `packages/cli/tests/manifest-cli-flow.test.js`
    - ManifestCliFlow.dump / hash / validate
        - dump returns the manifest 1:1
        - hash returns manifestHash
        - hash throws when hash is missing
        - validate ok for a clean manifest
        - validate rejects wrong schemaVersion
    - ManifestCliFlow.diff
        - null for identical hash
        - returns added/removed componentKeys
    - ManifestCliFlow.runChecks — DEFAULT_MANIFEST_CHECKS
        - clean manifest → overall=ok, all checks green
        - wrong manifestHash pattern → error, exitCode=7
        - per-tenant endpoint in TenantColumn → error
        - non-/admin route → error
        - unknown requiredCapability ref → error
        - wrong Capability pattern → error
        - SCREAMING_SNAKE_CASE actionKey now violates domain.action → error
        - formatReport shows severity icons + paths
- `packages/nest/tests/admin-resources.test.js`
    - AdminResourcesService keeps tenant actions and writes their audit entry
- `packages/nest/tests/tenant-manifest.test.js`
    - TenantManifestService
        - returns a snapshot with filtered NavItems (feature gate)
        - sorts NavItems by order ASC, default 100
        - requiresFeature as an array = logical OR
        - registerNavItem is idempotent (same id overwrites)
    - SaaSiCatModule + tenantManifest
        - tenantManifest without defaultPlanId/resolver throws
        - tenantManifest + defaultPlanId registers controller + service
- `packages/ui-vue/tests/app-served-resources.test.js`
    - pilotsResource — the paths a consumer already serves
        - ${c.op} calls ${c.method} ${c.url}
        - every operation this descriptor declares has a case above
    - platformEmailResource and emailHistoryResource
        - ${name}.${c.op} calls ${c.method} ${c.url}
        - ${name}: every operation has a case above
    - the second factor travels as a header, and only when there is one
        - ${name} sends the header with a code
        - ${name} sends no header for an empty code
    - the two operations the platform ships but does not serve
        - users.resetPassword posts the audit reason
        - promoCodes.detail reads one code by id
    - dashboardResource — the endpoint comes from the card, not from us
        - reads exactly the endpoint the card declares
        - a reading, not a rendering — the timestamp comes back unformatted
        - a body with no recognised number reads as null, not as a failure
- `packages/ui-vue/tests/manifest-loader.test.js`
    - ManifestLoader.load — first call
        - GET without If-None-Match, persists body + ETag
        - the client's auth header reaches the request untouched
        - storageKeyPrefix isolates caches
    - ManifestLoader.load — cache hit (304)
        - sends If-None-Match + returns cached body on 304
        - a 304 whose cached body is gone is repaired, not reported
        - a cached body that no longer parses is repaired the same way
        - a 304 to a request that carried no ETag is a server fault, and is reported
        - a server answering 304 unconditionally is reported after one repair, not looped on
    - ManifestLoader.load — refresh (200 with new ETag)
        - 200 overwrites cache with new body + ETag
    - ManifestLoader.clearCache
        - deletes body + ETag from storage
    - ManifestLoader.readCachedBody
        - returns null on empty cache
        - returns {etag, body} after a successful load
    - ManifestLoader — the client authenticates, per request
        - a token acquired after construction reaches the next request
        - a token that changes between requests is not cached
- `packages/ui-vue/tests/manifest-store-factory.test.js`
    - createManifestStore — Happy Path
        - initial: manifest=null, loaded=false, loading=false
        - ensureLoaded triggers load + sets loaded=true
        - ensureLoaded is idempotent — second call does not load again
        - parallel ensureLoaded calls share the same inflight promise
    - createManifestStore — error path
        - ensureLoaded rejects with the original error, state is still set
        - parallel ensureLoaded calls all reject with the same error
    - createManifestStore — clearCache + reload
        - clearCache clears manifest, loaded, loader cache
        - reload forces a re-load
    - createManifestStore — store ID override
        - uses the given `id`, so parallel stores are isolated
- `packages/ui-vue/tests/nav-builder.test.js`
    - buildRoutes — StandardPages filter
        - lists enabled StandardPages with Capability=true
        - rejects disabled pages
        - rejects pages without Capability
        - default routes from DEFAULT_STANDARD_PAGE_ROUTES
        - does not expose the removed planVersions standard page
        - ignores standard pages unsupported by this UI build
        - standardPageRoutes override
        - isStandard=true for StandardPages
    - buildRoutes — ProjectPages
        - lists a ProjectPage without requiredCapability
        - rejects a ProjectPage with a missing Capability
        - lists a ProjectPage with a satisfied Capability
        - navSection is passed through
        - availableExtensions filters out ProjectPages with an unknown componentKey
        - availableExtensions keeps ProjectPages with a known componentKey
    - buildSidebar — section grouping
        - sectionOrder wins, the rest alphabetical
        - sectionOrder override via second parameter
        - items within a section without mutation
    - resolveExtension
        - returns the registered component
        - null for an unknown key
- `packages/ui-vue/tests/resource-registry.test.js`
    - createResourceRegistry — the http requirement
        - refuses to be built without a client, rather than reaching for fetch
        - the message names the two clients the package ships
    - createResourceRegistry — a registry without a project to name
        - every platform resource builds from apiBase and locale alone
        - and the plan list it hands out addresses the catalogue
    - createResourceRegistry — reaching a resource
        - hands out the operations of the resource asked for
        - an unknown key fails by name, listing what there is
        - keys() reports what it can answer for
        - asking twice gives the same operations
        - a context getter is read per call
    - createResourceRegistry — overrides
        - a context override redirects one resource and leaves the others
        - an http override sends one resource through another client
        - one operation is wrapped and the other five stay the platform’s
        - the wrapper may answer without calling the platform at all
        - overriding a resource that does not exist fails at boot too
        - an override named after an Object prototype key is still rejected
        - an operation named after Object.prototype does not exist either
        - overriding an operation that does not exist fails at boot, not at click
    - platformResources
        - is what the shell registers, and every entry is a resource
    - registry.bind — an override for one page instance
        - the instance wrapper runs outside the app wrapper, and both run
        - an instance context wins over the app context for that page only
        - binding one operation leaves the others on the platform implementation
        - an unknown resource says so instead of returning something inert

<!-- END proof -->

### SC-ADM-016 — Signing out ends the session

🟢 It used to leave the operator looking at a sign-in form while still signed in.

_Source:_ release 0.22.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/sign-out-ends-the-session.test.ts`
    - AdminManifestErrorPage sign-out
        - calls the login adapter’s logout before leaving for /login
        - says so loudly when the app supplied no way to end the session
        - an explicit onLogout prop still wins over the default
    - AdminLayout sign-out
        - ends the session when no @logout listener is attached
        - defers to the app when one is
        - also defers when the listener was attached with @logout.once
    - sign-out and the cached manifest
        - discards the manifest, and does so even when logout rejects
    - handlers hand their promise back to Vue
        - a rejecting %s prop reaches Vue’s error handler

<!-- END proof -->

### SC-ADM-017 — An expired session offers a fresh sign-in once, not in a loop

🟢 Repeating it forever is how a rejected session becomes an unbreakable login loop.

_Source:_ release 0.22.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/navigation-guard.test.js`
    - buildNavigationGuard — auth path
        - returns null when neither authGuard nor manifestGuard is set
        - redirects to onUnauthenticated() when isAuthenticated is false
        - lets public routes bypass the auth guard
        - redirects to onUnauthenticated when isSuperAdmin is false
    - buildNavigationGuard — manifest fail-closed
        - redirects to errorRoute when ensureLoaded rejects and errorRoute is set
        - avoids redirect loop: when the current route is already errorRoute, returns true
        - falls back to render-allow + console.error when NO errorRoute is set
        - lets the render through when ensureLoaded resolves successfully
    - buildNavigationGuard — expired session vs broken manifest
        - 401 from the manifest load routes to login, not to the error page
        - 403 is treated the same way
        - a genuine manifest failure still fails closed to the error page
        - an error without a status stays on the fail-closed path
        - without an authGuard a 401 still reaches the error page
    - buildNavigationGuard — no login loop on a persistent manifest 401
        - first 401 offers a re-login, the second stops the circle
        - a successful load re-arms the redirect for a later expiry
        - concurrent navigations on one rejection share the login redirect
        - the second attempt fails closed once the operator has seen login
        - a cached error instance does not resurrect the login loop
        - a later, different rejection still fails closed

<!-- END proof -->

### SC-ADM-018 — A one-time code that was just accepted can currently be accepted again

🟢 Within its validity window. This is a known limitation, named rather than left to be discovered,
and the ordering of the checks plus transport encryption are the current mitigations.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - MfaService — TOTP setup + verify
        - setup() generates secret + otpauth URI and persists via port
        - verify() rejects when no secret exists
        - verify() rejects an invalid code
        - disable() deletes the secret
        - isEnabled() reflects port state

<!-- END proof -->

## 15. Working in the interface

The administration is an application SaaSiCat hands over; the tenant-facing pieces are guests in
somebody else's. This chapter says what a person can expect from either: that screens behave
alike, that failures appear where they were caused, and that nothing irreversible happens without
saying what it will do.

### SC-UI-001 — Every standard screen is built the same way

🟢 The same blocks in the same order, so a screen an integrator adds stands next to the shipped ones
without looking like a guest, and a person who has learned one screen has learned the rest.

_Source:_ ADR 0008 · `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/admin-page-shell.test.ts`
    - AdminHero
        - renders the title as the page heading
        - omits the subtitle and the actions bar when neither is supplied
        - renders a markup subtitle through the slot
    - AdminSection
        - names the section by pointing aria-labelledby at its own heading
        - gives sibling sections distinct heading ids
        - renders no heading level above h2
    - page shell contract
        - the source sweep actually finds the pages it claims to check
        - AdminPage renders no &lt;main&gt; — the landmark belongs to AdminLayout
        - no content page renders its own &lt;main&gt; or a QPage
        - no content page hand-writes the hero markup instead of using AdminHero
        - AdminHero renders the only &lt;h1&gt; in the package
        - no view renders its hero inside the page body
        - no view hand-writes the reload button instead of using AdminRefreshBtn
        - no view writes its own table instead of using AdminTable
        - a component whose only job is to emit is never used without a listener
        - the actions column is filled through row-actions, not body-cell-actions
        - no page declares its own statistic tile styling
        - an unscoped page style reaches only its own sub-components
        - no page block titles itself with a heading-shaped &lt;div&gt;
        - no view writes its own disclosure instead of using AdminAccordion
    - the boundaries a page keeps
        - the sweep reaches the pages it claims to check
        - no page reaches for Quasar directly
        - no page redeclares the frame the theme draws
        - a page imports only from the layers below it
        - no primitive hard-codes a user-visible string
        - no file grows past the budget for its layer
- `packages/ui-vue/tests/pages-take-no-callbacks.test.js`
    - a page takes no callbacks
        - the guard reads every page in `src/pages/`
        - no prop in `src/pages/` is callable, and none exceeds the cap
        - the one exception says why, in its own source
    - the guard fails on what it forbids
        - an inline callback prop
        - a callback hidden behind a type alias — what a pattern cannot see
        - a sixth prop
        - an exception tag with no real reason
        - a declared exception passes
- `tests/baselines-record-a-page-at-rest.test.js`
    - recorded baselines
        - none of them recorded a node that was leaving

<!-- END proof -->

### SC-UI-002 — Mounting a shipped screen costs no wiring

🟢 An application that needs one operation to behave differently replaces that one operation and
keeps the other nine. Before this, mounting one screen cost between 8 and 145 lines of glue with
no rule saying which.

_Source:_ ADR 0008

<!-- BEGIN proof -->

_Tested by:_

- `packages/create-saasicat-admin/tests/scaffold.test.js`
    - parseArgs
        - positionals + flags + tokens are separated
    - applyTokens
        - replaces only tokens, passes other **X** strings through
    - walkTemplates
        - finds all .tpl files under templates/
    - scaffold
        - writes all templates into target + replaces tokens
        - dryRun writes nothing
    - bin entry point
        - runs through a bin symlink, as npm create / npx invoke it
- `packages/ui-vue/tests/boot-loader.test.js`
    - BootLoader.load
        - returns body on 200
        - sends GET to the configured endpoint
        - configurable endpoint
        - throws BootLoadError on non-200
        - endpoint is required: without an endpoint BootLoader throws
- `packages/ui-vue/tests/component/bootstrap-installs-what-it-provides.test.ts`
    - resolveQuasarOptions
        - with no app options, the platform set is installed
        - an app configuring Quasar still gets every plugin the ports need
        - the app’s own config is kept
        - an app may replace a plugin with its own build
        - an app that passes only a config keeps the whole platform set
    - the resource registry is installed only with a real client
        - an app that names its client gets a registry
        - an app that does not gets none, rather than one wired to a bare fetch
- `packages/ui-vue/tests/component/promo-code-detail-follows-the-route.test.ts`
    - PromoCodeDetailPage follows the route param
        - navigating from one code to another loads the second
- `packages/ui-vue/tests/component/route-mounted-pages.test.ts`
    - pages mounted by createAdminRoutes()
        - ${name} declares no required props
        - ${name} mounts with no props and without Vue warnings
        - the roster covers every page create-admin-routes mounts directly
    - AdminManifestErrorPage retry
        - boots into a guarded route rather than reloading the public error route
        - discards the cached manifest before booting, not after
    - AdminManifestErrorPage without callbacks
        - its buttons are wired to handlers, never to a possibly-undefined prop
- `packages/ui-vue/tests/component/tenant-detail-follows-the-route.test.ts`
    - TenantDetailPage follows the route param
        - navigating from one slug to another loads the second
- `packages/ui-vue/tests/component/the-plan-page-steps-aside-for-its-steps.test.ts`
    - the route table marks the plan steps as steps
        - the plans route has the two steps as children
        - every nested standard route carries the step marker
        - a claimed plans route keeps the steps beneath it
        - an own children list on a claimed route wins outright
        - a top-level standard route is not marked
    - the condition the page reads answers per route
        - the paths resolve at all
        - on the plans route itself the page owns the hero
        - on the editor step the page stands aside
        - on the review step the page stands aside
        - and on a sibling page it owns the hero again
- `packages/ui-vue/tests/integration.test.js`
    - Full bootstrap flow: Boot → Manifest → Routes → Actions
        - Consumer login bootstrap sequence
        - Cache-hit path: second manifest load returns 304
        - Logout path: clearCache clears everything
        - Manifest reload after a `manifest reload` action invalidates the cache
    - Drift detection: manifest vs. consumer shell build
        - Action drift detected: manifest action without a handler
        - UI rejects routes with a missing capability
    - Bulk publish: end-to-end with server path
        - Publish 3 drafts: 2 OK, 1 conflict — atomic progress
- `packages/ui-vue/tests/pages-barrel-is-complete.test.js`
    - the pages barrel and the pages directory agree
        - there are pages to compare
        - every page on disk is in the barrel
        - every entry in the barrel is a page on disk
        - each name matches the file it loads
    - the standard routes point at pages that exist
        - there are routes to check
        - each names a page the barrel maps
        - no two routes answer the same path
        - the error page is not among them
- `packages/ui-vue/tests/pages-read-the-params-their-routes-declare.test.js`
    - a page reads the route parameter its route declares
        - the table was read at all
        - every parameterised route is answered by a page that reads it
    - the reader sees what it has to see
        - a mismatched read is reported
        - a read written across lines counts
        - a bracketed read counts
        - the path parser finds the parameter
- `packages/ui-vue/tests/plan-step-routes-exist.test.js`
    - every step of the plan wizard navigates to a registered route
        - the plan pages and their routes are found
        - ${page} pushes only to standard routes
- `packages/ui-vue/tests/platform-loaders.test.js`
    - createPlatformLoaders
        - returns BootLoader + ManifestLoader instances
        - derives default endpoints from apiBase
        - honors explicit endpoint overrides
        - passes storageKeyPrefix and the client through to ManifestLoader
- `packages/ui-vue/tests/the-fixture-installs-what-the-bootstrap-does.test.js`
    - the visual fixture installs what createSuperAdminApp installs
        - both files were actually read
        - no seam the bootstrap installs is missing from the fixture
    - the reader sees what a pattern would miss
        - a provide spread over several lines is found
        - a missing key is reported rather than passed over

<!-- END proof -->

### SC-UI-003 — Replacing one operation that does not exist is refused at start-up

🟢 With the list of the ones that do. A typo in an override is otherwise a call that quietly keeps
the old behaviour until somebody notices an approval was never recorded.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/app-served-resources.test.js`
    - pilotsResource — the paths a consumer already serves
        - ${c.op} calls ${c.method} ${c.url}
        - every operation this descriptor declares has a case above
    - platformEmailResource and emailHistoryResource
        - ${name}.${c.op} calls ${c.method} ${c.url}
        - ${name}: every operation has a case above
    - the second factor travels as a header, and only when there is one
        - ${name} sends the header with a code
        - ${name} sends no header for an empty code
    - the two operations the platform ships but does not serve
        - users.resetPassword posts the audit reason
        - promoCodes.detail reads one code by id
    - dashboardResource — the endpoint comes from the card, not from us
        - reads exactly the endpoint the card declares
        - a reading, not a rendering — the timestamp comes back unformatted
        - a body with no recognised number reads as null, not as a failure
- `packages/ui-vue/tests/catalog-composables.test.js`
    - usePlans
        - the endpoint is required
        - load() filters by project key and sends the auth header
        - load() without a token sends none rather than an empty one
        - a failed load lands on `error` and leaves the list alone
        - an unparseable error body is still an error, with no body
        - create() appends the created row
        - update() replaces exactly the row it changed
        - softDelete() and hardDelete() drop the row and hit different paths
        - a mutation the server answered without a body does not touch the list
        - loadTenantCounts() fills the map, and swallows its own failure
        - autoLoad fetches without being asked
    - usePlanVersions
        - the endpoint and the plan id are both required
        - load() reads the versions of that plan
        - a failed load says PlanVersions, not Plans
        - createDraft() appends the new version out of the mutation result
        - updateDraft() and publish() replace the version they addressed
        - discardDraft() removes it and terminateVersion() replaces it
        - every mutation that needs a body rejects when none arrives
        - autoLoad fetches without being asked
    - useBundles
        - the endpoint is required
        - load(), create(), update() and softDelete() keep the list in step
        - a failed load lands on `error`
        - autoLoad fetches without being asked
    - useBundleVersions
        - the endpoint and the bundle id are both required
        - createDraft() appends and updateDraft() replaces
        - publish() reloads, because it can supersede another version
        - discardDraft() removes the version from the list
        - a failed load says BundleVersions
        - autoLoad fetches without being asked
    - useCatalogEntries
        - the endpoint is required
        - load() reads capabilities, features and quotas in one go
        - one failing request fails the load, and the lists stay empty
        - reviewFeature() and reviewQuota() replace the entry they reviewed
        - the i18n and base editors address their own paths
        - every editor rejects when the answer carries no entry
        - syncDiscovery() posts the snapshot and reloads the three lists
        - autoLoad fetches without being asked
    - usePromotions
        - the endpoint is required
        - load(), create(), update() and remove() keep the list in step
        - a failed load lands on `error`
        - autoLoad fetches without being asked
    - useMarketingProjections
        - the endpoint is required
        - the query string carries only the filter parts that are set
        - setFilter() replaces the filter and reloads with it
        - create() reloads, because a new tuple can fall inside the filter
        - update() patches the row in place, remove() drops it
        - a mutation without a body rejects, and create() does not reload after it
        - a failed load lands on `error`
        - autoLoad fetches without being asked
- `packages/ui-vue/tests/composables.test.js`
    - usePublicBoot
        - initial state: boot=null, loading=false
        - load() fills boot.value
        - load() sets error on HTTP failure
        - loading state toggles correctly
    - useManifest
        - initial state: manifest=null
        - load() fills manifest
        - reload() discards cache + loads fresh
        - clearCache() sets manifest to null
- `packages/ui-vue/tests/resources-match-the-composables.test.js`
    - the list descriptors match the list composables
        - ${resource.name}: ${testCase.name}
        - the list operation these cases drive is the one they name
    - plansResource matches usePlans
        - ${testCase.name} sends the same request
    - planVersionsResource matches usePlanVersions
        - ${testCase.name} sends the same request
    - the comparison itself
        - covers every operation both sides declare
        - terminate matches too, under the composable’s own name
        - the one header the two sides do not agree on
    - family.name
        - ${testCase.op} sends the same request
    - the comparison covers the whole roster
        - ${key}: every operation is driven by a case
- `packages/ui-vue/tests/resources-optional-arguments.test.js`
    - a list with no filter asks for no filter
        - promoCodes.list() sends a bare path
        - users.list() sends a bare path
        - marketing.listProjections() sends a bare path when nothing narrows it
        - tenants.list() asks for the first page at the default size
    - a publish with nothing overridden
        - planVersions.publish sends an empty object, not an absent body
        - bundleVersions.publish does the same
    - a discovery read with no tag to revalidate against
        - read() sends no If-None-Match
        - read(null) is the same request — that is how a forced reload is spelled
        - read(etag) revalidates
        - an unchanged snapshot is not re-read
        - a loaded snapshot carries the tag the next read revalidates with
        - a status that is neither 200 nor 304 fails rather than reading a body
        - a rescan that does not answer 200 or 201 fails the same way
    - an empty list answer is a list, not a null
        - ${def.key}.${op} answers []

<!-- END proof -->

### SC-UI-004 — Nothing is written until the person saves or publishes

🟢 Editors keep unsaved work across the steps of a wizard, and a step only moves on when the save
actually succeeded — a rejected save used to look exactly like a successful one.

_Source:_ release 1.0.0-rc.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/bundles-page-owns-what-it-saves.test.ts`
    - BundlesPage loads the live plan versions the overlap check reads
        - each plan maps to its live version
    - BundlesPage writes back what a mutation returns
        - an edited label shows in the row the page owns
        - a saved version reaches the aggregate map the KPIs read
- `packages/ui-vue/tests/component/clearable-fields.test.ts`
    - clearable fields
        - the sweep finds the fields it claims to check
        - no clearable model has a string method called on it unguarded
- `packages/ui-vue/tests/component/discovery-page-keeps-the-first-edit.test.ts`
    - DiscoveryPage carries a saved translation into the next save
        - the second payload still holds the first edit
- `packages/ui-vue/tests/component/grouped-options-keep-their-defaults.test.ts`
    - a page configured with nothing still shows what it used to
        - TenantsPage renders the plan column
        - PromoCodesPage offers the four statuses in its filter
- `packages/ui-vue/tests/component/plan-wizard-keeps-its-draft.test.ts`
    - the wizard carries its unsaved draft across the two routes
        - the editor writes what was typed into the wizard, not into the page
        - the review renders the unsaved values, not the published version
        - the draft outlives the navigation between the two steps
        - cancelling clears the draft rather than leaving it for the next plan
    - a step leaves the wizard only when the write happened
        - a refused save keeps the draft and stays on the step
        - a save that succeeds clears the draft
        - publish carries the form and the checklist flags
        - a publish that does not go through keeps the draft
- `packages/ui-vue/tests/kv-store.test.js`
    - defaultKvStore
        - without localStorage it is a no-op store
        - a throwing localStorage getter does not escape
        - reads and writes go through when localStorage works
        - a failing write is swallowed — quota or private mode
        - a failing read yields null rather than throwing
- `packages/ui-vue/tests/use-plan-editor.test.js`
    - usePlanEditor — Discovery (availableFeatures)
        - lists all catalog features with correct marker flags
        - featuresByTier groups + sorts by tier order
        - features without tier land in OTHER group at the end
        - manifest without features block: empty but no crash
    - usePlanEditor — toggleFeature
        - toggle add + remove
        - toggle on plannedOnly feature is ignored (no state change)
        - nonRegressive: inherited feature cannot be removed
        - nonRegressive=false: inherited feature may be removed
    - usePlanEditor — validateDraft + snapshot
        - snapshot returns sorted selection
        - validateDraft accepts a clean selection
        - validateDraft throws PlannedOnlyFeatureError when (e.g. via direct set) a plannedOnly key
          is present
- `packages/ui-vue/tests/use-steps.test.js`
    - a linear wizard knows where it is
        - it starts on the first step
        - every step is done, current or upcoming
        - back on the first step is refused rather than wrapping around
        - next on the last step is refused
        - reset takes it back to the start
    - a guarded step refuses to advance
        - the guard stops the move and says so
        - a click on a next button the guard refuses moves nothing
        - the same predicate answers the button and the move
    - focus follows the step
        - advancing puts focus on the new heading
        - going back puts focus on the heading too
        - a refused move does not move focus
        - the heading is focusable without joining the tab order
    - a wizard with no steps is a mistake, not an empty wizard
        - it refuses to be built
- `packages/ui-vue/tests/use-subscription-draft.test.js`
    - useSubscriptionDraft — plan selection
        - selectedPlan is null before selection
        - setPlan removes bundles incompatible with the new plan
        - setPlan keeps universally compatible bundles
    - useSubscriptionDraft — cycle toggle
        - Monthly uses monthlyNet, Yearly uses yearlyNet
        - yearSavings = 12*monthly − yearly
        - yearlyNet=null falls back to monthly × DEFAULT_YEARLY_FACTOR
    - useSubscriptionDraft — Bundles
        - Bundle toggle marks bundle + activates its features
        - Bundle deselect removes activated features again
        - Bundle price flows into subtotalNet
    - useSubscriptionDraft — Promo-Discount
        - PERCENT promo is applied to subtotalNet
        - ABSOLUTE promo is capped at subtotal
        - clearPromo removes discount + sets status idle
        - setPromoCode clears a previous valid status
    - useSubscriptionDraft — toApiPayload
        - serializes plan + cycle + bundle version IDs
        - without bundle selection bundleVersionIds is missing from the payload
        - serializes promoCode only when status is valid
        - throws when plan is not set
    - useSubscriptionDraft — redundant (covered) bundles
        - covered bundle does not flow into bundlesNet nor into the breakdown
        - covered bundle is missing from toApiPayload().bundleVersionIds
        - deselecting the covering bundle charges the other one again
        - mutual coverage Y={C},Z={C} → exactly ONE bundle charged + sent
    - useSubscriptionDraft — isDirty
        - false with fresh state
        - true as soon as a bundle is added

<!-- END proof -->

### SC-UI-005 — A failure appears where the person was looking

🟢 A page that could not load says so under its title; an action that failed inside an open dialog
says so in the dialog; only a failure with nothing on screen to attach to becomes a notification.
Never a notification for a failed load, and never one for something already visible.

_Source:_ `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/admin-error.test.js`
    - AdminError
        - defaults to status 0 — a request that never produced one
        - the diagnostic message names the request, the status and the code
        - the diagnostic carries the detail when there is one
        - an explicit message overrides the derived one
        - cause is preserved
    - isAdminError
        - recognises an instance
        - rejects a plain error, a look-alike object, and nothing at all
    - isEmptyResponse
        - recognises what a throw site marked, and nothing else
        - the marker is not enumerable, so it does not leak into a log line
    - isTransportFailure
        - recognises what a client marked, and nothing else
        - marking a non-object is a no-op rather than a second failure
        - the marker is not enumerable, so it does not leak into a log line
    - toAdminError
        - passes an AdminError through untouched
        - reads an axios rejection: status, code, body, url and method
        - a status-bearing error with an unreadable body has no detail at all
        - joins a NestJS ValidationPipe message array instead of stringifying it
        - reads one of the package’s own API errors, which carry status and body
        - an answer that was empty is not a connection problem
        - a consumer client rejecting with status 0 is not an empty response
        - a manifest 304 that survives to be thrown is a diagnostic like any other
        - a real HTTP failure is not an empty response
        - a declared transport failure keeps its diagnostic off detail, so the catalog answers
        - an axios failure with no response is transport too
        - but an interceptor’s own error is not, however much of axios it carries
        - but an error from app code keeps its message — that IS what was said
        - wraps a thrown string
        - survives a thrown nothing
    - a transport failure is declared by the client, not read off the class
        - a null dereference is not a connection problem
        - a real fetch failure still says "check your connection"
        - a malformed URL is a transport failure too, not an unknown one
        - the client passes a response through untouched
    - toAdminError and consumer errors
        - a consumer error carrying a status keeps its message
        - a consumer error merely NAMED like ours is still a consumer error
    - emptyResponse is read off the throw site, not off the class
        - a mutation the server answered without a body is an empty response
        - a boot GET a client resolved as status 0 never reached the server
        - a manifest GET a client resolved as status 0 never reached the server
        - nor did a mutation a client resolved as status 0 — on any of the surfaces
        - a discovery load a client resolved as status 0 never reached the server
    - toAdminError and rejections that are not Errors
        - a plain object keeps the message it carries
        - an Error from another realm is such an object
        - an object with nothing readable falls through to the generic wording
        - a non-string message is not a message
    - adminErrorMessage
        - what the failing side said outranks anything the platform could guess
        - maps the statuses that have their own wording
        - any other status falls through to the generic template, with the number in it
        - a failure nothing knows anything about says so, rather than blaming the network
        - a seam that declares the request never went out gets the network wording
        - converts before formatting, so an axios rejection needs no pre-processing
        - German is a complete alternative, not a fallback to English
    - HttpJsonError is AdminError
        - the two names are one class, so an existing instanceof check keeps working
    - getJson / postJson raise AdminError
        - a non-2xx carries status, code, detail, url and method
        - postJson reports its own method
        - an error body that is not JSON does not become a second failure
        - a validation rejection keeps its constraints — the array is joined here too
        - a 2xx still returns the parsed body
    - httpStatusOf reads the status whichever shape carries it
        - an AdminError carries it at `status`
        - an axios rejection carries it at `response.status`
        - anything else has none
- `packages/ui-vue/tests/component/error-state-outranks-the-accent.test.ts`
    - the accent label yields to the error state
        - the stylesheet the theme has to outrank really parsed
        - a focused valid field still gets the accent label
        - a focused invalid field keeps its negative label
        - an invalid field that was never focused keeps it too
        - a list item has no error state for the sibling rule to trample

<!-- END proof -->

### SC-UI-006 — What a person is shown after a failure is what the failing side said

🟢 Not the diagnostic that helps a developer find it. The two are kept apart deliberately, so a
stack-shaped message never reaches a screen.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/admin-error.test.js`
    - AdminError
        - defaults to status 0 — a request that never produced one
        - the diagnostic message names the request, the status and the code
        - the diagnostic carries the detail when there is one
        - an explicit message overrides the derived one
        - cause is preserved
    - isAdminError
        - recognises an instance
        - rejects a plain error, a look-alike object, and nothing at all
    - isEmptyResponse
        - recognises what a throw site marked, and nothing else
        - the marker is not enumerable, so it does not leak into a log line
    - isTransportFailure
        - recognises what a client marked, and nothing else
        - marking a non-object is a no-op rather than a second failure
        - the marker is not enumerable, so it does not leak into a log line
    - toAdminError
        - passes an AdminError through untouched
        - reads an axios rejection: status, code, body, url and method
        - a status-bearing error with an unreadable body has no detail at all
        - joins a NestJS ValidationPipe message array instead of stringifying it
        - reads one of the package’s own API errors, which carry status and body
        - an answer that was empty is not a connection problem
        - a consumer client rejecting with status 0 is not an empty response
        - a manifest 304 that survives to be thrown is a diagnostic like any other
        - a real HTTP failure is not an empty response
        - a declared transport failure keeps its diagnostic off detail, so the catalog answers
        - an axios failure with no response is transport too
        - but an interceptor’s own error is not, however much of axios it carries
        - but an error from app code keeps its message — that IS what was said
        - wraps a thrown string
        - survives a thrown nothing
    - a transport failure is declared by the client, not read off the class
        - a null dereference is not a connection problem
        - a real fetch failure still says "check your connection"
        - a malformed URL is a transport failure too, not an unknown one
        - the client passes a response through untouched
    - toAdminError and consumer errors
        - a consumer error carrying a status keeps its message
        - a consumer error merely NAMED like ours is still a consumer error
    - emptyResponse is read off the throw site, not off the class
        - a mutation the server answered without a body is an empty response
        - a boot GET a client resolved as status 0 never reached the server
        - a manifest GET a client resolved as status 0 never reached the server
        - nor did a mutation a client resolved as status 0 — on any of the surfaces
        - a discovery load a client resolved as status 0 never reached the server
    - toAdminError and rejections that are not Errors
        - a plain object keeps the message it carries
        - an Error from another realm is such an object
        - an object with nothing readable falls through to the generic wording
        - a non-string message is not a message
    - adminErrorMessage
        - what the failing side said outranks anything the platform could guess
        - maps the statuses that have their own wording
        - any other status falls through to the generic template, with the number in it
        - a failure nothing knows anything about says so, rather than blaming the network
        - a seam that declares the request never went out gets the network wording
        - converts before formatting, so an axios rejection needs no pre-processing
        - German is a complete alternative, not a fallback to English
    - HttpJsonError is AdminError
        - the two names are one class, so an existing instanceof check keeps working
    - getJson / postJson raise AdminError
        - a non-2xx carries status, code, detail, url and method
        - postJson reports its own method
        - an error body that is not JSON does not become a second failure
        - a validation rejection keeps its constraints — the array is joined here too
        - a 2xx still returns the parsed body
    - httpStatusOf reads the status whichever shape carries it
        - an AdminError carries it at `status`
        - an axios rejection carries it at `response.status`
        - anything else has none

<!-- END proof -->

### SC-UI-007 — Loading, empty and error are handled deliberately on every screen

🟢 Through the same shared elements rather than a variant per page.

_Source:_ `docs/explanation/design-guide.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/list-resource.test.js`
    - isSentInQuery — which values reach the server
        - the three spellings of "not filtered" are left out
        - the falsy values that are answers are not
    - listUrl
        - always states its page, first and in order
        - appends to an endpoint that already carries a query
        - serialises the filter after the pagination, in insertion order
        - omits the empty values and keeps the falsy ones
        - encodes with URLSearchParams — a space is a plus, not %20
    - filterQueryString — the endpoints that do not page
        - is empty when nothing survives the rule
        - leads with a question mark when something does
    - readListPage — both shapes real controllers answer with
        - a bare array reports the rows it sent
        - an envelope is read field by field
        - what the answer did not state stays absent
        - a body that is neither is an empty page, not a crash
        - an `items` that is not an array is not passed off as rows
    - the page bounds the admin API serves
        - a page below the first is the first
        - a fractional page is the one it is on
        - a page size stays inside 1..max
- `packages/ui-vue/tests/use-async-action.test.js`
    - useAsyncAction — the happy path
        - resolves what the action returned
        - passes every argument through
        - pending is true while in flight and false afterwards
        - runs onSuccess with the result, before run resolves
        - stays silent on success by default
        - notifyOn "both" raises the success message
        - a success message may be computed at call time
    - useAsyncAction — failure
        - reports the failure in the result instead of throwing
        - a void action is still distinguishable — the whole reason for the shape
        - records the failure as an AdminError
        - clears pending even when the action throws
        - skips onSuccess
        - reports through the notify port, worded from the default catalog
        - what the server said outranks the catalog
        - errorMessage outranks both, and sees the AdminError
        - notifyOn "none" records the error without announcing it
        - without a notify port the failure is still recorded
    - useAsyncAction — overlapping invocations
        - pending stays true until the last one settles
    - useAsyncAction — a stale failure does not outlive a newer success
        - the older call failing last leaves no error behind
        - but a failure from the newest call is still recorded
    - useAsyncAction — a report cannot change what happened
        - a success toast that throws leaves the action successful
        - a successMessage that throws does the same
        - an error toast that throws still returns the action failure
    - useAsyncAction — the success continuation
        - a failing continuation fails the action, and says so only once
        - a continuation that succeeds still gets its success toast
    - useAsyncAction — the error ref over time
        - a later success clears an earlier failure
        - reset clears it without running anything
- `packages/ui-vue/tests/use-async-data.test.js`
    - useAsyncData — loading
        - starts at the initial value
        - loads on creation by default
        - immediate: false loads nothing until asked
        - does not block setup — nothing has loaded synchronously
        - pending is true while in flight
    - useAsyncData — failure
        - records the failure as an AdminError
        - puts the data back to initial rather than leaving stale rows
        - reload does not throw
        - clears pending even when the load throws
        - a later success clears the error
    - useAsyncData — overlapping loads
        - a superseded load does not overwrite the newer one
        - a superseded load does not clear pending while the newer one runs
        - a superseded load that FAILS does not wipe the page or raise its error
    - useAsyncData — watch
        - reloads when a watched source changes
        - a watched source combines with immediate: false — the first load is the change

<!-- END proof -->

### SC-UI-008 — Equivalent actions behave the same everywhere

🟢 Delete, save, cancel, edit, back, filter, search, pagination, confirmation and validation errors
work the same way on every screen unless there is a stated reason not to.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/action-registry.test.js`
    - ActionRegistry.get + dispatch
        - returns {def, handler} for a registered key
        - dispatch calls handler with input
    - ActionRegistry.get — error paths
        - ActionDefNotInManifestError for an unknown key
        - MissingHandlerError for a declared key without a handler
    - ActionRegistry.register — late binding
        - accepts handler registration for a declared key
        - rejects registration for non-declared keys
    - ActionRegistry — drift detection
        - listOrphanedDefs: manifest-declared actions without a handler
        - listOrphanedHandlers: registered handlers without a manifest def
- `packages/ui-vue/tests/pages-take-no-callbacks.test.js`
    - a page takes no callbacks
        - the guard reads every page in `src/pages/`
        - no prop in `src/pages/` is callable, and none exceeds the cap
        - the one exception says why, in its own source
    - the guard fails on what it forbids
        - an inline callback prop
        - a callback hidden behind a type alias — what a pattern cannot see
        - a sixth prop
        - an exception tag with no real reason
        - a declared exception passes
- `packages/ui-vue/tests/use-tenant-action-flow.test.js`
    - useTenantActionFlow — empty actions
        - actionsForRow returns [] when manifest is null
        - actionsForRow returns [] when tenants.actions is empty
    - useTenantActionFlow — flow order
        - Confirm → MFA → Handler in correct order
        - Confirm abort prevents MFA + Handler
        - MFA abort prevents Handler
    - useTenantActionFlow — capability and handler filter
        - hides action when requiredCapability is false in the manifest
        - hides action when no handler is registered in the actions map
        - visibleForRow filters row-specifically by capability+handler
        - availableActions is row-independent — Reactivate stays visible despite a sample row with
          isActive=true
        - availableActions statically filters disabled capabilities + orphan handlers
    - useTenantActionFlow — provider drift
        - throws when an action requires MFA but no mfa provider is set
        - throws when an action requires confirm but no confirm provider is set
        - orphanedDefs lists manifest actions without a handler

<!-- END proof -->

### SC-UI-009 — A destructive action says what it will destroy, by name

🟢 Not "Are you sure?" but "Delete API key 'Production Integration'? This action cannot be undone."

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/ui-confirm-port.test.ts`
    - quasarConfirmOptions
        - carries the wording the page wrote, not a generic "are you sure"
        - a destructive action is coloured as one
        - tone defaults to primary — only the caller may call something destructive
        - both buttons are labelled, so neither reads "OK"
        - no prompt means no input — a plain confirm stays plain
        - a prompt carries its initial value and type
        - a prompt with no initial value starts empty and takes text
    - useSuperAdminConfirm
        - an app-provided port is the one that gets asked
        - without one, the Quasar implementation is the fallback — which still asks
        - a context from an older package version still resolves, because the key is Symbol.for
- `packages/ui-vue/tests/use-bulk-publish.test.js`
    - useBulkPublish.setItems
        - sets items with default status pending
    - useBulkPublish.run — parallel publishes
        - all successful → success count = 3, done=true
        - single error → success=2, failure=1, done=true
        - empty changeNote → all items failed
        - mfaCode sets X-Mfa-Code header
        - auth token is sent along
    - useBulkPublish — endpoint mapping
        - endpoints are called per kind
        - override endpoints configurable
    - useBulkPublish — progress
        - progress=0 for empty set
        - progress=0 before run, =1 after run

<!-- END proof -->

### SC-UI-010 — An action sits with the object it acts on

🟢 "Publish this version" does not share a footer with "delete this bundle and every version of it".
One releases a draft; the other destroys the thing.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/action-registry.test.js`
    - ActionRegistry.get + dispatch
        - returns {def, handler} for a registered key
        - dispatch calls handler with input
    - ActionRegistry.get — error paths
        - ActionDefNotInManifestError for an unknown key
        - MissingHandlerError for a declared key without a handler
    - ActionRegistry.register — late binding
        - accepts handler registration for a declared key
        - rejects registration for non-declared keys
    - ActionRegistry — drift detection
        - listOrphanedDefs: manifest-declared actions without a handler
        - listOrphanedHandlers: registered handlers without a manifest def
- `packages/ui-vue/tests/component/bundle-actions-belong-to-their-object.test.ts`
    - the version keeps its actions together
        - save and publish share one bar
        - discard stays with the draft state that offers it
        - nothing spans both columns any more
    - the bundle keeps its own
        - soft-delete is not among the version actions
        - it sits in the card header, named for a reader who cannot see icons
        - it is not a button inside a button
        - deleting does not also expand the row it removes
    - deleting asks through the platform, not through the browser
        - the confirm port decides, and window.confirm is never called
    - two forms in one panel say which one is waiting
        - a pristine form offers nothing to save
        - an edit shows the marker and enables the button
- `packages/ui-vue/tests/component/one-dialog-per-page-not-per-row.test.ts`
    - the one-time-password dialog is one dialog
        - the fixture renders several rows — without that this proves nothing
        - one instance exists, however many rows there are

<!-- END proof -->

### SC-UI-011 — A list says how many rows there are, or says it is showing what it received

🟢 It does not present the number of rows in hand as a total it cannot know.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/batch-column-fetcher.test.js`
    - BatchColumnFetcher.fetchAll
        - 1 request per column with comma-separated tenantIds
        - paramStyle=repeat
        - Capability filter: insufficient columns are not fetched
        - empty tenantIds list → empty object, no request
        - the client's auth header reaches the request untouched
        - appends correctly to an endpoint with an existing query
    - BatchColumnFetcher — drift detection
        - per-Tenant placeholder in endpoint → BatchColumnDriftError
        - listDriftIssues collects all problematic columns
        - non-200 response throws an error naming column, endpoint and status
    - BatchColumnFetcher.eligibleColumns
        - returns only columns with a satisfied Capability
- `packages/ui-vue/tests/component/the-page-suite-finds-the-dashboard-distributions.test.ts`
    - the page suite finds the dashboard distributions where the page renders them
        - every distribution title answers the selector the suite ships
- `packages/ui-vue/tests/component/typed-lists-carry-their-row-type.test.ts`
    - useResourceList — the typed surface
        - hands a page its rows already typed, with no assertion at the call site
        - refuses the resources and operations that cannot answer with a page
- `packages/ui-vue/tests/list-resource.test.js`
    - isSentInQuery — which values reach the server
        - the three spellings of "not filtered" are left out
        - the falsy values that are answers are not
    - listUrl
        - always states its page, first and in order
        - appends to an endpoint that already carries a query
        - serialises the filter after the pagination, in insertion order
        - omits the empty values and keeps the falsy ones
        - encodes with URLSearchParams — a space is a plus, not %20
    - filterQueryString — the endpoints that do not page
        - is empty when nothing survives the rule
        - leads with a question mark when something does
    - readListPage — both shapes real controllers answer with
        - a bare array reports the rows it sent
        - an envelope is read field by field
        - what the answer did not state stays absent
        - a body that is neither is an empty page, not a crash
        - an `items` that is not an array is not passed off as rows
    - the page bounds the admin API serves
        - a page below the first is the first
        - a fractional page is the one it is on
        - a page size stays inside 1..max
- `packages/ui-vue/tests/use-api-list-shape.test.js`
    - useApiList response shape tolerance
        - Raw array `[{...}, {...}]` is consumed as items[]+total (array shape)
        - Wrapper object `{items, total, page, pageSize}` is supported the same way (wrapper shape)
        - Empty array → items=[], total=0
        - null/undefined body → items=[], no crash
- `packages/ui-vue/tests/use-api-list.test.js`
    - useApiList — autoLoad + reload
        - autoLoad triggers first request
        - autoLoad=false skips initial load
        - reload() makes an additional request
    - useApiList — Pagination
        - goToPage(N) → page param changes
        - setPageSize(N) → jumps to page 1
        - goToPage(0) → clamps to page 1
    - useApiList — Filter
        - filter values as query params, empty values omitted
        - endpoint with query string → correct separator
    - useApiList — Auth + Error
        - the client's auth header reaches the request untouched
        - non-200 → error.value set, items.value empty
- `packages/ui-vue/tests/use-resource-list.test.js`
    - useResourceList — the first load
        - asks the descriptor’s endpoint, which no caller had to supply
        - does not block setup — nothing has loaded synchronously
        - immediate: false loads nothing until asked
        - an opening page size is one request, not two
        - an opening page size past the cap is capped, not sent
    - useResourceList — the pagination it owns
        - goToPage moves the request and the ref
        - setPageSize returns to the first page
        - a page off the scale is clamped before it is sent
        - a changed filter reloads from the first page
        - a filter mutated in place is seen too
    - useResourceList — what the rows and the count say
        - a reported total is the total
        - an unreported total falls back to the rows in hand
        - a bare array — what the tenants controller actually answers — is rows and count
    - useResourceList — the state it delegates
        - a failure arrives as an AdminError carrying the status
        - a failure empties the table rather than leaving stale rows under it
        - a superseded load does not overwrite the newer one
    - useResourceList — the page the server actually served
        - a clamped page is adopted, so the next request asks for what is shown
        - an overdue answer moves neither the rows nor the paginator
        - an answer that says nothing about the page leaves the asked-for one
    - useResourceList — the failures it refuses to swallow
        - an operation the resource does not have fails by name, listing what there is
        - an operation named after an Object prototype key does not exist either
        - no registry in scope says so, in the registry’s own words
        - a filter that claims the pagination fails where it is written
        - a filter that gains one later fails on the next load, without a word for the operator
        - an empty or absent pagination key in the filter is not a claim

<!-- END proof -->

### SC-UI-012 — The interface works on desktop, tablet and phone

🟢 Every header control stays inside the viewport from the narrowest supported width. Where space
runs out, labels are dropped before controls are — nothing a person can press is removed. No
screen pushes the page sideways, except where horizontal scrolling is a deliberate part of a
component such as a wide table.

_Source:_ internal engineering guidelines · release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/roster-primitives.test.ts`
    - AdminFieldGrid
        - the column count reaches the DOM, because the layout is CSS
        - a field carries its span, so one wide input can sit in a narrow grid
- `packages/ui-vue/tests/flex-direction-override.test.js`
    - a rule that changes flex-direction states its own main-axis alignment
        - the sweep found the stylesheets
        - no rule flips flex-direction while inheriting justify-content

<!-- END proof -->

### SC-UI-013 — A tenant-facing section can be embedded without adopting a UI framework

🟢 The plan section, the upgrade wizard and the add-on store render inside the integrator's own
application. For a developer evaluating SaaSiCat, "you also need this UI framework" is not a line
item on the decision — it is the end of it. A component that is a guest in somebody else's product
does not bring a framework with it.

_Source:_ ADR 0010 · #206

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/no-hardcoded-app-prefix.test.js`
    - Platform package: no hardcoded app URL prefixes
        - No composable/loader has `/api/(v1/)?{admin,billing}/...` as a default
    - Platform package: useTenants explicitly requires an endpoint
        - useTenants() WITHOUT the endpoint option throws with a clear error message
- `packages/ui-vue/tests/project-page-host.test.js`
    - createProjectPageHostRoute
        - returns a catch-all route with the ProjectPageHost component
        - path pattern can be overridden
        - does not match the empty /admin path so the dashboard redirect applies
    - ProjectPageHost — platform contract
        - exports SUPER_ADMIN_EXTENSIONS_KEY and SUPER_ADMIN_MANIFEST_KEY
        - ProjectPageHost is a defineComponent-compatible component
    - useSuperAdminManifest
        - returns null when no accessor was provided
        - returns the manifest value via a provided accessor
- `packages/ui-vue/tests/use-tenant-billing-url.test.js`
    - useTenantBilling URL construction
        - default apiPrefix is /billing (no /api prefix → no doubling)
        - custom apiPrefix /api/v1/billing is used 1:1 as sub-path (no /api adapter)
        - trailing slash in apiPrefix is normalized (no //billing)
        - plan preview, bundles and cancel all go under the same prefix
    - useTenantBillingCatalog URL construction
        - default apiPrefix is /billing — catalog endpoints land under
          /billing/{plans,bundles,feature-registry}
    - the rhythm a bundle is booked in reaches the wire
        - an explicit cycle is sent by both the preview and the booking
        - omitting it sends no field at all, so the plan’s rhythm decides
        - a minimum term still travels, alone or beside a cycle
- `packages/ui-vue-tenant/tests/component/tenant-primitives.test.ts`
    - the tenant button is a button
        - it renders a native button that does not submit
        - an accessible name from the call site lands on the button itself
        - a click listener from the call site reaches the button
        - the two axes are independent
    - a running button says so and stays readable
        - loading disables the button and marks it busy
        - the ring is added beside the label, not instead of it
        - a disabled button is not a busy one
    - the card primitives are one element each
        - %s renders its slot inside one classed element
    - the spinner respects a reduced-motion preference
        - the default animation turns
        - a reduce block replaces the turn for the spinner
- `tests/the-tenant-package-needs-no-quasar.test.js`
    - the tenant package needs no Quasar
        - there is a source tree to judge
        - no dependency field names it
        - the keywords do not advertise it
        - nothing in the source imports it
        - no template writes a Quasar component
        - no template writes a class Quasar defines

<!-- END proof -->

### SC-UI-014 — The administration brings its own UI framework

🟢 It is the application SaaSiCat hands over and it owns its own page, so the integrator installs one
package and nothing else — no framework, no build plugin, no stylesheet compiler. The framework's
own global stylesheet stays an import the integrator writes, because bundling it would mean they
could no longer decline it.

_Source:_ ADR 0011 · #207

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/theme-layer-discipline.test.js`
    - the token layers only point one way
        - the sweep reached all four layers
        - the sweep reached the inline styles too
        - the audit's Quasar palette is Quasar's
        - the audit's idea of a Quasar component is Quasar's
        - L1 primitives reference nothing
        - L2 roles contain no colour literal
        - L3 component sheets contain no colour literal
        - L3 component sheets do not reach past the roles into the palette
        - every font-size names a step of the type scale
        - the package does not use its own deprecation shims
        - a foreground role is never used as a background
        - surfaces that do not follow the theme use only roles that do not flip
        - pages and components do not reach past the roles into the palette
        - no rule paints --sa-color-accent as text on an accent surface
- `tests/a-generated-admin-imports-every-stylesheet.test.js`
    - every entry point imports the stylesheets the package publishes
        - the export map still publishes stylesheets
        - ${label} imports all of them
        - ${label} loads the theme after Quasar's stylesheet
        - ${label} takes them from this package, not from Quasar
- `tests/quasar-colours-resolve-to-the-theme.test.js`
    - quasar colours resolve to the theme
        - the sources actually paint Quasar colours
        - no page paints a Quasar palette rung the theme cannot move
        - every painted colour is one the platform decides
        - the neutral greys do not grow
        - every linked tone is a role the theme declares
    - the guides name the role the bridge actually reads
        - the guides show some overrides
        - every role the bridge links is one a guide tells you to override

<!-- END proof -->

### SC-UI-015 — One colour makes the administration look like the integrator's product

🟢 The brand colour is a single value passed at start-up and it moves everything that follows from
it. Asking an integrator to restate the status colours as well is how those drifted: a scaffolded
warning colour once sat at 2.15:1 beside a platform role painting 4.8:1.

_Source:_ ADR 0011 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/brand-colour-reaches-both-namespaces.test.ts`
    - the brand colour replaces $primary
        - it lands on the document element, not the body
        - an app that names no colour leaves the variable alone
        - the colour is also handed to the components as part of the brand
    - disposing gives the document back
        - a shell that set a colour removes it again
        - a host value marked !important keeps its priority
        - our own writes claim no priority of their own
        - a value the host set itself is put back, not deleted
        - a shell that named no colour touches nothing on the way out
    - the theme declares the link the option relies on
        - the accent role reads Quasar’s variable
    - the status tones follow the roles instead of being restated
        - the shell writes no status colour of its own
        - the theme hands Quasar the filled role, in both schemes
- `packages/ui-vue/tests/design-token-budget.test.js`
    - design-token budgets
        - the audit reaches the source tree
        - the inline-style sweep reads a fixture it cannot miss
        - a CSS-wide keyword is not a typographic value
        - a palette prop counts on a Quasar component and nowhere else
        - ${metric} does not grow (floor ${floor} — ${why})
        - ${metric} baseline has not overshot its floor
- `packages/ui-vue/tests/identity-accents-match-theme.test.js`
    - the identity ramp is one ramp
        - the resolver reaches a hex at all
        - both halves are the same length
        - every stored value is what its role resolves to in the light theme
        - the neutral matches too
    - the exemption cannot become a dumping ground
        - every hex in the file is one of the ramp values
    - a stored colour fits what the API accepts
        - ${label} is concrete, not a token reference
        - ${label} fits the promotion column
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
- `packages/ui-vue/tests/scaffolder-brand-defaults.test.js`
    - the visual fixture brands itself like a scaffolded app
        - both declarations are found
        - they are the same colour
        - the fixture declares no palette of its own
- `tests/quasar-colours-resolve-to-the-theme.test.js`
    - quasar colours resolve to the theme
        - the sources actually paint Quasar colours
        - no page paints a Quasar palette rung the theme cannot move
        - every painted colour is one the platform decides
        - the neutral greys do not grow
        - every linked tone is a role the theme declares
    - the guides name the role the bridge actually reads
        - the guides show some overrides
        - every role the bridge links is one a guide tells you to override
- `tests/token-audit-template-scan.test.js`
    - a colour written as paint is found
        - a static style attribute
        - a bound style with a literal fallback
        - an SVG paint attribute
        - a functional notation with literal channels
        - a named colour is a literal too
        - a named colour BARE in an SVG paint attribute
        - a named colour as a string inside a bound paint attribute
        - the two halves do not report the same colour twice
        - `color` inside SVG is paint
        - the namespace, not the tag name — a bare &lt;g&gt; is not SVG
        - `color` on the SVG elements a tag list forgets
        - every CSS named colour, not the obvious eighteen
        - a longer keyword is not read as the shorter one inside it
        - several literals in one binding
        - a literal nested deep in the tree
        - a literal AFTER a nested &lt;template&gt;
    - everything else a # means in a template stays silent
        - a hex in template TEXT is content, not paint
        - a pull-request number in an HTML comment
        - a slot shorthand that happens to spell a colour
        - an input mask
        - an anchor href
        - a Quasar `color` prop names a palette entry, not a colour
        - a var() is the goal, not a finding
        - a functional notation with a var() channel is a token in use
        - a binding that carries data rather than a literal
        - the SVG keywords that are not colours
        - a paint-server reference is an address, not a colour
        - a CSS function name is case-insensitive
        - a comment in a style attribute is prose, not paint
        - a colour beside a comment is still found
        - a modern colour function is a literal too
        - a named colour in any property that paints
        - a colour WORD where the property names something
        - a custom property holding a literal is NOT excused
        - an asset URL that spells a colour is an address
        - a hyphenated identifier that begins with a colour name
        - a colour function written in capitals
        - a real colour beside a paint-server reference is still found
        - a word that merely contains a colour name is not one
        - a dynamic directive argument does not throw
    - the other blocks belong to the other categories
        - a &lt;style&gt; block is not a template finding
        - a &lt;script&gt; block is not a template finding
    - null and empty mean different things
        - a file that is not an SFC is null, not empty
        - an SFC with no template at all is null
        - an SFC the parser cannot read is null, not empty
        - a template that parses and holds nothing is empty, not null
    - the line is the line the literal is on
        - a literal on the third line of the template
        - a binding spread over several lines points at the literal
    - blanking a string an expression only compares
        - the text keeps its length, so every offset still points where it did
        - a comparison between two literals is left alone
    - what the comparison blanking deliberately does not do
        - a path it cannot cross is kept, because it cannot tell
        - but a name inside another string is not a use of it
    - counting a name in an expression
        - a name is bounded by the alphabet it is written in
        - a trailing ! ends the name, and only `!.` carries it onwards
        - and the literal survives, because the class is rendered
    - the font shorthand hides three scales behind one property
        - a size, a weight or a leading in it is a literal
        - a tokenized shorthand is not
        - a number in the family name is a name, not a size
    - an inline style is a stylesheet fragment
        - a static style attribute is a fragment
        - several attributes, in template order
        - a bound :style is NOT a fragment
        - an attribute that is not `style` is not a fragment
        - null and empty still mean different things
        - a bound style that is one string literal is inline CSS too
        - the line is the line the attribute value starts on
    - a Quasar palette class is a colour decision
        - a static class list
        - a bound class list holds its literals as strings
        - a brand or status name, not only a palette hue
        - a two-word hue is read whole
        - a string the list COMPARES is not a class it renders
        - a name compared twice is still only compared
        - an optionally chained name is one name, not its last segment
        - and a name carrying a dollar sign is still one name
        - but a literal the comparison can render is kept
        - and grouping around the operand does not save it
        - the branch a comparison SELECTS is still a class
        - a class that merely ends in a palette word is not one
        - a rule ABOUT the class is not a use of it
        - blanking a compared string does not move the line after it
        - null and empty still mean different things
    - a Quasar palette prop is the same colour decision
        - a static prop
        - the two halves a component paints
        - a brand or status name, not only a hue
        - a bound prop holds its literals as strings
        - a string the binding COMPARES is not a palette name it emits
        - a binding that names nothing is not a finding
        - a nested object is configuration, not props
        - every prop that ends in -color on a Quasar component is one
        - the object form of v-bind is read like the arg form
        - a value outside the palette is not a palette finding
        - a two-word hue is read whole, with its shade
        - a value that merely begins with a palette word is not one
        - an attribute that is not a colour prop is not read
        - `color` inside SVG belongs to the paint category
        - the class form belongs to the class category
        - a comment in a binding is prose, not a palette
        - null and empty still mean different things
        - the line is the line the value sits on
    - the vocabulary is data, the pattern is the shape
        - a prop in palette shape but not in the palette is not counted
        - a rejected quoted word does not swallow the accepted one after it
        - named colours are ASCII case-insensitive, as CSS keywords are

<!-- END proof -->

### SC-UI-016 — Light and dark are both shipped, and a person can pick

🟢 Or follow whatever their system says. Two installations sharing one address do not inherit each
other's pick.

_Source:_ #137 · ADR 0009

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/theme-bootstrap.test.ts`
    - the bootstrap and an already-chosen theme
        - Quasar's configured dark mode survives the bootstrap
        - an explicit scheme still outranks what Quasar was set to
        - Quasar's configured LIGHT mode survives a dark machine
        - the machine still decides when Quasar says 'auto'
        - Quasar's 'auto' stays 'system' rather than freezing
        - with no dark configuration at all, the theme is left on system
        - Quasar's own toggle is carried back into the theme
        - the two directions do not chase each other
        - a 'system' pick survives the bridge's own round trip
        - Quasar's 'auto' comes back as 'system', not as a frozen value
        - a hard pick that agrees with the machine is still a pick
        - 'system' still follows the machine once the bridge has written to Quasar
        - dispose() stops the bridge writing to the document
- `packages/ui-vue/tests/component/theme-switcher.test.ts`
    - ThemeSwitcher visibility
        - renders when the shell provides a theme
        - renders nothing when the app opted out
        - a context from an older package version still shows it
        - a catalog from an older package version renders instead of throwing
    - ThemeSwitcher contents
        - the button names the active scheme
        - 'system' is named as itself, not as what it resolves to
        - an unknown active scheme falls back to its value instead of blanking
        - the accessible label comes from the catalog
        - all three schemes become menu entries
    - ThemeSwitcher selection
        - picking an entry writes the shared scheme
        - picking 'system' stores 'system' rather than what it resolves to
        - only the active entry carries the check mark
- `packages/ui-vue/tests/identity-accents-match-theme.test.js`
    - the identity ramp is one ramp
        - the resolver reaches a hex at all
        - both halves are the same length
        - every stored value is what its role resolves to in the light theme
        - the neutral matches too
    - the exemption cannot become a dumping ground
        - every hex in the file is one of the ramp values
    - a stored colour fits what the API accepts
        - ${label} is concrete, not a token reference
        - ${label} fits the promotion column
- `packages/ui-vue/tests/theme-reaches-every-page.test.js`
    - the theme reaches every page it ships
        - the reach markers are derivable from the stylesheets
        - a marker that exists only inside a comment does not count
        - every standard page renders a node inside that reach
- `packages/ui-vue/tests/theme-token-parity.test.js`
    - light and dark declare the same roles
        - the files were actually read
        - every light role has a dark counterpart, and the reverse
        - the theme fires only on a signal the application sent
        - no role is declared twice within one theme
- `packages/ui-vue/tests/use-sa-theme.test.js`
    - createSaTheme
        - defaults to 'system'
        - an explicit scheme resolves to itself
        - without matchMedia, 'system' resolves to light
        - 'system' follows the operating system, and keeps following it
        - an explicit pick outranks the operating system
        - the picked scheme is written to storage
        - a stored pick outranks the app default
        - a corrupt stored value falls back to the app default
        - persist: false neither reads nor writes storage
        - an app-supplied Ref is used as-is and is not persisted
        - dispose() ends the operating-system subscription
        - dispose() is idempotent and stops persisting
        - a stored pick does not overrule an app-supplied Ref
    - the switcher the theme offers
        - the switcher is on by default
        - an app can turn it off
        - a readonly scheme turns it off on its own
        - it offers exactly the three schemes, in a stable order
    - the persisted key
        - two apps on one origin can keep their picks apart
        - a prefixed app reads back its own pick, not the unprefixed one
        - the key itself is unchanged
    - useSaTheme
        - outside a shell it returns a shared, unpersisted instance
        - the injection key is a global symbol
- `tests/a-role-that-is-read-is-defined.test.js`
    - a role that is read is a role the theme defines
        - both sides of the comparison were actually read
        - the definitions reach the scale, not only the colours
        - the reads reach the two files the defect shipped in
        - no role is read that the theme leaves undefined
        - the rule is not vacuous: an undefined role is reported, with its line
        - and a role the theme defines is not reported
        - a fallback answers for the role it stands in for
        - a nested read is a read of its own
        - a role named in a comment is not a read
        - a comment above a read does not move its line
        - the import graph is followed, not guessed

<!-- END proof -->

### SC-UI-017 — A confirmation shows the answer to the question actually being asked

🟢 While a new answer is on its way, the previous one is not left on screen to be confirmed. A reader
could otherwise tick "I understand this happens on 1 January" and get something else, and the
screen and the invoice would describe different events.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/ui-confirm-port.test.ts`
    - quasarConfirmOptions
        - carries the wording the page wrote, not a generic "are you sure"
        - a destructive action is coloured as one
        - tone defaults to primary — only the caller may call something destructive
        - both buttons are labelled, so neither reads "OK"
        - no prompt means no input — a plain confirm stays plain
        - a prompt carries its initial value and type
        - a prompt with no initial value starts empty and takes text
    - useSuperAdminConfirm
        - an app-provided port is the one that gets asked
        - without one, the Quasar implementation is the fallback — which still asks
        - a context from an older package version still resolves, because the key is Symbol.for
- `packages/ui-vue/tests/use-dialog.test.js`
    - the dialog is announced as one
        - the panel carries the modal role and is named by its heading
    - focus enters and comes back
        - opening moves focus into the panel
        - closing puts focus back where it was
        - a trigger that is gone by then leaves focus at the document body
        - unmounting while open still gives the focus back
    - the trap keeps tab inside the panel
        - tab from the last control wraps to the first
        - shift+tab from the first control wraps to the last
        - shift+tab from the panel itself wraps to the last control
        - a tab from outside the panel is pulled back in
        - a panel with nothing tabbable keeps the caret on itself
    - escape and the backdrop
        - escape asks the caller to close
        - a persistent dialog ignores escape
        - a click on the backdrop closes, a click in the panel does not
        - a persistent dialog ignores the backdrop too
        - a closed dialog no longer answers escape
    - the page behind does not scroll
        - the lock is taken while open and given back on close
        - an inner dialog closing does not give the page back to the outer one
    - the panel can be teleported somewhere other than body
        - the default is body
        - a host that names a container gets it
- `packages/ui-vue-tenant/tests/component/tenant-dialogs.test.ts`
    - the dialog shell names itself
        - the panel is a modal named by its own heading
        - a persistent dialog still renders a way out
        - a closed dialog renders nothing at all
        - the close control asks the caller to close
    - the bundle preview reaches the shell
        - its title and the bundle label both reach the head
        - the footer confirm carries the action, and blockers disable it
        - while it loads, the ring is decoration and the sentence carries the news

<!-- END proof -->

### SC-UI-018 — Where two answers are outstanding, the current question's answer wins

🟢 Not the one that happens to arrive last. A slower response is not necessarily the older one, and
prices resolved against a plan the tenant has since left are not stale — they are about a
different question.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/ui-confirm-port.test.ts`
    - quasarConfirmOptions
        - carries the wording the page wrote, not a generic "are you sure"
        - a destructive action is coloured as one
        - tone defaults to primary — only the caller may call something destructive
        - both buttons are labelled, so neither reads "OK"
        - no prompt means no input — a plain confirm stays plain
        - a prompt carries its initial value and type
        - a prompt with no initial value starts empty and takes text
    - useSuperAdminConfirm
        - an app-provided port is the one that gets asked
        - without one, the Quasar implementation is the fallback — which still asks
        - a context from an older package version still resolves, because the key is Symbol.for
- `packages/ui-vue-tenant/tests/component/a-preview-in-flight-blocks-the-confirmation.test.ts`
    - while a replacement preview is on the wire
        - the answer to the abandoned question is taken off the screen
        - and the confirmation cannot be given
    - when the answers come back out of order
        - the outdated one does not install itself
- `packages/ui-vue-tenant/tests/component/the-latest-question-wins.test.ts`
    - only the current question commits its answer
        - a slower earlier answer does not overwrite a faster later one
        - answers in order still commit only the last
        - a single question commits, so the guard does not swallow the normal case
        - a superseded call resolves rather than hanging

<!-- END proof -->

### SC-UI-019 — A row that opens is a control

🟢 Operable from the keyboard, announced as expandable, and controls inside its header do not toggle
it on the way past. The page decides which row is open, so opening one can close another and load
what it needs.

_Source:_ #133 · `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/admin-accordion.test.ts`
    - the trigger is a control, not a div that listens
        - it is a button, and one that does not submit
        - aria-expanded says which state it is in
        - aria-controls names the body that is actually there
        - the body names the trigger back
        - two instances on ONE page do not share their ids
        - a disabled row is inert and says so
    - the page owns the state
        - the body is absent while closed, not merely hidden
        - a click asks for the opposite, and changes nothing by itself
        - an open row asks to close
    - a control in the header is not part of the trigger
        - it renders outside the button
        - clicking it does not toggle the row
        - nothing is rendered for it when the slot is unused
    - the badge is the component, the glyph is the page
        - the page supplies a glyph and the component supplies the frame
        - a row whose state the badge should report says so
        - no badge is drawn for a row that has no glyph
        - the badge sits inside the trigger, unlike the actions
- `packages/ui-vue/tests/component/disclosures-open-what-they-say.test.ts`
    - a promotion row opens its editor
        - the row is a button that says whether it is open
        - clicking one row opens that row, and only that one
        - clicking the open row closes it again
        - the timeline bar that opens the same row is a control too
    - the advanced section of the promo-code form opens
        - the toggle is a button that says whether it is open
        - the backend-only fields appear once it is open
        - the toggle asks its owner rather than deciding
    - the promotions tab is a reactive form, not a snapshot
        - an edit in the open editor reaches the update handler
    - a marketing row opens its editor from anywhere but its fields
        - the plan cell is the keyboard path, and says what it controls
        - a click on a cell that holds no control opens the row
        - a click on a field in the row does not
        - the handle moves the row with the arrow keys
        - the arrow keys stop at the ends of the list
        - a drag from the first row to the second reports that move
        - a drag downwards lands where the pointer is, not one row further
        - a twitch inside the dragged row is not a move
        - a drag upwards lands where the pointer is
        - a drag released where it started reports nothing
        - a row that cannot be written is not part of the order
        - a row without a live version has no handle
        - a focusable ancestor does not silence the row
        - the plan cell opens the row exactly once

<!-- END proof -->

### SC-UI-020 — A page never takes the whole screen down because data arrived in a shape it did not expect

🟢 A malformed payload leaves a page that says so, not a blank content area beside a working shell.

_Source:_ release 0.24.1

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/use-async-action.test.js`
    - useAsyncAction — the happy path
        - resolves what the action returned
        - passes every argument through
        - pending is true while in flight and false afterwards
        - runs onSuccess with the result, before run resolves
        - stays silent on success by default
        - notifyOn "both" raises the success message
        - a success message may be computed at call time
    - useAsyncAction — failure
        - reports the failure in the result instead of throwing
        - a void action is still distinguishable — the whole reason for the shape
        - records the failure as an AdminError
        - clears pending even when the action throws
        - skips onSuccess
        - reports through the notify port, worded from the default catalog
        - what the server said outranks the catalog
        - errorMessage outranks both, and sees the AdminError
        - notifyOn "none" records the error without announcing it
        - without a notify port the failure is still recorded
    - useAsyncAction — overlapping invocations
        - pending stays true until the last one settles
    - useAsyncAction — a stale failure does not outlive a newer success
        - the older call failing last leaves no error behind
        - but a failure from the newest call is still recorded
    - useAsyncAction — a report cannot change what happened
        - a success toast that throws leaves the action successful
        - a successMessage that throws does the same
        - an error toast that throws still returns the action failure
    - useAsyncAction — the success continuation
        - a failing continuation fails the action, and says so only once
        - a continuation that succeeds still gets its success toast
    - useAsyncAction — the error ref over time
        - a later success clears an earlier failure
        - reset clears it without running anything
- `packages/ui-vue/tests/use-async-data.test.js`
    - useAsyncData — loading
        - starts at the initial value
        - loads on creation by default
        - immediate: false loads nothing until asked
        - does not block setup — nothing has loaded synchronously
        - pending is true while in flight
    - useAsyncData — failure
        - records the failure as an AdminError
        - puts the data back to initial rather than leaving stale rows
        - reload does not throw
        - clears pending even when the load throws
        - a later success clears the error
    - useAsyncData — overlapping loads
        - a superseded load does not overwrite the newer one
        - a superseded load does not clear pending while the newer one runs
        - a superseded load that FAILS does not wipe the page or raise its error
    - useAsyncData — watch
        - reloads when a watched source changes
        - a watched source combines with immediate: false — the first load is the change

<!-- END proof -->

### SC-UI-021 — A campaign that worked looks like a success, not a fault

🟢 A fully redeemed promotional code is shown as spent, not in the colour reserved for errors.

_Source:_ release 1.0.0-rc.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/promo-code-tiles.test.ts`
    - promo code status tiles
        - count every row the tenant has
        - keep their counts when a tile narrows the table
        - keep their counts while the search narrows the table

<!-- END proof -->

## 16. Configuring and running an installation

Where a setting lives, what happens when it is missing, and what an operator can see about the
configuration that is actually running. The organising idea is that a setting has exactly one
home: a value that can come from two places is a value nobody can be sure of.

### SC-CFG-001 — A setting lives in exactly one place

🟢 Not in a file with a fallback in code, and not in a database with a file that seeds it. Both of
those are a single source of truth with a footnote.

_Source:_ #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-setting-comes-from-the-file.test.js`
    - the value the code runs on is the value in the file
        - the notice period reaches the token from the catalogue
        - the blocked plans reach their token from the catalogue
        - a second catalogue gives a second answer — nothing is baked in

<!-- END proof -->

### SC-CFG-002 — Settings with a money or a legal consequence live in the configuration file

🟢 Where a change goes through review and a deployment. For a value changed twice a year the
deployment is not friction — it is the review, and version control answers "who changed the notice
period, when, and why" better than an audit table does. Delivered for the notice period and the
self-service plan blocks; the settings still passed in code move in later steps.

_Source:_ #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-setting-comes-from-the-file.test.js`
    - the value the code runs on is the value in the file
        - the notice period reaches the token from the catalogue
        - the blocked plans reach their token from the catalogue
        - a second catalogue gives a second answer — nothing is baked in

<!-- END proof -->

### SC-CFG-016 — A setting that moved out of code is removed, not deprecated

🟢 An installation that still passes it in code does not start, and is told which file it belongs in.
Accepting it as a fallback would leave two homes, and ignoring it silently is worse still: the
value an operator set is the one they believe is running, so the application would not fail — it
would work, differently, until a customer's cancellation landed a period late.

_Source:_ #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-setting-comes-from-the-file.test.js`
    - an option that moved refuses the boot
        - ${option} is refused, and the message says where it went
        - both at once are named together, so the fix is one pass
        - an explicitly undefined option is not a passed option

<!-- END proof -->

### SC-CFG-017 — A required setting is required member by member, not as a block

🟢 A block naming only one of two rhythms is refused rather than read as zero for the other. The rule
that a silent default is an invisible decision does not stop at the outermost level of the
document.

_Source:_ #217

### SC-CFG-018 — An empty list and a zero are values an operator wrote, not omissions

🟢 "No plan is blocked from self-service" and "there is no notice period" are commercial statements,
and the file says them out loud rather than by leaving a line out.

_Source:_ #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-setting-comes-from-the-file.test.js`
    - a catalogue assembled in code without the section
        - names the field and the file rather than throwing a TypeError

<!-- END proof -->

### SC-CFG-019 — A migration tool reports a setting that moved; it does not delete it

🟢 The value is a term somebody agreed. Removing it from the code without writing it into the file
would leave the installation running on whatever the file happens to say — the failure the move
exists to prevent, committed by the tool meant to perform it. What makes reporting safe rather
than lax is [SC-CFG-016](#sc-cfg-016--a-setting-that-moved-out-of-code-is-removed-not-deprecated):
the boot refusal means the report cannot be acted on halfway.

_Source:_ #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/a-setting-is-reported-not-deleted.test.js`
    - what init says about the settings it wrote
        - every member is reported, flattened to the path it has in the file
        - an empty list reads as one, rather than as nothing at all
        - the report is read off the document, so it follows what the template writes
        - a catalogue the platform would refuse fails here, not at the first boot
    - names both, with the line each is on
    - the set is read off the schema, not written out beside it
    - every setting the schema names has a sentence saying where it goes
    - says where each one goes, separately
    - leaves the source untouched — there is nothing to write back
    - a longer identifier that merely contains the name is not reported
    - reads the value back as well as writing it — the same migration, later
    - a file that passes nothing produces no report at all
    - prose is not scanned — it cannot pass a module option
    - code is
    - a shorthand property is reported
    - a destructured read is reported
    - a mention in a comment is reported, and that is the chosen trade
    - several occurrences of one setting are all named, in file order
- `packages/nest/tests/a-setting-comes-from-the-file.test.js`
    - an option that moved refuses the boot
        - ${option} is refused, and the message says where it went
        - both at once are named together, so the fix is one pass
        - an explicitly undefined option is not a passed option

<!-- END proof -->

### SC-CFG-003 — A setting that must change without a deployment is kept out of the file entirely

🟢 And lives in one audited place instead of two. Adding a second home is what this rule exists to
prevent.

_Source:_ #217

### SC-CFG-004 — Payment credentials are never in a committed file and never in a table

🟢 They come from the environment.

_Source:_ #217

### SC-CFG-005 — A missing required setting stops the installation, naming the file and the field

🟢 A silent default is also a decision, just an invisible one.

_Source:_ #217 · `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/enforcement-chain-check.test.js`
    - the message names the true cause
        - the option, when the option is what unbound the guard
        - and the entitlement path, when the app never set it
        - both name the way out of what the check cannot see
- `packages/nest/tests/platform-configuration-rules.test.js`
    - the rule table
        - a sound configuration violates nothing
        - every rule has a distinct id, a message and a docs link
        - a rule that does not apply stays silent
    - the typed errors that predate the table
        - a lone capability failure still raises PersistenceCapabilityError
        - the same failure alongside another is reported as one of two
    - every rule can actually fail
        - every rule fails in at least one probe
        - ${rule.id} renders a message a reader can act on
        - the capability rule names both capabilities it is missing
- `packages/nest/tests/preflight.test.js`
    - formatPreflightReport
        - OK report contains OK checkmark
        - error report lists findings with codes

<!-- END proof -->

### SC-CFG-006 — A misconfigured installation is told everything that is wrong at once

🟢 Each problem named and linked to what it means. Fixing them is one restart, not one per line.

_Source:_ `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/default-doctor-checks.test.js`
    - PlanCatalogDoctorCheck
        - error when no plans
        - ok with plans + details contain planIds
    - DiscoverySnapshotDoctorCheck
        - warning when snapshot empty
        - ok with content
    - UserPortDoctorCheck
        - ok when findByEmail does not throw
        - error when findByEmail throws
    - AdminManifestDoctorCheck
        - ok with standardPages count
        - error when getManifest throws
    - PLATFORM_DOCTOR_CHECK_PROVIDERS
        - contains exactly 4 provider classes
- `packages/cli/tests/doctor-flow.test.js`
    - DoctorFlow.run
        - all checks ok → overall=ok, exitCode=0
        - one warning + ok → overall=warning, exitCode=0
        - one error → overall=error, exitCode=4
        - exception in check → severity=error with exception message
        - empty check list → overall=ok
    - DoctorFlow.formatReport
        - shows icons per severity
- `packages/nest/tests/enforcement-chain-check.test.js`
    - the message names the true cause
        - the option, when the option is what unbound the guard
        - and the entitlement path, when the app never set it
        - both name the way out of what the check cannot see
- `packages/nest/tests/platform-configuration-rules.test.js`
    - the rule table
        - a sound configuration violates nothing
        - every rule has a distinct id, a message and a docs link
        - a rule that does not apply stays silent
    - all of them at once
        - four independent mistakes are reported together
        - the error names every one of them, numbered, each with its link
        - one problem is still phrased as one
        - a message names which of a set is missing, not that some are
- `packages/nest/tests/preflight.test.js`
    - runPreflight
        - empty catalog → overall=ok, total=0
        - everything present → overall=ok
        - plan with unknown feature → overall=error, kind=plan
        - bundle with unknown feature → kind=bundle, BUNDLE_FEATURE_UNKNOWN
        - findings are deterministically sorted (kind, entityKey, version, code)

<!-- END proof -->

### SC-CFG-007 — A capability that is turned off says so, once, at start-up

🟢 A capability that vanishes without a word is indistinguishable from a bug in the integrator's own
code.

_Source:_ ADR 0007

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/enforcement-chain-warnings.test.js`
    - SaaSiCatModule.forRoot — enforcement-chain warnings
        - warns when no plan resolver and no fallback plan are configured
        - stays silent once defaultPlanId activates the static entitlement stack
        - registers the coverage check instead of warning on the option alone
        - stays silent on the default path with the guard bound
        - the inert branch registers the check too, with the state that says so

<!-- END proof -->

### SC-CFG-020 — A value in the configuration file may name an environment variable

🟢 Written as `${NAME}`, and resolved when the file is read — before the schema checks it, so a
variable standing in for a number is held to the same rule as a number typed into the file. The
resolved text is read as the type the field declares: `NOTICE_DAYS=14` is the integer 14, and a
build number stays a string where the field is one. It is what lets one file serve local development
and production, wired differently by the deployment rather than by a second file. A reference
inside a YAML flow collection has to be quoted; that is the parser's rule, not this one's.

_Source:_ #260

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-value-in-the-file-may-name-a-variable.test.js`
    - a reference is resolved before the schema looks, as the type the field declares
        - an integer field reads the variable as an integer
        - a number, a boolean and a string field each read it as their own type
        - a reference may sit inside a string and inside a list
        - a dollar sign that opens no well-formed reference is ordinary text
        - the schema still decides after the value is resolved
        - a document without a reference is untouched
    - the file the platform reads at boot
        - resolves against the process environment unless told otherwise

<!-- END proof -->

### SC-CFG-021 — A variable the file names and nothing sets stops the installation, naming both

🟢 The variable and the field, in one sentence, with the way out beside them — the default syntax
`${NAME:-value}`, which is the one exception: a reference that declares a default is satisfied by
it when the variable is unset or empty. Every missing variable is named at once rather than one
per restart.

_Source:_ #260

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-value-in-the-file-may-name-a-variable.test.js`
    - a variable nobody set
        - is refused with the variable and the field
        - every missing variable is named at once, not one per restart
        - a default declared in the file stands in for it
        - a set variable wins over the default
        - a variable set to nothing takes the default too
        - without a default, an empty variable is a value, and the schema judges it
        - a name the environment only inherits is not set

<!-- END proof -->

### SC-CFG-022 — A variable whose value does not fit the field is refused, not read as zero

🟢 💰 `monthly: ${NOTICE_DAYS}` with `NOTICE_DAYS=abc` does not become `NaN` and does not fall back to
`0`: it stops the installation, naming the variable, the text it resolved to, and the type the
field takes. That is the silent zero the move into the file exists to end, one level down. The
reading is strict — `1.5`, `1e3` and a leading space are not integers — because the text is what
somebody typed into a deployment, and a lenient reading is how a typo becomes a term.

_Source:_ #260

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-value-in-the-file-may-name-a-variable.test.js`
    - a value that does not fit the field
        - ${why} is refused for an integer field, and neither NaN nor zero gets through
        - a whole negative number is an integer — the schema then applies its minimum
        - digits enough to overflow are refused, not read as infinity
        - a number field refuses a comma decimal
        - a boolean field accepts only true and false
        - a variable cannot stand in for a whole list
        - a string carrying several references names all of them, not the first

<!-- END proof -->

### SC-CFG-023 — A variable whose name says it holds a credential may not be referenced from the file

🟢 🔒 A value the file resolves becomes part of the catalogue: shown on the login page, quoted in
validation errors, recorded as the applied configuration. A secret must not take that route, so a
reference to a variable named as one — `SECRET`, `TOKEN`, `PASSWORD`, a `PRIVATE_KEY` or an
`API_KEY` — is refused whether or not it is set, and the refusal does not quote the value.
Credentials stay in the environment and are read where they are used, which is what the
`…EnvVar` options carry: the name of a variable, not its value. Where the absolute stops: the
recognition is by name, since a value cannot be inspected for secrecy, so a credential under an
innocuous name passes this guard, and a key is refused only when a qualifier says what kind it is.

_Source:_ #260 · #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-value-in-the-file-may-name-a-variable.test.js`
    - a credential named in the file
        - \${${name}} is refused whether or not it is set
        - \${${name}} is an ordinary variable

<!-- END proof -->

### SC-CFG-024 — The environment is resolved only for the installation's own configuration file

🟢 🔒 A document that arrives another way — the catalogue import takes one over HTTP — has every
reference refused, with a sentence saying why. Resolving `${DATABASE_URL}` for whoever can post a
YAML body would hand them the server's environment one variable at a time.

_Source:_ #260

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-value-in-the-file-may-name-a-variable.test.js`
    - a document that did not come from the file
        - has every reference refused when no environment is given
        - the catalogue import gives none, so an upload cannot read the server environment

<!-- END proof -->

### SC-CFG-008 — An operator can see when the running configuration was applied, and from where

🟡 _(Decided, not yet delivered.)_ Somebody who edited the file an hour ago otherwise has no way to
tell whether it has landed. The timestamp is the requirement, not decoration.

_Source:_ #217 · #260

### SC-CFG-009 — A configuration change is noticed and reported

🟡 _(Decided, not yet delivered.)_ The record inside the application is unconditional; notifying
people by mail is an addition, never a substitute. An address list that silently swallowed the
notification because nobody wired mail would be worse than having neither.

_Source:_ #217 · #260

### SC-CFG-010 — An installation that declares a protection and enforces nothing does not start

🟢 Where routes are annotated as requiring a feature and nothing is checking it, the installation
refuses to boot and names the routes. Otherwise the routes answer, the limits read as unlimited,
and the first signal is a customer using something they never bought. A protection the integrator
wrote themselves counts, once they say it is one — recognition is by declaration, not by the class
being named the same as ours.

_Source:_ `docs/guides/upgrade-to-1.0.md` · release 0.27.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/enforcement-chain-check.test.js`
    - nothing can resolve a plan — the annotations are inert
        - refuses to boot when a route requires a feature
        - refuses to boot for a quota annotation too
        - a guard in front of the route does not make it enforceable
        - boots when no route is annotated at all
    - the platform bound its own guard
        - says nothing, whatever the routes look like
    - quotas are a second runtime, and the V3 path does not carry it
        - a quota route on the V3 path refuses the boot
        - the message names every way out, including the opt-out
        - a guarded quota route on the V3 path is refused too
        - a feature-only route on the V3 path still boots when it is guarded
        - and the static path with a plan resolver boots with quota routes
        - the inert case still speaks first, so its message is the one read
- `packages/nest/tests/enforcement-chain-refuses-boot.test.js`
    - an application whose enforcement chain is broken does not start
        - inert entitlement plus an annotated route: boot fails
        - globalFeatureGuard: false plus an unguarded annotated route: boot fails
    - an application whose chain is intact starts
        - globalFeatureGuard: false with the guard bound per route
        - the platform binding its own global guard
        - inert entitlement with nothing annotated — a catalogue-only app
        - the V3 entitlement path, with FeatureGuard bound per route
        - …but the same path with no feature guard at all does not
        - …and neither does the V3 path with a quota nothing counts
        - a quota route boots once something can resolve a plan
        - enforcementChainCheck: false is a way out that works
        - …and it turns off only that check
- `packages/nest/tests/platform-configuration-rules.test.js`
    - forRoot runs the table
        - the same configuration fails through the module
        - tenantManifest without plan resolution fails before anything is assembled

<!-- END proof -->

### SC-CFG-011 — An application that declares nothing to enforce still starts

🟢 A catalogue with no runtime enforcement is a real shape, not a mistake.

_Source:_ release 0.27.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/enforcement-chain-check.test.js`
    - globalFeatureGuard: false — the app binds its own
        - boots when every annotated route has a feature guard
        - refuses to boot and names the route when one is unguarded
        - is not fooled by a guard that merely shares the name
        - ignores helper methods that inherit a class-level requirement
        - reports an unrecognised wrapper rather than assuming it is safe
        - a quota-only route is not a guard question
- `packages/nest/tests/enforcement-chain-warnings.test.js`
    - SaaSiCatModule.forRoot — enforcement-chain warnings
        - warns when no plan resolver and no fallback plan are configured
        - stays silent once defaultPlanId activates the static entitlement stack
        - registers the coverage check instead of warning on the option alone
        - stays silent on the default path with the guard bound
        - the inert branch registers the check too, with the state that says so
- `packages/nest/tests/saasicat-module-escape-hatches.test.js`
    - globalFeatureGuard
        - defaults to binding StaticFeatureGuard as APP_GUARD
        - false removes the global APP_GUARD binding
        - false keeps the guard class available as a provider to bind manually
        - false does not disable the quota interceptor
- `packages/nest/tests/saasicat-module.test.js`
    - StaticEntitlementService (via StaticPlanResolver)
        - snapshot returns features+quotas from the plan catalog
        - hasFeature + quotaLimit as convenience methods
        - snapshot with an unresolved plan = empty set

<!-- END proof -->

### SC-CFG-012 — Conflicting routes stop the boot

🟢 Rather than one quietly shadowing the other and an operator discovering it from a support ticket.

_Source:_ `docs/guides/integrate-into-an-existing-app.md`

### SC-CFG-013 — A generated application does not compile until the integrator names their access rules

🟢 An empty list is this platform's word for "deliberately open", so scaffolding one would have left
the discovery and manifest endpoints answering to anybody.

_Source:_ release 0.27.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/init.test.js`
    - what gets written
        - the minimum is seven files, one of them a quota provider
        - each quota adds one provider, named after its key
        - --skip-hasher drops the hasher and keeps the persistence bundle
        - with a hasher the bundle wires it
        - no file goes out with an unsubstituted token
        - every template is reachable through some plan
    - the names it derives
        - a multi-word key still produces valid identifiers
        - the quota model becomes the Prisma delegate, not the model name
        - a quota without a model counts a delegate named after the key
        - the case helpers round-trip the shapes the plan relies on
    - the YAML it writes
        - quotas land under both plans, at different limits
        - there is no such thing as a plan without quotas
        - nothing has a trailing space
    - patching an existing app.module.ts
        - the admin module is registered, not merely imported
        - nothing is imported that the inserted code does not use
        - every symbol the block uses is imported
        - what was already in the array keeps its own line
        - the imports go after the last existing one
        - running it twice does nothing the second time
        - a file it cannot edit is declined, with the block to paste
        - a one-line decorator is declined, and the reason names the shape it wants
        - the limit filter is printed, not inserted
        - without persistence it comments the line instead of importing nothing
    - what the plan implies for the patch
        - a generated persistence bundle is an imported one
        - the admin module import path matches the file the plan writes
        - each quota provider import path matches its file
    - the auth guard the generator cannot know
        - the block names one, so the file does not compile without it
        - the block names the modules the platform resolves from, for the same reason
        - and says why, where the reader is
    - an app key the generated files would refuse
        - is refused before anything is planned
        - and a valid one still plans
        - the message carries the pattern rather than a paraphrase of it
    - the quota rules come from the schema, not from a copy of them
        - the quota key pattern is the schema's
        - the minimum number of quotas is the schema's
    - an app name a human would type
        - the classes get identifiers, the catalogue keeps the words
        - and the file names follow the identifier, not the label
        - every generated class name is a valid identifier
    - the file a quota provider is written to is the file that gets imported
        - for a camel-cased key, where the two used to disagree
        - and for every spelling the schema allows
    - a root module whose last import spans several lines
        - stays intact, and the new imports go after it
        - and a side-effect import is an import too, so nothing lands above it
- `packages/create-saasicat-admin/tests/scaffold.test.js`
    - parseArgs
        - positionals + flags + tokens are separated
    - applyTokens
        - replaces only tokens, passes other **X** strings through
    - walkTemplates
        - finds all .tpl files under templates/
    - scaffold
        - writes all templates into target + replaces tokens
        - dryRun writes nothing
    - bin entry point
        - runs through a bin symlink, as npm create / npx invoke it
- `tests/a-generated-admin-imports-every-stylesheet.test.js`
    - every entry point imports the stylesheets the package publishes
        - the export map still publishes stylesheets
        - ${label} imports all of them
        - ${label} loads the theme after Quasar's stylesheet
        - ${label} takes them from this package, not from Quasar
- `tests/templates-import-what-exists.test.js`
    - every ui-vue subpath a template or document names can be imported
        - the templates name some subpaths
        - each one resolves through the export map
        - and the file behind it is really there

<!-- END proof -->

### SC-CFG-014 — An installation whose own tables are named differently keeps its administration

🟢 The mapping is configuration, not a reason to turn the administration off wholesale.

_Source:_ release 0.27.0

### SC-CFG-015 — Set-up commands print what they wrote, with the values and the path

🟢 So the first thing a new integrator learns is where their settings live, rather than discovering
it when one is wrong.

_Source:_ #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/cli-commands.test.js`
    - the help text
        - names every command
        - and every `init` example it prints actually runs
        - an unknown command exits 1 rather than doing nothing
    - schema check
        - a model the app never adopted is reported, and is not an error
        - a field removed from an adopted model is drift, and exits 1
        - and says nothing is missing once the fragments are applied
        - a schema that does not exist is an error, not a stack trace
    - schema apply
        - appends the selected fragments and says which
        - the enums a fragment declares arrive with its models
        - running it twice appends nothing the second time
        - a fragment selector that matches nothing is refused
    - schema migrate
        - without --name it says so instead of guessing one
        - --dry-run stops before Prisma, and says that it did
    - init
        - scaffolds the wiring, patches the module, and names the next steps
        - refuses to overwrite what is already there
        - a tsconfig on the old moduleResolution is refused before any write
        - a moduleResolution inherited through extends is refused too
        - a key the generated files would refuse is refused here, before any write
        - without a key it says which flag is missing
        - --dry-run lists the files and writes none of them
    - codemod v1-imports
        - rewrites what moved and leaves the rest alone
        - names what no longer has a home rather than guessing one
        - --dry-run reports without writing
        - it does not walk into node_modules or dist
    - codemod v1-project-key
        - takes the key out of saas.yaml and the query, and reports the schema
        - is idempotent, like the other two
    - codemod v1-rename
        - rewrites the four kinds of name and leaves the rest alone
        - reports the token it cannot decide, and leaves it
        - --dry-run reports and writes nothing
        - the package rename reaches package.json, under its own indentation
        - a second run has nothing left to do
    - codemod v1
        - runs the import rewrite and the rename, in that order
- `packages/cli/tests/init.test.js`
    - what gets written
        - the minimum is seven files, one of them a quota provider
        - each quota adds one provider, named after its key
        - --skip-hasher drops the hasher and keeps the persistence bundle
        - with a hasher the bundle wires it
        - no file goes out with an unsubstituted token
        - every template is reachable through some plan
    - the names it derives
        - a multi-word key still produces valid identifiers
        - the quota model becomes the Prisma delegate, not the model name
        - a quota without a model counts a delegate named after the key
        - the case helpers round-trip the shapes the plan relies on
    - the YAML it writes
        - quotas land under both plans, at different limits
        - there is no such thing as a plan without quotas
        - nothing has a trailing space
    - patching an existing app.module.ts
        - the admin module is registered, not merely imported
        - nothing is imported that the inserted code does not use
        - every symbol the block uses is imported
        - what was already in the array keeps its own line
        - the imports go after the last existing one
        - running it twice does nothing the second time
        - a file it cannot edit is declined, with the block to paste
        - a one-line decorator is declined, and the reason names the shape it wants
        - the limit filter is printed, not inserted
        - without persistence it comments the line instead of importing nothing
    - what the plan implies for the patch
        - a generated persistence bundle is an imported one
        - the admin module import path matches the file the plan writes
        - each quota provider import path matches its file
    - the auth guard the generator cannot know
        - the block names one, so the file does not compile without it
        - the block names the modules the platform resolves from, for the same reason
        - and says why, where the reader is
    - an app key the generated files would refuse
        - is refused before anything is planned
        - and a valid one still plans
        - the message carries the pattern rather than a paraphrase of it
    - the quota rules come from the schema, not from a copy of them
        - the quota key pattern is the schema's
        - the minimum number of quotas is the schema's
    - an app name a human would type
        - the classes get identifiers, the catalogue keeps the words
        - and the file names follow the identifier, not the label
        - every generated class name is a valid identifier
    - the file a quota provider is written to is the file that gets imported
        - for a camel-cased key, where the two used to disagree
        - and for every spelling the schema allows
    - a root module whose last import spans several lines
        - stays intact, and the new imports go after it
        - and a side-effect import is an import too, so nothing lands above it

<!-- END proof -->

## 17. Accessibility

Accessibility is part of what SaaSiCat delivers, not a pass over it afterwards. The requirements
below are the ones a person actually notices: whether they can read the text, whether they can
reach the control, and whether the information survives being seen without colour. They apply in
both the light and the dark theme, because a screen that only works in one of them works for half
the people using it.

### SC-A11Y-001 — Text is legible in both themes

🟢 Contrast is measured on every shipped screen, in light and in dark. The floor is not a target: it
is the line below which text is not hard to read but gone.

_Source:_ `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/theme-bootstrap.test.ts`
    - the bootstrap and an already-chosen theme
        - Quasar's configured dark mode survives the bootstrap
        - an explicit scheme still outranks what Quasar was set to
        - Quasar's configured LIGHT mode survives a dark machine
        - the machine still decides when Quasar says 'auto'
        - Quasar's 'auto' stays 'system' rather than freezing
        - with no dark configuration at all, the theme is left on system
        - Quasar's own toggle is carried back into the theme
        - the two directions do not chase each other
        - a 'system' pick survives the bridge's own round trip
        - Quasar's 'auto' comes back as 'system', not as a frozen value
        - a hard pick that agrees with the machine is still a pick
        - 'system' still follows the machine once the bridge has written to Quasar
        - dispose() stops the bridge writing to the document
- `packages/ui-vue/tests/text-shape.test.js`
    - looksLikeEmail
        - accepts what the old pattern accepted
        - rejects what the old pattern rejected, and the shapes it got wrong
        - finishes on the input the pattern backtracked on
    - trimChar
        - strips a run of one character at either end and nothing inside
        - finishes on a long run
- `packages/ui-vue/tests/theme-role-contrast.test.js`
    - a role background and a role foreground stay readable together
        - the sweep found rules and can resolve the palette
        - gradient backgrounds are read, not skipped
        - nothing falls under ${CONTRAST_FLOOR}:1 in the ${themeName} theme
        - every pairing the ${themeName} sweep leaves unjudged says why
    - the identity chip stays readable on its own tint
        - the helper no longer hands back the bare accent as text
        - the resolver reaches real numbers for both input shapes
        - every colour the product itself stores clears ${CONTRAST_FLOOR}:1 in ${themeName}
        - no colour in sRGB falls under ${CONTRAST_FLOOR}:1 in ${themeName}
- `packages/ui-vue/tests/theme-token-parity.test.js`
    - light and dark declare the same roles
        - the files were actually read
        - every light role has a dark counterpart, and the reverse
        - the theme fires only on a signal the application sent
        - no role is declared twice within one theme
- `tests/a-role-that-is-read-is-defined.test.js`
    - a role that is read is a role the theme defines
        - both sides of the comparison were actually read
        - the definitions reach the scale, not only the colours
        - the reads reach the two files the defect shipped in
        - no role is read that the theme leaves undefined
        - the rule is not vacuous: an undefined role is reported, with its line
        - and a role the theme defines is not reported
        - a fallback answers for the role it stands in for
        - a nested read is a read of its own
        - a role named in a comment is not a read
        - a comment above a read does not move its line
        - the import graph is followed, not guessed
- `tests/filled-status-carries-white-text.test.js`
    - filled status surfaces carry white text
        - the base layer declares some
        - each resolves to a literal colour rather than another variable
        - white on each clears the floor
        - both themes declare them, with the same value
        - each theme hands the same four to Quasar, in its own block

<!-- END proof -->

### SC-A11Y-002 — Meaningful visuals stand out from what is next to them

🟢 Icons, control edges, status marks and chart elements are distinguishable from their surroundings
at no less than 3:1, and body text at no less than 4.5:1.

_Source:_ `docs/explanation/design-guide.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/theme-role-contrast.test.js`
    - a role background and a role foreground stay readable together
        - the sweep found rules and can resolve the palette
        - gradient backgrounds are read, not skipped
        - nothing falls under ${CONTRAST_FLOOR}:1 in the ${themeName} theme
        - every pairing the ${themeName} sweep leaves unjudged says why
    - the identity chip stays readable on its own tint
        - the helper no longer hands back the bare accent as text
        - the resolver reaches real numbers for both input shapes
        - every colour the product itself stores clears ${CONTRAST_FLOOR}:1 in ${themeName}
        - no colour in sRGB falls under ${CONTRAST_FLOOR}:1 in ${themeName}
- `tests/filled-status-carries-white-text.test.js`
    - filled status surfaces carry white text
        - the base layer declares some
        - each resolves to a literal colour rather than another variable
        - white on each clears the floor
        - both themes declare them, with the same value
        - each theme hands the same four to Quasar, in its own block

<!-- END proof -->

### SC-A11Y-003 — A colour used as a fill is not the same colour used as text

🟢 A status colour tuned to be read against the page goes lighter in the dark theme; the same value
used as a background with white text on it drops to 1.67:1. Each tone therefore has both roles,
and text on a filled surface stays legible in both themes.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/design-token-budget.test.js`
    - design-token budgets
        - the audit reaches the source tree
        - the inline-style sweep reads a fixture it cannot miss
        - a CSS-wide keyword is not a typographic value
        - a palette prop counts on a Quasar component and nowhere else
        - ${metric} does not grow (floor ${floor} — ${why})
        - ${metric} baseline has not overshot its floor

<!-- END proof -->

### SC-A11Y-004 — Every control can be reached and operated from the keyboard

🟢 A row that opens is a button, not an area that happens to respond to a click. Four of the eight
expandable surfaces this replaced could not be reached or announced at all, and a search for the
attribute that announces them returned nothing.

_Source:_ #133 · `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/disclosures-open-what-they-say.test.ts`
    - a promotion row opens its editor
        - the row is a button that says whether it is open
        - clicking one row opens that row, and only that one
        - clicking the open row closes it again
        - the timeline bar that opens the same row is a control too
    - the advanced section of the promo-code form opens
        - the toggle is a button that says whether it is open
        - the backend-only fields appear once it is open
        - the toggle asks its owner rather than deciding
    - the promotions tab is a reactive form, not a snapshot
        - an edit in the open editor reaches the update handler
    - a marketing row opens its editor from anywhere but its fields
        - the plan cell is the keyboard path, and says what it controls
        - a click on a cell that holds no control opens the row
        - a click on a field in the row does not
        - the handle moves the row with the arrow keys
        - the arrow keys stop at the ends of the list
        - a drag from the first row to the second reports that move
        - a drag downwards lands where the pointer is, not one row further
        - a twitch inside the dragged row is not a move
        - a drag upwards lands where the pointer is
        - a drag released where it started reports nothing
        - a row that cannot be written is not part of the order
        - a row without a live version has no handle
        - a focusable ancestor does not silence the row
        - the plan cell opens the row exactly once

<!-- END proof -->

### SC-A11Y-005 — Focus stays visible

🟢 An outline is never removed without something equivalent put in its place.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-006 — Information is never carried by colour alone

🟢 A state signalled by colour is also signalled by an icon, a label or a description.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/error-state-outranks-the-accent.test.ts`
    - the accent label yields to the error state
        - the stylesheet the theme has to outrank really parsed
        - a focused valid field still gets the accent label
        - a focused invalid field keeps its negative label
        - an invalid field that was never focused keeps it too
        - a list item has no error state for the sibling rule to trample

<!-- END proof -->

### SC-A11Y-007 — An icon that carries meaning has a name that can be announced

🟢 An icon is not text, and a control that is only an icon needs a label beside it or attached to it.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-008 — Each screen has one heading that names it, and every section is labelled

🟢 A section without a title is left unlabelled rather than given an empty name, because an unnamed
landmark is worse than none.

_Source:_ `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/admin-page-shell.test.ts`
    - AdminHero
        - renders the title as the page heading
        - omits the subtitle and the actions bar when neither is supplied
        - renders a markup subtitle through the slot
    - AdminSection
        - names the section by pointing aria-labelledby at its own heading
        - gives sibling sections distinct heading ids
        - renders no heading level above h2
    - page shell contract
        - the source sweep actually finds the pages it claims to check
        - AdminPage renders no &lt;main&gt; — the landmark belongs to AdminLayout
        - no content page renders its own &lt;main&gt; or a QPage
        - no content page hand-writes the hero markup instead of using AdminHero
        - AdminHero renders the only &lt;h1&gt; in the package
        - no view renders its hero inside the page body
        - no view hand-writes the reload button instead of using AdminRefreshBtn
        - no view writes its own table instead of using AdminTable
        - a component whose only job is to emit is never used without a listener
        - the actions column is filled through row-actions, not body-cell-actions
        - no page declares its own statistic tile styling
        - an unscoped page style reaches only its own sub-components
        - no page block titles itself with a heading-shaped &lt;div&gt;
        - no view writes its own disclosure instead of using AdminAccordion
    - the boundaries a page keeps
        - the sweep reaches the pages it claims to check
        - no page reaches for Quasar directly
        - no page redeclares the frame the theme draws
        - a page imports only from the layers below it
        - no primitive hard-codes a user-visible string
        - no file grows past the budget for its layer

<!-- END proof -->

### SC-A11Y-009 — Motion respects a person who has asked for less of it

🟢 Including the animations SaaSiCat draws itself rather than borrows.

_Source:_ #206

### SC-A11Y-010 — Wide content scrolls rather than being cut off

🟢 A table that does not fit is reachable sideways; it is not clipped at the edge of the screen.

_Source:_ release 0.24.2

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/wide-content-reaches-its-edge.test.js`
    - wide content reaches its edge rather than being cut off
        - every table either scrolls or is bound to its container

<!-- END proof -->

### SC-A11Y-011 — A dialog does not stack on top of itself

🟢 One overlay per screen, not one per row, so focus is never trapped behind something a person
cannot see.

_Source:_ release 1.0.0-rc.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/one-dialog-per-page-not-per-row.test.ts`
    - the one-time-password dialog is one dialog
        - the fixture renders several rows — without that this proves nothing
        - one instance exists, however many rows there are
- `packages/ui-vue/tests/use-dialog.test.js`
    - the dialog is announced as one
        - the panel carries the modal role and is named by its heading
    - focus enters and comes back
        - opening moves focus into the panel
        - closing puts focus back where it was
        - a trigger that is gone by then leaves focus at the document body
        - unmounting while open still gives the focus back
    - the trap keeps tab inside the panel
        - tab from the last control wraps to the first
        - shift+tab from the first control wraps to the last
        - shift+tab from the panel itself wraps to the last control
        - a tab from outside the panel is pulled back in
        - a panel with nothing tabbable keeps the caret on itself
    - escape and the backdrop
        - escape asks the caller to close
        - a persistent dialog ignores escape
        - a click on the backdrop closes, a click in the panel does not
        - a persistent dialog ignores the backdrop too
        - a closed dialog no longer answers escape
    - the page behind does not scroll
        - the lock is taken while open and given back on close
        - an inner dialog closing does not give the page back to the outer one
    - the panel can be teleported somewhere other than body
        - the default is body
        - a host that names a container gets it

<!-- END proof -->

### SC-A11Y-012 — Where a screen cannot meet the floor, the exception is named with its reason

🟢 And it stops being accepted once it no longer describes anything real.

_Source:_ `docs/explanation/design-guide.md`

## 18. Language and wording

Two audiences read SaaSiCat's text, and they are owed different things. A tenant reads it in the
language they chose. An integrating developer reads diagnostics, and those stay in one language on
purpose. This chapter also fixes what a refusal is: a code that does not change, and a wording
that may.

### SC-LANG-001 — A person reads the interface in the language they chose

🟢 They can change it from the shell, on the sign-in card and during first-run set-up, and the choice
is remembered and outranks whatever the installation configured.

_Source:_ #45 · #47 · release 0.16.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/locale-switcher.test.ts`
    - LocaleSwitcher visibility
        - renders when the app offers several languages
        - renders nothing when the app opted out
        - a context from an older package version still shows it
    - LocaleSwitcher contents
        - the button shows the active language by its own name
        - an app-supplied language is labelled from availableLocales
        - an unknown active locale falls back to its code instead of blanking
        - the accessible label comes from the catalog
        - every offered language becomes a menu entry
    - LocaleSwitcher selection
        - picking an entry writes the shared locale
        - only the active entry carries the check mark
- `packages/ui-vue/tests/i18n.test.js`
    - i18n locales
        - German is the default locale
        - every locale has a catalog, an Intl tag and a switcher label
        - isSaBuiltinLocale accepts shipped locales and rejects anything else
    - createSuperAdminI18n
        - defaults to the platform locale
        - switching the locale swaps the catalog and the Intl tag
        - the picked locale is written to storage
        - a stored pick outranks the app default
        - a corrupt stored value falls back to the app default
        - persist: false does not read the stored pick
        - persist: false does not write the picked locale
        - an app-supplied Ref is used as-is and outranks the stored pick
        - an app-supplied Ref is not persisted by the platform
    - switcher availability
        - enabled by default
        - switcher: false turns it off
        - a writable Ref keeps it on
        - a writable computed keeps it on
        - a readonly computed turns it off — writes would be swallowed
    - catalog completeness
        - English mirrors the German key structure exactly
        - no message is left empty in either locale
        - placeholders match between German and English
    - formatMessage
        - replaces named placeholders
        - leaves unknown placeholders verbatim
        - replaces every occurrence of the same placeholder
    - formatCurrency
        - German uses a decimal comma and dot grouping
        - English uses a decimal point and comma grouping
        - defaults to the platform locale
        - numeric strings are accepted
        - null, undefined and non-numeric input render as an em dash
        - zero is a real amount, not an empty value
    - mergeMessages / resolveMessages
        - overrides replace only the given leaves
        - keys absent from the base catalog are ignored
        - merging does not mutate the shared catalog
        - without overrides the shared catalog instance is returned
    - locale-aware navigation defaults
        - English labels and sections are the default
        - German locale switches labels and sections
        - explicit label overrides still win over the locale defaults
        - defaultSectionOrder matches the drawer order per locale
        - English sidebar groups under the English section order
    - createSaCatalog — the app owns the language set
        - ships German and English by default
        - an app can offer a single language
        - the offered order is the order given
        - a locale without a catalog is dropped instead of rendering blank
        - an empty selection falls back to everything available
        - an app-supplied language joins the switcher with its own name
        - a partial translation renders, filling gaps from basedOn
        - basedOn defaults to English rather than the reference locale
        - overrides apply to app-supplied languages too
        - has() answers for built-ins and app languages alike
        - resolution is cached — the same object comes back
    - createSuperAdminI18n — app-owned languages end to end
        - a single offered language hides the switcher
        - an app language can be selected and formats with its own tag
        - a stored pick the app no longer offers is ignored
        - an unknown active locale renders the default instead of blanking
        - storageKeyPrefix separates apps sharing one origin
    - helper modules reach app-supplied languages
        - discovery status labels follow an app language
        - relative-date wording follows an app language
        - bundle status labels follow an app language
        - untranslated keys in those namespaces fall back, not blank
        - overrides reach the same namespaces
- `packages/ui-vue-tenant/tests/component/tenant-i18n-provider.test.ts`
    - the tenant catalog reaches a child without a prop
        - an ancestor that provides is read by a grandchild
        - without a provider the shipped catalog fills in, so nothing renders blank
        - the provided catalog wins over the shipped one

<!-- END proof -->

### SC-LANG-002 — The admin interface falls back to English, the backend to German

🟢 Two answers to one question, and knowing which applies where matters: the shipped interface uses
English when nothing else is named, while several backend routes — registration and the public
price list among them — default to German. An installation that names its language everywhere
never meets the difference; one that relies on the default meets it as a screen in two languages.

_(Documented as it stands. One default for both belongs in a breaking change, because moving
either of them changes what an existing installation renders.)_

_Source:_ `docs/guides/upgrade-to-1.0.md` · current practice

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue-tenant/tests/component/tenant-i18n-provider.test.ts`
    - the tenant catalog reaches a child without a prop
        - an ancestor that provides is read by a grandchild
        - without a provider the shipped catalog fills in, so nothing renders blank
        - the provided catalog wins over the shipped one

<!-- END proof -->

### SC-LANG-003 — Which languages an application offers is the application's decision

🟢 SaaSiCat ships two complete ones and lets an installation narrow that set or add its own. A
language added by an installation is usable from its first translated key onwards, falling back
for the rest.

_Source:_ release 0.17.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/locale-switcher.test.ts`
    - LocaleSwitcher visibility
        - renders when the app offers several languages
        - renders nothing when the app opted out
        - a context from an older package version still shows it
    - LocaleSwitcher contents
        - the button shows the active language by its own name
        - an app-supplied language is labelled from availableLocales
        - an unknown active locale falls back to its code instead of blanking
        - the accessible label comes from the catalog
        - every offered language becomes a menu entry
    - LocaleSwitcher selection
        - picking an entry writes the shared locale
        - only the active entry carries the check mark

<!-- END proof -->

### SC-LANG-004 — A missing translation is never an empty line

🟢 Text a reader's own catalogue does not know falls back to the shipped English rather than
disappearing, and never to a bare internal code.

_Source:_ #243 · release 0.19.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/i18n.test.js`
    - i18n locales
        - German is the default locale
        - every locale has a catalog, an Intl tag and a switcher label
        - isSaBuiltinLocale accepts shipped locales and rejects anything else
    - createSuperAdminI18n
        - defaults to the platform locale
        - switching the locale swaps the catalog and the Intl tag
        - the picked locale is written to storage
        - a stored pick outranks the app default
        - a corrupt stored value falls back to the app default
        - persist: false does not read the stored pick
        - persist: false does not write the picked locale
        - an app-supplied Ref is used as-is and outranks the stored pick
        - an app-supplied Ref is not persisted by the platform
    - switcher availability
        - enabled by default
        - switcher: false turns it off
        - a writable Ref keeps it on
        - a writable computed keeps it on
        - a readonly computed turns it off — writes would be swallowed
    - catalog completeness
        - English mirrors the German key structure exactly
        - no message is left empty in either locale
        - placeholders match between German and English
    - formatMessage
        - replaces named placeholders
        - leaves unknown placeholders verbatim
        - replaces every occurrence of the same placeholder
    - formatCurrency
        - German uses a decimal comma and dot grouping
        - English uses a decimal point and comma grouping
        - defaults to the platform locale
        - numeric strings are accepted
        - null, undefined and non-numeric input render as an em dash
        - zero is a real amount, not an empty value
    - mergeMessages / resolveMessages
        - overrides replace only the given leaves
        - keys absent from the base catalog are ignored
        - merging does not mutate the shared catalog
        - without overrides the shared catalog instance is returned
    - locale-aware navigation defaults
        - English labels and sections are the default
        - German locale switches labels and sections
        - explicit label overrides still win over the locale defaults
        - defaultSectionOrder matches the drawer order per locale
        - English sidebar groups under the English section order
    - createSaCatalog — the app owns the language set
        - ships German and English by default
        - an app can offer a single language
        - the offered order is the order given
        - a locale without a catalog is dropped instead of rendering blank
        - an empty selection falls back to everything available
        - an app-supplied language joins the switcher with its own name
        - a partial translation renders, filling gaps from basedOn
        - basedOn defaults to English rather than the reference locale
        - overrides apply to app-supplied languages too
        - has() answers for built-ins and app languages alike
        - resolution is cached — the same object comes back
    - createSuperAdminI18n — app-owned languages end to end
        - a single offered language hides the switcher
        - an app language can be selected and formats with its own tag
        - a stored pick the app no longer offers is ignored
        - an unknown active locale renders the default instead of blanking
        - storageKeyPrefix separates apps sharing one origin
    - helper modules reach app-supplied languages
        - discovery status labels follow an app language
        - relative-date wording follows an app language
        - bundle status labels follow an app language
        - untranslated keys in those namespaces fall back, not blank
        - overrides reach the same namespaces

<!-- END proof -->

### SC-LANG-005 — Every string on a screen follows the language that was chosen

🟢 Including the ones assembled from parts. An installation that added a third language got a shell
in that language with thirty-four sentences stranded in another.

_Source:_ release 0.18.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/a-code-flag-follows-the-language.test.ts`
    - a code flag follows the language that was chosen
        - English reads English
        - German reads German
        - the flag a status raises follows it too
        - and so does the sentence for a feature with nothing behind it
- `packages/ui-vue/tests/i18n.test.js`
    - i18n locales
        - German is the default locale
        - every locale has a catalog, an Intl tag and a switcher label
        - isSaBuiltinLocale accepts shipped locales and rejects anything else
    - createSuperAdminI18n
        - defaults to the platform locale
        - switching the locale swaps the catalog and the Intl tag
        - the picked locale is written to storage
        - a stored pick outranks the app default
        - a corrupt stored value falls back to the app default
        - persist: false does not read the stored pick
        - persist: false does not write the picked locale
        - an app-supplied Ref is used as-is and outranks the stored pick
        - an app-supplied Ref is not persisted by the platform
    - switcher availability
        - enabled by default
        - switcher: false turns it off
        - a writable Ref keeps it on
        - a writable computed keeps it on
        - a readonly computed turns it off — writes would be swallowed
    - catalog completeness
        - English mirrors the German key structure exactly
        - no message is left empty in either locale
        - placeholders match between German and English
    - formatMessage
        - replaces named placeholders
        - leaves unknown placeholders verbatim
        - replaces every occurrence of the same placeholder
    - formatCurrency
        - German uses a decimal comma and dot grouping
        - English uses a decimal point and comma grouping
        - defaults to the platform locale
        - numeric strings are accepted
        - null, undefined and non-numeric input render as an em dash
        - zero is a real amount, not an empty value
    - mergeMessages / resolveMessages
        - overrides replace only the given leaves
        - keys absent from the base catalog are ignored
        - merging does not mutate the shared catalog
        - without overrides the shared catalog instance is returned
    - locale-aware navigation defaults
        - English labels and sections are the default
        - German locale switches labels and sections
        - explicit label overrides still win over the locale defaults
        - defaultSectionOrder matches the drawer order per locale
        - English sidebar groups under the English section order
    - createSaCatalog — the app owns the language set
        - ships German and English by default
        - an app can offer a single language
        - the offered order is the order given
        - a locale without a catalog is dropped instead of rendering blank
        - an empty selection falls back to everything available
        - an app-supplied language joins the switcher with its own name
        - a partial translation renders, filling gaps from basedOn
        - basedOn defaults to English rather than the reference locale
        - overrides apply to app-supplied languages too
        - has() answers for built-ins and app languages alike
        - resolution is cached — the same object comes back
    - createSuperAdminI18n — app-owned languages end to end
        - a single offered language hides the switcher
        - an app language can be selected and formats with its own tag
        - a stored pick the app no longer offers is ignored
        - an unknown active locale renders the default instead of blanking
        - storageKeyPrefix separates apps sharing one origin
    - helper modules reach app-supplied languages
        - discovery status labels follow an app language
        - relative-date wording follows an app language
        - bundle status labels follow an app language
        - untranslated keys in those namespaces fall back, not blank
        - overrides reach the same namespaces

<!-- END proof -->

### SC-LANG-006 — Text a customer reads carries its values beside its code, not inside a sentence

🟢 A sentence with the numbers baked into it cannot be rebuilt in another language by anyone
downstream. A tenant read "Current usage 11 exceeds the target limit 5" in English whatever
language they had chosen, and no integrator could reach it.

_Source:_ #243

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/error-params-contract.test.js`
    - error params contract
        - the sources contain coded throw sites at all
        - every throw site supplies the placeholders its message template names
        - all throw sites for one code agree on their params key names
- `packages/nest/tests/preview-issues-are-translatable.test.js`
    - a preview issue can be read in the reader’s language
        - the scan finds the codes at all
        - ${locale} has a text for every code the preview emits
        - every template names only values the issue carries
- `packages/ui-vue/tests/error-facts-are-declared.test.js`
    - the platform brand is on every class it decides for
        - there are error classes to look at — otherwise nothing below looks at anything
        - each status-carrying class calls markPlatformError(this)
        - the brands are counted independently, against a floor that moves with the sources
    - the empty-body sentinel is declared at its throw site
        - every status-0 platform error is marked as one
        - nothing else claims to be one
    - a seam whose answer can be "no body" first asks whether one arrived
        - the helpers are discoverable
        - each one calls requireServerAnswer before it reads a body
        - every file that raises the sentinel also runs the guard
- `packages/ui-vue-tenant/tests/component/a-blocker-speaks-the-apps-language.test.ts`
    - the blocker is read in the language the app chose
        - the shipped German catalogue renders the German sentence
        - the shipped English catalogue renders the English sentence
        - an app's own catalogue wins, in a language the platform does not ship
        - a code the app left untranslated still reads, from the shipped text
        - a code nobody has a text for falls back to the message the backend sent
- `packages/ui-vue-tenant/tests/component/message-parts.test.ts`
    - a message becomes parts
        - the substituted date is the emphasised one
        - other values are substituted without emphasis
        - a placeholder nobody supplied stays visible
        - an unclosed brace is left alone rather than eating the rest
        - a message without placeholders is one part
        - two dates are both emphasised

<!-- END proof -->

### SC-LANG-007 — A refusal code never encodes its own subject

🟢 The subject travels as a value beside the code. Building a code out of the quota or the plan it is
about made the set of codes grow with every quota an installation defines, so no catalogue of
translations could ever be complete.

_Source:_ #243

<!-- BEGIN proof -->

_Tested by:_

- `tests/a-refusal-code-is-a-constant.test.js`
    - a refusal code is a constant, not something built
        - there are shipped sources to look at
        - no shipped source assembles a code
        - the detector sees the shapes it was written for
        - and leaves alone the shapes that are not it

<!-- END proof -->

### SC-LANG-008 — A refusal is identified by a stable code; only its wording may change

🟢 The code is the contract. Renaming or removing one is a breaking change; rewording its text is
not, and which group a code is listed under is presentation only.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/error-messages.test.js`
    - shipped error messages
        - the code map carries the one code declared in another file
        - ${locale} has a text for every error code
        - ${locale} has no text for an unknown code
        - every locale interpolates the same placeholders per code
    - formatErrorMessage
        - substitutes named values
        - leaves an unknown placeholder visible rather than dropping it
        - treats null like a missing value
    - resolveErrorMessage
        - prefers the consumer override
        - falls back to the shipped default
        - falls back to the message when the code has no text
        - falls back to the code only when there is no message either
        - reads top-level body fields when a placeholder is not in params
        - params win over a top-level field of the same name
- `packages/nest/tests/error-params-contract.test.js`
    - error params contract
        - the sources contain coded throw sites at all
        - every throw site supplies the placeholders its message template names
        - all throw sites for one code agree on their params key names
- `packages/nest/tests/feature-guard.test.js`
    - StaticFeatureGuard — FEATURE_NOT_LICENSED body
        - emits the full FeatureNotLicensedBody with empty offers
- `packages/nest/tests/version-publish.test.js`
    - PublishValidationError
        - has name + code
- `tests/error-identity-across-entries.test.js`
    - AdminError across the CJS entries of @saasicat/ui-vue
        - the two entries really do hand out separate classes
        - instanceof does not survive the split
        - the brand does, and the error keeps everything it carried
        - a foreign error is still wrapped, so the brand is not a blanket pass
    - the declarations about a failure survive the split too
        - a transport failure marked through one entry is read back through the other
        - an empty response marked through one entry is read back through the other
        - an unmarked error is not mistaken for either

<!-- END proof -->

### SC-LANG-009 — An integrator resolves their own refusals and SaaSiCat's through one mechanism

🟢 An integrator's catalogue is mostly their own text, not a re-translation of the platform's, and
resolving both through one path is the reason the mechanism exists.

_Source:_ #244

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/preview-issues-are-translatable.test.js`
    - a preview issue can be read in the reader’s language
        - the scan finds the codes at all
        - ${locale} has a text for every code the preview emits
        - every template names only values the issue carries
- `packages/ui-vue-tenant/tests/component/a-blocker-speaks-the-apps-language.test.ts`
    - the blocker is read in the language the app chose
        - the shipped German catalogue renders the German sentence
        - the shipped English catalogue renders the English sentence
        - an app's own catalogue wins, in a language the platform does not ship
        - a code the app left untranslated still reads, from the shipped text
        - a code nobody has a text for falls back to the message the backend sent

<!-- END proof -->

### SC-LANG-010 — Diagnostics an integrator reads are English and are not translated

🟢 Boot failures, log lines and console messages are read by the person integrating SaaSiCat, and one
language is what makes them searchable. Translating them once put the platform's internal wording
on a tenant's screen instead of the catalogue's.

_Source:_ #150 · release 0.19.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/diagnostics-are-not-translated.test.js`
    - the diagnostics this package brands are not translated
        - the error classes are discoverable — otherwise nothing below looks at anything
        - no construction of one takes its message from the catalog
- `packages/ui-vue/tests/diagnostics-survive-the-locale.test.js`
    - the diagnostic of a failing seam does not depend on the UI language
        - ${name} says the same thing in German and in English
        - ${name} shows the operator the catalog's sentence, in their language

<!-- END proof -->

### SC-LANG-011 — Everything that ships is written in English

🟢 Code, comments, documentation, developer-facing errors, release notes and the command-line tools.

_Source:_ #150 · release 0.22.0

<!-- BEGIN proof -->

_Tested by:_

- `tests/what-ships-is-written-in-english.test.js`
    - what ships is written in English
        - there are shipped files to look at — otherwise nothing below looks at anything
        - none of them carries a German word
        - a catalogue declares itself, and only in its head
        - a catalogue is exempt in its values and read everywhere else
        - only Markdown may declare that it names the German it removes
        - the test tree and the published history are out of scope, the rest is in
        - the reader finds a German word wherever it stands, and only a whole one
        - a word that is also English is not on the list

<!-- END proof -->

### SC-LANG-012 — SaaSiCat carries no vocabulary from anybody's business

🟢 Shipped example text is neutral; an installation supplies its own wording for its own domain.

_Source:_ release 0.17.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-helpers.test.js`
    - slugify: the fallback carries no domain vocabulary
- `packages/ui-vue/tests/no-hardcoded-app-prefix.test.js`
    - Platform package: no hardcoded app URL prefixes
        - No composable/loader has `/api/(v1/)?{admin,billing}/...` as a default
    - Platform package: useTenants explicitly requires an endpoint
        - useTenants() WITHOUT the endpoint option throws with a clear error message

<!-- END proof -->

### SC-LANG-013 — A message says what to do next, not only what went wrong

🟢 A locked verification says to request a new code; a missing setting names the file and the field;
a refused booking names the plan and the rhythm it could not price.

_Source:_ `docs/reference/error-codes.md` · `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/error-messages.test.js`
    - shipped error messages
        - the code map carries the one code declared in another file
        - ${locale} has a text for every error code
        - ${locale} has no text for an unknown code
        - every locale interpolates the same placeholders per code
    - formatErrorMessage
        - substitutes named values
        - leaves an unknown placeholder visible rather than dropping it
        - treats null like a missing value
    - resolveErrorMessage
        - prefers the consumer override
        - falls back to the shipped default
        - falls back to the message when the code has no text
        - falls back to the code only when there is no message either
        - reads top-level body fields when a placeholder is not in params
        - params win over a top-level field of the same name
- `packages/ui-vue/tests/admin-error.test.js`
    - AdminError
        - defaults to status 0 — a request that never produced one
        - the diagnostic message names the request, the status and the code
        - the diagnostic carries the detail when there is one
        - an explicit message overrides the derived one
        - cause is preserved
    - isAdminError
        - recognises an instance
        - rejects a plain error, a look-alike object, and nothing at all
    - isEmptyResponse
        - recognises what a throw site marked, and nothing else
        - the marker is not enumerable, so it does not leak into a log line
    - isTransportFailure
        - recognises what a client marked, and nothing else
        - marking a non-object is a no-op rather than a second failure
        - the marker is not enumerable, so it does not leak into a log line
    - toAdminError
        - passes an AdminError through untouched
        - reads an axios rejection: status, code, body, url and method
        - a status-bearing error with an unreadable body has no detail at all
        - joins a NestJS ValidationPipe message array instead of stringifying it
        - reads one of the package’s own API errors, which carry status and body
        - an answer that was empty is not a connection problem
        - a consumer client rejecting with status 0 is not an empty response
        - a manifest 304 that survives to be thrown is a diagnostic like any other
        - a real HTTP failure is not an empty response
        - a declared transport failure keeps its diagnostic off detail, so the catalog answers
        - an axios failure with no response is transport too
        - but an interceptor’s own error is not, however much of axios it carries
        - but an error from app code keeps its message — that IS what was said
        - wraps a thrown string
        - survives a thrown nothing
    - a transport failure is declared by the client, not read off the class
        - a null dereference is not a connection problem
        - a real fetch failure still says "check your connection"
        - a malformed URL is a transport failure too, not an unknown one
        - the client passes a response through untouched
    - toAdminError and consumer errors
        - a consumer error carrying a status keeps its message
        - a consumer error merely NAMED like ours is still a consumer error
    - emptyResponse is read off the throw site, not off the class
        - a mutation the server answered without a body is an empty response
        - a boot GET a client resolved as status 0 never reached the server
        - a manifest GET a client resolved as status 0 never reached the server
        - nor did a mutation a client resolved as status 0 — on any of the surfaces
        - a discovery load a client resolved as status 0 never reached the server
    - toAdminError and rejections that are not Errors
        - a plain object keeps the message it carries
        - an Error from another realm is such an object
        - an object with nothing readable falls through to the generic wording
        - a non-string message is not a message
    - adminErrorMessage
        - what the failing side said outranks anything the platform could guess
        - maps the statuses that have their own wording
        - any other status falls through to the generic template, with the number in it
        - a failure nothing knows anything about says so, rather than blaming the network
        - a seam that declares the request never went out gets the network wording
        - converts before formatting, so an axios rejection needs no pre-processing
        - German is a complete alternative, not a fallback to English
    - HttpJsonError is AdminError
        - the two names are one class, so an existing instanceof check keeps working
    - getJson / postJson raise AdminError
        - a non-2xx carries status, code, detail, url and method
        - postJson reports its own method
        - an error body that is not JSON does not become a second failure
        - a validation rejection keeps its constraints — the array is joined here too
        - a 2xx still returns the parsed body
    - httpStatusOf reads the status whichever shape carries it
        - an AdminError carries it at `status`
        - an axios rejection carries it at `response.status`
        - anything else has none

<!-- END proof -->

## 19. Security and keeping tenants apart

The requirements here are stated from the tenant's side, because that is who bears the cost. Some
of them are things SaaSiCat does; several are things the installation has to do around it, and
those are stated as plainly as the rest, because a property that depends on a deployment is not a
property until the deployment provides it.

### SC-SEC-001 — A tenant never sees another tenant's data

🟢 🔒 Under no circumstances, and not because a screen filtered it out.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-tenant-subscription-write.test.js`
    - a write never reaches another tenant's row
        - a plan change asked for by a stranger changes nothing
        - a cancellation asked for by a stranger changes nothing

<!-- END proof -->

### SC-SEC-002 — Which tenant a request belongs to is derived from the authenticated session

🟢 🔒 Never from a value the caller supplied.

_Source:_ `docs/explanation/data-model.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/tenant-billing-controller.test.js`
    - the tenant is taken from the session, not from what the caller sent
    - and a session that names none is refused rather than falling back

<!-- END proof -->

### SC-SEC-003 — Reads that legitimately cross tenants are named as the exceptions they are

🟢 🔒 Platform-wide counts an operator needs are the documented exception; everything else is scoped.
Administration acts on behalf of the platform rather than of a tenant, which is why they are the
only reads that step outside a tenant's boundary.

_Source:_ `docs/explanation/data-model.md`

### SC-SEC-004 — Every decision that matters is made where the request is served

🟢 🔒 The interface hides what would be refused. It is not what does the refusing.

_Source:_ `docs/guides/build-the-admin-frontend.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-route.test.js`
    - SaaSiCat public route metadata
        - ${controller.name} is recognized by global auth guards
        - unmarked controllers stay protected

<!-- END proof -->

### SC-SEC-005 — Data arriving from outside is validated at the boundary

🟢 🔒 Requests, external systems and files are checked where they enter; code inside the boundary is
trusted.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/bundle-dtos-validate.test.js`
    - CreateBundleDto
        - accepts a complete bundle
        - requires the two identity fields
        - holds the key pattern
        - holds the lengths and the sort-order range
    - UpdateBundleDto
        - accepts an empty patch
        - clears a text field with null, and keeps the same limits
    - CreateBundleVersionDraftDto
        - accepts a complete draft
        - requires the feature list
        - holds the feature-key shape
        - holds the decimal shape, and lets null through
        - holds the date shape, and lets null through
    - UpdateBundleVersionDraftDto
        - accepts an empty patch and the same shapes as create
        - refuses what create refuses, field for field
- `packages/spec/tests/schemas.test.js`
    - adminManifestSchema compiles
    - planCatalogSchema compiles
    - promoCodeSchema compiles
    - auditEventSchema compiles
    - planCatalog accepts minimal valid catalog
    - promoCode CreatePromoCodeRequest accepts a typical PERCENT code
    - promoCode CreatePromoCodeRequest rejects lowercase code
    - auditEvent accepts minimal valid entry
    - auditEvent rejects lowercase action
    - adminManifest accepts minimal valid manifest
    - adminManifest rejects the removed planVersions standard page
    - adminManifest rejects capability with colon notation
    - every schema file is exported from both entry points
    - and the two entry points offer the same names
    - and the type shells name what the entry points export
    - tenantLedger accepts a charge carrying its period, origin and money facts
    - tenantLedger accepts a charge that names no contract
    - tenantLedger accepts a payment, which carries no period
    - tenantLedger accepts a payment on account, settling no named charge
    - tenantLedger rejects a charge without an origin
    - tenantLedger rejects an origin outside the catalogue of origins
    - tenantLedger rejects an empty originRef, which would not collide with itself
    - tenantLedger rejects a charge that names no period
    - tenantLedger rejects a payment without an external reference
    - tenantLedger rejects a payment whose external reference is empty
    - tenantLedger rejects an entry that is neither a charge nor a payment
    - tenantLedger rejects a charge wearing a payment field
    - tenantLedger rejects a payment that states a tax of its own
    - tenantLedger rejects a currency that is not an ISO 4217 code
    - tenantLedger rejects a tax rate above 100 per cent
    - tenantLedger accepts a credit, which is a negative charge
    - tenantLedger accepts an account with a balance, open items and history
    - tenantLedger rejects an account that does not say when its balance is true
- `packages/ui-vue/tests/component/payload-shapes-that-are-not-the-type.test.ts`
    - DiscoveryPage survives a snapshot that is not a snapshot
        - ${label} renders instead of throwing
        - the null case still shows the documented fallbacks
- `packages/ui-vue/tests/http-adapters.test.js`
    - createFetchHttpClient
        - passes a relative URL through unchanged when there is no base URL
        - prepends the base URL, without doubling the slash
        - leaves an absolute URL alone even with a base URL set
        - reads the headers hook per request, so a refreshed token is picked up
        - awaits an async headers hook
        - asks for JSON
        - an Accept the hook asked for is kept
        - a per-call header wins over the hook, whatever the casing
        - supplies a JSON content type for a body that arrived without one
        - does not invent a content type when there is no body
        - a non-2xx is a response, not a throw
        - response headers are readable under any casing
        - a failed request is marked as one, whichever way the client was built
        - defaultHttpClient is this client with no options
    - createAxiosHttpClient
        - strips the prefix the instance already carries as its baseURL
        - tries several prefixes in order, so the longer one is not shadowed
        - a prefix written with a trailing slash strips the same way
        - a query ends the path, so the prefix is still the prefix
        - a fragment ends it too
        - leaves a URL that does not start with the prefix alone
        - a URL that is exactly the prefix becomes the root, not the empty string
        - without stripPrefix the URL passes through whole
        - no status throws — 304, 402 and 500 all arrive as responses
        - the method is upper-cased and defaults to GET
        - a DELETE carries its body through
        - json() returns what axios already parsed
        - json() parses a raw string, for an instance with transformResponse disabled
        - every way of turning axios’s own decoding off is read as text
        - responseType json is the one that still means decoded
        - json() does not decode a second time what axios already decoded
        - a decoded string that reads as JSON keeps its meaning
        - json() throws on a raw body that is not JSON, exactly as Response.json() does
        - a body a decoding instance could not parse is the string it kept
        - an empty body throws whatever the instance decodes
        - a declared decoding instance hands an empty data over as the empty string
        - a declared raw instance still throws on an empty data
        - transformResponse null is a pipeline that ran nothing, so the body is raw
        - a config that merely omits transformResponse has not said anything
        - a response carrying no config is read as already decoded
        - text() gives a string either way
        - response headers are readable under any casing
        - a header that is not there reads as null, not undefined
        - survives an instance that reports no headers at all
        - request headers are handed to the instance untouched
    - createAxiosHttpClient — the instance keeps its own error handling
        - a rejection the instance recovers from never reaches the platform
        - a rejection it does not recover from arrives as a response, not a throw
        - a failure with no response stays a throw
        - a structural instance that says nothing is not marked for it
        - …and the way out is the one the fetch adapter uses
        - no validateStatus is imposed on the instance
    - the adapters satisfy what the platform loaders expect
        - a 304 with an ETag is usable by the manifest loader’s cache path
        - a 204 arrives as a status the caller can check before reading a body
    - createAxiosHttpClient — against a real axios instance
        - json() yields what was on the wire, however the instance is configured
        - json() yields what was on the wire when the instance declares how
        - a rejected status is read by the same declaration
        - an instance with its own transform is read as decoding until it says otherwise
        - an empty body throws, whichever instance asked for it
        - an instance that hands the body over reads `""` as the empty string
        - a declaration recovers `""` from an instance that already decoded it
        - `""` is the one body a decoding instance under `auto` cannot get back
        - a body no one could decode is the text it was, where axios kept it
        - a rejected status arrives as a response with its body readable
        - the prefix an instance carries as its baseURL is stripped back off
        - a browser Blob body is read through the text() it exposes
        - what an interceptor rewrites, the adapter can no longer judge
        - a body axios delivered as bytes reads as the value those bytes spell
        - and the two readers of a byte body agree about it
        - an empty byte body throws, as an empty text body does
        - a streamed body is refused by name, not mishandled
        - a transform returning an object still hands that object over
    - createAxiosHttpClient — the transport brand, against real axios
        - a genuine network failure is marked
        - a DNS failure and a timeout are the same fact and are marked too
        - a network failure a rejection interceptor rethrows is still marked
        - an interceptor's replacement error keeps its message
        - …including when it carries axios’s config across, which is the shape that fooled the old
          reading
        - …and when it carries `request` too, which is why `isAxiosError` is read
        - an interceptor rejecting with another request’s failure is that request’s answer
        - a failure while setting the request up keeps its own words
        - a request interceptor that throws is not a transport failure
        - an answered status never reaches the brand at all
        - the reading holds on its own, not only where the adapter calls it

<!-- END proof -->

### SC-SEC-006 — An installation must terminate traffic at a proxy it controls

🟢 🔒 Rate limits identify a caller from a header a client can set. Without a proxy that overwrites
it, an attacker rotates identities and defeats every limit on sign-in, registration, code resends
and promotional codes.

_Source:_ `SECURITY.md`

### SC-SEC-007 — Rate limits are per process and reset on restart

🟢 🔒 An installation running several instances multiplies every limit it configured. They are a
throttle, not a lockout, and an installation that needs the stronger property provides it itself.

_Source:_ `SECURITY.md`

### SC-SEC-008 — The setup token is a bootstrap secret and is removed once bootstrapping is done

🟢 🔒 Anyone holding it before the first administrator exists can take the installation over.

_Source:_ `SECURITY.md`

### SC-SEC-009 — Checks run in a fixed order and fail closed

🟢 🔒 A check that expects an authenticated caller refuses rather than passing when the step before it
did not run.

_Source:_ `SECURITY.md`

### SC-SEC-010 — A vulnerability is reported privately and never described in public

🟢 🔒 Not in an issue, a pull request, a commit message or a release note. A fix may still be
published; its description must not double as instructions.

_Source:_ `SECURITY.md`

### SC-SEC-011 — Security fixes go to the newest release line, and all packages move together

🟢 🔒

_Source:_ `SECURITY.md`

### SC-SEC-012 — A new dependency's licence is part of the decision to add it

🟢 A copyleft dependency would conflict with the terms SaaSiCat is distributed under, and the
conflict is only discoverable by reading. Where it is unclear, it is raised rather than added.

_Source:_ ADR 0001

## 20. What is kept, and what is never written down

Two questions a tenant and an operator both eventually ask: what does this system record about me,
and what does it throw away. The requirements below answer them, and one of them constrains
SaaSiCat itself — a record that survives has to be one that is safe to keep.

### SC-PRIV-001 — Nothing that could cause harm is written to a log

🟢 🔒 No passwords, tokens, keys, session secrets or complete sensitive payloads, and no personal data
beyond what a diagnosis needs. A production failure needs context, not secrets.

_Source:_ internal engineering guidelines

### SC-PRIV-002 — A network address is recorded as a fingerprint, never in the clear

🟢 🔒 In the anti-abuse trail and in the record of registration steps alike.

_Source:_ release 1.0.0-rc.7

### SC-PRIV-003 — Passwords and verification codes cannot be read back out of storage

🟢 🔒

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-helpers.test.js`
    - verifyOtpCode returns false on a broken hash (no throw)
- `packages/nest/tests/registration-service.test.js`
    - start() stores OTP only as a hash, never in plaintext

<!-- END proof -->

### SC-PRIV-004 — The record of a registration carries no address, password or code in the clear

🟢 🔒 Recording the address would make the trail itself a way to find out who has an account.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() stores OTP only as a hash, never in plaintext

<!-- END proof -->

### SC-PRIV-005 — Payment details are kept masked

🟢 🔒 SaaSiCat records how a tenant would pay, not enough to pay as them.

_Source:_ `docs/explanation/data-model.md`

### SC-PRIV-006 — A record that history depends on is retired, not deleted

🟢 🔒 Plans, add-ons, promotional codes and catalogue entries are withdrawn from use and kept. Only an
unpublished draft is removed outright.

_Source:_ `docs/explanation/data-model.md`

### SC-PRIV-007 — An abandoned registration is removed rather than kept in a reduced form

🟢 🔒 The address it holds is exactly the thing that has to become usable again.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - runCleanup() deletes expired, leaves active alone
    - runCleanup() frees the email again after deletion → repeated start() works

<!-- END proof -->

### SC-PRIV-008 — Failed attempts are part of the record, not only successful ones

🟢 🔒

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - audit: verifyOtp success → OTP_VERIFIED, wrong → OTP_VERIFY_FAILED

<!-- END proof -->

### SC-PRIV-009 — A migration that would destroy data stops and says what it found

🟢 🔒 Rather than merging rows nobody meant to merge, or discarding them. Which of two colliding
records survives is not a decision a migration takes on its own.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a migration that would merge rows stops instead
        - two project keys stop it, and the message names them
        - and the installation is exactly as it was afterwards
        - and the installation is exactly as it was afterwards

<!-- END proof -->

### SC-PRIV-010 — History is not rewritten

🟢 🔒 A period a tenant was already billed for is left as it stands, even by a correction that would
otherwise be tidier. Rewriting it changes what the record says happened.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

## 21. Answering the question afterwards

Prices change, plans are republished, entitlements move. This chapter is about being able to
answer, months later, what was true at a particular moment and who made it so. It is what turns a
dispute into a lookup.

### SC-AUD-001 — Every administrative action records who did it, from where, and when

🟢 Including actions taken from a command line rather than a browser, in a form that says which of
the two it was.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - AdminAuditService
        - actorTag formats source:email:context
        - log() writes through and appends the actor tag to changes
        - fromWebRequest builds AdminActor with source=web
        - fromWebRequest falls back to "unknown" when there is no session
        - fromCli builds AdminActor with source=cli + hostname
- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding writes an audit log with COMPLETE_ONBOARDING_SUBSCRIPTION
- `packages/nest/tests/registration-service.test.js`
    - audit: start() logs REGISTRATION_STARTED + pendingId
    - audit: verifyOtp success → OTP_VERIFIED, wrong → OTP_VERIFY_FAILED
    - audit: handlePaymentEvent → PAYMENT_RECEIVED + ACTIVATION_COMPLETED, duplicate →
      PAYMENT_DUPLICATE_IGNORED

<!-- END proof -->

### SC-AUD-002 — An action that belongs to no single tenant says so

🟢 Platform-wide acts are distinguishable from acts on one tenant, rather than looking like an entry
whose tenant went missing. An action nobody triggered — a scheduled job — is likewise
distinguishable from one a person took.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-adapters.test.js`
    - PrismaAuditAdapter
        - write maps actor to userId + actorTag on audit_logs

<!-- END proof -->

### SC-AUD-003 — Every change to a subscription is recorded with what it was before and after

🟢 Plan changes, scheduled changes, activations, accepted versions and cancellations.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscription-change-is-recorded-before-and-after.test.js`
    - a plan change is recorded with what it was before and after
        - the entry names the plan and cycle on both sides of the change
        - the before is read from the subscription, not echoed from the request

<!-- END proof -->

### SC-AUD-004 — A failure to record something never blocks the act itself

🟢 A gap in the record is better than an outage for the tenant. Where no recording is configured at
all, the platform skips it rather than failing — a deliberate degradation for the smallest
installations.

_Source:_ release 1.0.0-rc.6

### SC-AUD-005 — Serious actions are marked as serious

🟢 Suspending a tenant, acting as one, publishing or ending a plan version, cancelling a
subscription, deactivating a user and handing over administrative rights are all findable as the
weighty acts they are.

_Source:_ release 1.0.0-rc.6

### SC-AUD-006 — The record can be searched by who, what, which object and since when

🟢 And it hands back a bounded page rather than everything at once.

_Source:_ release 1.0.0-rc.0

### SC-AUD-007 — What a customer bought is frozen at purchase

🟢 A plan change creates a new agreement and keeps the old one. Nothing rewrites what was agreed.

_Source:_ `docs/explanation/concepts.md` · `docs/explanation/capability-to-contract.md`

### SC-AUD-008 — A published version stays readable for as long as anything references it

🟢 So the question "what did this customer actually buy" always has an answer.

_Source:_ `docs/explanation/data-model.md`

### SC-AUD-009 — What a promotional code promised at redemption stays with the redemption

🟢

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - what a code promised at redemption stays with the redemption
        - the redemption records the terms, not a pointer to them
        - and editing the code afterwards does not rewrite them

<!-- END proof -->

### SC-AUD-010 — A charge names where it came from and which agreement line it belongs to

🟡 _(Decided, not yet delivered.)_ Activation, renewal, a prorated plan change, an add-on booking, a
credit — so an account can be walked back to what was agreed.

_Source:_ #214

### SC-AUD-011 — A charge carries the period it belongs to

🟡 _(Decided, not yet delivered.)_ Which charges belong on one invoice has to be derivable, and a set
of individually booked amounts with no grouping leaves that to guesswork.

_Source:_ #214

## 22. Repeating an operation safely

Deployments fail and get retried; containers restart; a pipeline step is run again. This chapter
is written from the operator's side and says what they can repeat without holding their breath.
The requirement behind all of it: SaaSiCat keeps no ledger of which migrations have run, so every
one of them has to be safe to run twice.

### SC-OPS-001 — An operator can retry a failed deployment

🟢 Every shipped migration applied a second time either does nothing, or refuses with a sentence
saying why. Never an unexplained database error, and never a second application of the same
effect. This exists because it happened: a migration dropped a column, the next container start
asked that column for its values, and the message named the column rather than the retry.

_Source:_ `CONTRIBUTING.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/a-booking-outlives-the-request.integration.test.js`
    - what a booking carries
        - a booking with a window keeps every part of it
        - a booking from before those columns keeps null, not an invented window
        - an id nobody booked answers null rather than throwing
        - the list is the subscription’s own, not the neighbour’s
        - a subscription with no bookings lists nothing, rather than everything
    - what counts as active
        - a booking nobody cancelled is active
        - a cancellation still ahead leaves it active
        - a cancellation that has landed ends it
        - the effective date itself is the first moment it is over
        - asking without a moment asks about now
    - undoing a cancellation
        - reactivating clears both dates and the booking is active again
        - cancelling something that is not there says so, rather than doing nothing quietly
        - reactivating something that is not there says so too
    - counting what a catalogue version still owes
        - active bookings of that version are counted, across subscriptions
        - a different version is not counted
        - a booking whose cancellation has landed is not counted
        - a version nobody booked counts zero
- `packages/nest/tests/registration-service.test.js`
    - handlePaymentEvent() duplicate webhook → ALREADY_PROCESSED + no second activation
    - runCleanup() without expired → deleted=0, idempotent

<!-- END proof -->

### SC-OPS-002 — A migration is safe on a partially adopted schema

🟢 An installation that never took a particular table migrates the ones it does have, instead of
rolling the whole thing back.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/migration-constraints.test.js`
    - which migration the constraints belong to
        - the one that appeared between the two listings
        - nothing new means nothing to append to, even with migrations present
        - directories that are not migrations are not candidates
        - the newest of several, when a run somehow produced two
        - no migrations at all is not an error, it is nothing to do
    - appending them
        - the statements land after the tables
        - it says where the copy came from
        - running it twice appends once
        - a migration that already has them is recognised
        - a migration without a trailing newline still gets a separating one
    - only the constraints this schema has tables for
        - reads the table off each statement
        - keeps the ones whose table is present
        - keeps everything when every table is present
        - a statement it cannot read is kept, not dropped
        - nothing applicable appends nothing at all
    - what step 3 did, and whether step 4 may follow
        - only a failure stops the command
        - "before applying" is said exactly when the command will not apply
        - a failure says where the SQL is, because the operator now needs it
        - nothing to append is not a failure
        - every outcome carries a message and a decision
- `packages/cli/tests/schema-apply-dry-run.test.js`
    - the dry run previews what the real run writes
        - it names the lines, and leaves the file untouched
        - and the real run writes exactly those lines
        - past tense belongs to the run that did it
- `packages/cli/tests/schema-apply.test.js`
    - extractModelNames
        - finds top-level models
    - ignores commented-out models
    - does not find enum blocks
    - a fragment yields its enums and its models
    - apply appends the enum above the model, once
    - an enum the consumer already declares is left alone
    - a bare model map still works, with no enums
    - extractModelBlocks
        - block stays complete with all lines
    - applyFragmentBlocks
        - adds all models when schema is empty of platform models
        - idempotent: existing models remain untouched
        - returns identical schema when all models already present
        - label appears in the header comment
- `packages/cli/tests/schema-check.test.js`
    - parseFields
        - reads name, type and modifiers, skips attributes and comments
    - reads single-line model blocks
    - identical attributes produce no finding
    - a missing index is reported but does not fail the check
    - a missing unique constraint fails the check
    - a diverging @@map fails the check and names both sides
    - whitespace and attribute options do not create false findings
    - extra consumer indexes are not reported
    - parseEnumValues
        - reads members and ignores attributes
        - reads members sharing one line
    - parseSchema
        - separates models from enums
        - commented-out relations are not fields
    - checkSchema
        - identical schema has no drift
        - consumer extensions are not drift
        - missing field in an adopted model fails
        - absent model is informational, not a failure
        - missing enum value in an adopted enum fails
        - absent enum is informational, not a failure
        - type change is a mismatch
        - String replaced by a locally declared enum is allowed
        - String[] replaced by a local enum list is allowed
        - a non-String spec type is not substitutable by an enum
        - a consumer widening a required field to nullable is a mismatch
        - a consumer tightening a nullable field to required is allowed
        - list change is a mismatch
    - parser hardening (review findings)
        - a commented-out @@unique or @@map counts as absent, not present
        - a brace inside a string default does not close the model early
        - a // inside a string literal is not treated as a comment
        - indexed field arguments are parsed past their parentheses
        - @@map survives the comment strip
    - blankStringLiterals
        - blanks contents, keeps quotes and length
        - handles escaped quotes without leaving the string early
        - leaves a line without strings untouched
        - is linear on pathological input
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a shipped migration survives a second run
        - there are migrations to check
        - ${name} runs twice, and the second time changes nothing
    - a migration that would merge rows stops instead
        - two project keys stop it, and the message names them
        - and the installation is exactly as it was afterwards
        - one project key goes through
    - a line item learns the money it was booked with
        - the values come from the contract the line belongs to
        - and the columns come out of it required, so nothing can be written without them
        - a second run leaves the values the first one wrote
        - a contract with ${what} stops the migration and is named
        - and the table is exactly as it was afterwards
        - a rate no reading brings inside 0-100 stops the migration and is named
        - a free plan frozen from the catalogue keeps its rate as it stands
        - and a free plan concluded from an offer keeps its rate as the fraction it is
        - a rate a checkout offer stated as a fraction is recorded in per cent
        - a value already in a column is kept, and a row missing only one is still found
        - an installation that never took the fragment is left alone
        - a line whose contract is gone is named as itself, not as an empty space
        - the query the guide ships finds exactly what the migration refuses
        - a contract that records both goes through

<!-- END proof -->

### SC-OPS-003 — An operator can list what a migration will touch before running it

🟢 Every migration that changes rows ships with the query that shows which ones.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/schema-apply.test.js`
    - extractModelNames
        - finds top-level models
    - ignores commented-out models
    - does not find enum blocks
    - a fragment yields its enums and its models
    - apply appends the enum above the model, once
    - an enum the consumer already declares is left alone
    - a bare model map still works, with no enums
    - extractModelBlocks
        - block stays complete with all lines
    - applyFragmentBlocks
        - adds all models when schema is empty of platform models
        - idempotent: existing models remain untouched
        - returns identical schema when all models already present
        - label appears in the header comment
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a shipped migration survives a second run
        - there are migrations to check
        - ${name} runs twice, and the second time changes nothing
    - a migration that would merge rows stops instead
        - two project keys stop it, and the message names them
        - and the installation is exactly as it was afterwards
        - one project key goes through
    - a line item learns the money it was booked with
        - the values come from the contract the line belongs to
        - and the columns come out of it required, so nothing can be written without them
        - a second run leaves the values the first one wrote
        - a contract with ${what} stops the migration and is named
        - and the table is exactly as it was afterwards
        - a rate no reading brings inside 0-100 stops the migration and is named
        - a free plan frozen from the catalogue keeps its rate as it stands
        - and a free plan concluded from an offer keeps its rate as the fraction it is
        - a rate a checkout offer stated as a fraction is recorded in per cent
        - a value already in a column is kept, and a row missing only one is still found
        - an installation that never took the fragment is left alone
        - a line whose contract is gone is named as itself, not as an empty space
        - the query the guide ships finds exactly what the migration refuses
        - a contract that records both goes through
- `tests/build-stamp.test.js`
    - the build stamp
        - is stable across runs and changes with a source edit
        - sees a deleted file and a build config, not a test
        - a dependency edit makes the dependent stale
        - no stamp means not current
    - which builds are judged at all
        - only a build through build-and-prune writes a stamp
    - a build that does not finish leaves no stamp
        - the previous stamp is gone before the build starts
        - the lockfile is an input

<!-- END proof -->

### SC-OPS-004 — A destructive step is preceded by a check, not by turning the safety off

🟢 Adding a flag that lets a tool discard data would arm every future change to do the same without
being asked.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-005 — A tool that cannot finish stops before it changes anything

🟢 Where the advice it prints is only followable while the change is unapplied, it does not apply
half of it first.

_Source:_ release 0.27.0

### SC-OPS-006 — Applying the same external event twice changes nothing

🟢 Payment providers retry, and a retry must not produce a second account or a second charge.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - handlePaymentEvent() duplicate webhook → ALREADY_PROCESSED + no second activation

<!-- END proof -->

### SC-OPS-007 — Repeating an action a person took changes nothing either

🟢 Cancelling twice, accepting the same pending version twice, ending an already-ended contract —
each reports the state that already holds instead of creating a second effect.

_Source:_ release 1.0.0-rc.6

### SC-OPS-008 — A scheduled job that has not run for months catches up in one step

🟢 Not one step per missed period, and not by walking forward one period at a time until it arrives
at today.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-009 — Periods advance when the operator's own job runs them, never behind their back

🟢 SaaSiCat decides what the next period should be; writing it is the integrator's scheduled job. An
installation that never runs it loses nothing it had — the next period is simply never opened.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-010 — An installation starts, or refuses; it does not start half-configured

🟢

_Source:_ `docs/reference/options.md`

### SC-OPS-011 — Dates are handled with their time zone stated, not inferred

🟢 Server time, browser time and the tenant's own time are three different things, and a billing date
is one of the places where confusing them costs money.

_Source:_ internal engineering guidelines

## 23. Compatibility and upgrading

What an integrating developer may expect when they raise a version. The whole chapter is one
promise with several consequences: a break is deliberate, announced, and accompanied by whatever
can be automated — and where it cannot be automated, it is named rather than guessed at.

### SC-COMP-001 — All packages carry one version number and move together

🟢 There is no compatibility matrix to reason about; a mixed set is a misconfiguration.

_Source:_ `CONTRIBUTING.md` · `README.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/cjs-entry-identity.test.js`
    - CJS entries share one set of objects
        - no exported name resolves to different values across entries
        - the shared bundle actually backs every entry
        - a class is shared even between entries that never import each other
- `packages/nest/tests/di-token-registry.test.js`
    - exported DI tokens live in the global symbol registry
        - @saasicat/nest${name === '.' ? '' : name}
    - token keys stay inside the shared namespace
        - every exported token key uses a known prefix
- `packages/nest/tests/platform-composition.test.js`
    - the seam is in the CJS build too
        - the composers are there, in the same order
        - and so is the export table and its one exception
- `packages/nest/tests/saasicat-module-escape-hatches.test.js`
    - platform entry class identity
        - ${name} is re-exported from @saasicat/nest/platform
- `packages/spec/tests/docs-version-pins.test.js`
    - documentation pins no package versions (they rot at every release)
    - pin detection covers every spec form npm accepts
- `packages/spec/tests/openapi-version-is-the-package-version.test.js`
    - the OpenAPI document carries the version this package publishes
- `packages/ui-vue/tests/injection-keys-are-global-symbols.test.js`
    - every Vue injection key is created with Symbol.for
        - the guard found Vue and read every file
        - there are keys and call sites to look at
        - every injection key is created with Symbol.for
        - every key a provide/inject call names is one the declaration scan found
        - every provide/inject call site was read
        - the annotated declarations survive the tree walk
    - the guard fails on what it says it covers
        - an annotated declaration
        - an InjectionKey reached through a local type alias (#158, shape 1)
        - same-file homonyms stay in their own scope (#158, shape 2)
        - a cast and a satisfies
        - a second declarator, and one behind type arguments
        - a .vue script block that closes with `&lt;/script &gt;`
        - a key exported from a .vue and provided from a .ts
        - a .vue script block that never closes
        - provide and inject imported under another name
        - a key imported through `export *` and through `export { … } from`
        - a string key is a key, and not a missing Symbol.for
        - grouping is grouping, and a decoy is not a Symbol.for
        - an assertion may contain what a type contains
        - a key reached through a property is reported, not skipped
        - a key declared outside the tree is reported, not skipped
        - a used key that is not declared as an InjectionKey
        - a local binding spelled Symbol is not the global Symbol
        - a comment and a string are not call sites
        - somebody else's provide is not Vue's
        - the token count is a second reader, not the same one
- `tests/a-dependency-is-declared-once.test.js`
    - a dependency is declared once
        - the sweep finds the manifests
        - nothing is both a dependency and a devDependency
        - nothing is both a dependency and a peer
- `tests/consumers-dedupe-singleton-peers.test.js`
    - a consumer resolves one copy of every singleton peer
        - the peer set is non-empty and is what we think it is
        - ${relative} dedupes them
- `tests/di-tokens-share-one-namespace.test.js`
    - registry keys share one namespace
        - the scan found the tokens
        - every key starts with saasicat/&lt;package&gt;/
        - no two declarations share a key
    - the scanner itself
        - reads single- and multi-line calls, and reports template literals
        - derives the prefix from the package directory
- `tests/error-identity-across-entries.test.js`
    - AdminError across the CJS entries of @saasicat/ui-vue
        - the two entries really do hand out separate classes
        - instanceof does not survive the split
        - the brand does, and the error keeps everything it carried
        - a foreign error is still wrapped, so the brand is not a blanket pass
    - the declarations about a failure survive the split too
        - a transport failure marked through one entry is read back through the other
        - an empty response marked through one entry is read back through the other
        - an unmarked error is not mistaken for either
- `tests/every-published-package-is-in-the-fixed-group.test.js`
    - the release group covers everything that is published
        - there is exactly one fixed group
        - every publishable package is in it
        - the group names no package that does not exist
    - the candidate line knows every package too
        - while in pre mode, initialVersions names every publishable package

<!-- END proof -->

### SC-COMP-002 — A break is deliberate, documented, and belongs to a release that says it is breaking

🟢 It is never something a consumer discovers from a failing build after a patch release.

_Source:_ `CONTRIBUTING.md`

<!-- BEGIN proof -->

_Tested by:_

- `tests/pre-release-mode-is-documented.test.js`
    - the configured release line can reach the version it is for
        - on a 0.x base, a major changeset and pre mode appear together
        - and the tag it uses is the tag the docs name
        - the check has a subject either way

<!-- END proof -->

### SC-COMP-003 — There is one deliberate break on the way to 1.0, and one guide for it

🟢 A single coordinated cut with a migration guide and a command that performs most of it, rather
than a long tail of deprecations.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/v1-imports.test.js`
    - the map is derived from the move, not written beside it
        - it has entries
        - every destination is on a public surface
        - every move lands on a file that exists — in this package or the one it names
        - a component that left for the tenant package is rewritten, not reported
        - a package target names a package this repository publishes
    - the four shapes a consumer meets
        - a primitive that moved into ui/
        - the shell, which left pages/ for layouts/ — under either old spelling
        - a page that only lost the second spelling
        - a page that was already right stays untouched
    - what has no new home is reported, not guessed at
        - a domain component is recognised as unreachable
        - and it survives the rewrite untouched, so the build names it
        - a primitive is not reported — it has somewhere to go
        - a page-private part under the old alias is a removal, not a page
    - rewriting a file
        - counts what it changed and leaves the rest alone
    - a prefix that moved to another package
        - the whole path below it comes along
        - the emitted specifier is not prefixed with the old package
        - a subpath that merely starts with the same letters is untouched
- `packages/cli/tests/v1-rename.test.js`
    - the table points at things that exist
        - it has entries in every section
        - every registry-key target is inside the one namespace
        - every per-entry token target is exported by that entry
        - every identifier stem resolves to the one spelling
    - the shapes a consumer meets
        - the module class and the option types
        - a stem inside a longer identifier
        - the lowercase scope and file names are not a stem
        - a registry key a consumer spelled themselves, on one line or three
        - an import specifier that looks like the ui-vue key prefix is left alone
        - the token that meant two things is renamed by the entry it came from
        - and reported, not guessed, when the entry does not say which
        - the package that stopped being only types
        - the e2e helper subpath
        - a second run changes nothing
    - reading named imports
        - single-line, multi-line, type-only and aliased forms
        - finishes on the input a backtracking expression would choke on
    - one name from two entries in one file
        - is reported, not rewritten to whichever import came last
    - a renamed package reaches the manifest
        - the dependency fields are rewritten, nothing else is
        - the optional flag follows the peer it belongs to
        - a workspace or path range is reported, not guessed at
        - a manifest without the package is returned untouched
        - the specifier rewrite stops at the package boundary
- `tests/pre-release-mode-is-documented.test.js`
    - the configured release line can reach the version it is for
        - on a 0.x base, a major changeset and pre mode appear together
        - and the tag it uses is the tag the docs name
        - the check has a subject either way

<!-- END proof -->

### SC-COMP-004 — The upgrade command reports what it cannot decide rather than guessing

🟢 A tool that guessed would occasionally delete a declaration of the integrator's own, and they
would find out later. It errs towards leaving work rather than removing theirs.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/a-setting-is-reported-not-deleted.test.js`
    - what init says about the settings it wrote
        - every member is reported, flattened to the path it has in the file
        - an empty list reads as one, rather than as nothing at all
        - the report is read off the document, so it follows what the template writes
        - a catalogue the platform would refuse fails here, not at the first boot
    - names both, with the line each is on
    - the set is read off the schema, not written out beside it
    - every setting the schema names has a sentence saying where it goes
    - says where each one goes, separately
    - leaves the source untouched — there is nothing to write back
    - a longer identifier that merely contains the name is not reported
    - reads the value back as well as writing it — the same migration, later
    - a file that passes nothing produces no report at all
    - prose is not scanned — it cannot pass a module option
    - code is
    - a shorthand property is reported
    - a destructured read is reported
    - a mention in a comment is reported, and that is the chosen trade
    - several occurrences of one setting are all named, in file order
- `packages/cli/tests/codemod-project-key.test.js`
    - a query parameter the admin API no longer reads
        - the only parameter takes the question mark with it
        - the first of several hands the question mark to the next
        - a later one takes its own ampersand
        - an interpolation with an ampersand inside it stays whole
        - a fragment survives the parameter in front of it
        - a call expression is simple enough to keep
    - a value the scanner would have to lex is left alone
        - a nested object inside the interpolation
        - a brace inside a string inside the interpolation
        - an interpolation that never closes
        - somebody else's endpoint keeps its parameter, and is reported
        - and the word in one of its query values does not make it ours
        - an occurrence at the very start does not end the scan
    - an object member is reported, never rewritten
        - the endpoint constant
        - a create body
        - a string-literal type member, which `tsc` accepts
        - an interface member
        - a bare-identifier value
        - the shorthand form, which used to pass in silence
        - a consumer's own object
        - several are reported in the order they appear, once per line
    - a longer identifier is somebody else's name
        - is neither rewritten nor reported
        - and neither is a suffix
    - the report names lines of the file a person will open
        - a rewrite that shortens the file does not shift the lines it reports
        - and a parameter that was removed is not also reported
    - the catalogue configuration
        - loses the top-level key and nothing else
        - an indented key of the same name is not the top-level one
- `packages/cli/tests/v1-rename.test.js`
    - the table points at things that exist
        - it has entries in every section
        - every registry-key target is inside the one namespace
        - every per-entry token target is exported by that entry
        - every identifier stem resolves to the one spelling
    - the shapes a consumer meets
        - the module class and the option types
        - a stem inside a longer identifier
        - the lowercase scope and file names are not a stem
        - a registry key a consumer spelled themselves, on one line or three
        - an import specifier that looks like the ui-vue key prefix is left alone
        - the token that meant two things is renamed by the entry it came from
        - and reported, not guessed, when the entry does not say which
        - the package that stopped being only types
        - the e2e helper subpath
        - a second run changes nothing
    - reading named imports
        - single-line, multi-line, type-only and aliased forms
        - finishes on the input a backtracking expression would choke on
    - one name from two entries in one file
        - is reported, not rewritten to whichever import came last
    - a renamed package reaches the manifest
        - the dependency fields are rewritten, nothing else is
        - the optional flag follows the peer it belongs to
        - a workspace or path range is reported, not guessed at
        - a manifest without the package is returned untouched
        - the specifier rewrite stops at the package boundary
- `tests/codemod-stylesheet-parser.test.js`
    - declarations — comments sit wherever a space may sit
        - a comment before the property does not hide the declaration
        - a comment between two declarations hides neither
        - a comment glued to the property name is still a comment
        - a commented-out rule contributes no declarations
        - an unterminated comment swallows the rest and nothing more
        - a comment opener inside a string opens no comment
        - an apostrophe inside a comment opens no string
    - declarations — the span is a byte range in the original text
        - offsets survive a comment before the declaration
        - offsets survive a comment inside the value
        - offsets survive a multi-line comment
    - declarations — structure
        - a selector colon is not a property
        - a colon inside parentheses does not split the property
        - the last declaration needs no trailing semicolon
        - nesting needs no special case — @media and :deep() are just depth
        - a custom property is a declaration like any other
    - propertyGroup — the paint job, not the value
        - the same literal lands in different groups
        - a custom property is its own group — its readers decide its role
        - a property that paints nothing is not a colour site
        - case and padding do not change the group
    - styleBlocks — only stylesheets, with their offset
        - a .css file is one block at offset 0
        - an SFC contributes one block per &lt;style&gt;, offset into the file
        - an upper-case tag is still a block
        - an end tag is read however HTML lets it be written
        - scoped and lang attributes do not hide a block
    - colourSites — what a codemod is handed
        - a template is never a site — neither its text nor its inline style
        - start/end address the literal in the original file
        - the same literal under two properties yields two different keys
        - a colour inside a comment is prose, not paint
        - a functional colour with a var() channel is a token in use, not a literal
        - sites come back in document order
    - normaliseColour — one key per colour
        - case and inner whitespace do not make a second key

<!-- END proof -->

### SC-COMP-005 — A step no command can take is named as a step the operator takes

🟢 The change to the integrator's own database is shipped as a file they run once, and the guide says
so rather than implying the command covered it.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/codemod-project-key.test.js`
    - a query parameter the admin API no longer reads
        - the only parameter takes the question mark with it
        - the first of several hands the question mark to the next
        - a later one takes its own ampersand
        - an interpolation with an ampersand inside it stays whole
        - a fragment survives the parameter in front of it
        - a call expression is simple enough to keep
    - a value the scanner would have to lex is left alone
        - a nested object inside the interpolation
        - a brace inside a string inside the interpolation
        - an interpolation that never closes
        - somebody else's endpoint keeps its parameter, and is reported
        - and the word in one of its query values does not make it ours
        - an occurrence at the very start does not end the scan
    - an object member is reported, never rewritten
        - the endpoint constant
        - a create body
        - a string-literal type member, which `tsc` accepts
        - an interface member
        - a bare-identifier value
        - the shorthand form, which used to pass in silence
        - a consumer's own object
        - several are reported in the order they appear, once per line
    - a longer identifier is somebody else's name
        - is neither rewritten nor reported
        - and neither is a suffix
    - the report names lines of the file a person will open
        - a rewrite that shortens the file does not shift the lines it reports
        - and a parameter that was removed is not also reported
    - the catalogue configuration
        - loses the top-level key and nothing else
        - an indented key of the same name is not the top-level one

<!-- END proof -->

### SC-COMP-006 — An identifier a consumer may have written down is not renamed again

🟢 The names an application injects into SaaSiCat are part of the runtime contract. They were renamed
once, at 1.0, and that rename is part of what the major version paid for.

_Source:_ ADR 0002 · `CONTRIBUTING.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/v1-imports.test.js`
    - the map is derived from the move, not written beside it
        - it has entries
        - every destination is on a public surface
        - every move lands on a file that exists — in this package or the one it names
        - a component that left for the tenant package is rewritten, not reported
        - a package target names a package this repository publishes
    - the four shapes a consumer meets
        - a primitive that moved into ui/
        - the shell, which left pages/ for layouts/ — under either old spelling
        - a page that only lost the second spelling
        - a page that was already right stays untouched
    - what has no new home is reported, not guessed at
        - a domain component is recognised as unreachable
        - and it survives the rewrite untouched, so the build names it
        - a primitive is not reported — it has somewhere to go
        - a page-private part under the old alias is a removal, not a page
    - rewriting a file
        - counts what it changed and leaves the rest alone
    - a prefix that moved to another package
        - the whole path below it comes along
        - the emitted specifier is not prefixed with the old package
        - a subpath that merely starts with the same letters is untouched
- `tests/a-promise-is-not-edited-into-another.test.js`
    - the fingerprint is the promise, not the prose around it
        - a line break is not a change
        - code formatting is not a change
        - but emphasis is, because it cannot be told from a literal
        - an identifier is read as where its chain ends
        - and swapping in an unrelated one is a change
        - the heading is part of the promise
        - an underscore inside a name is not emphasis
        - an asterisk inside a pattern is not emphasis
        - a different word is a change
    - an entry that already exists may not quietly become another
        - an untouched entry is accepted
        - a rewritten promise is refused
        - a rewritten promise the commit calls editorial is accepted
        - an editorial claim for one entry does not cover another
        - a deleted entry is refused
        - a new entry beside the old one is accepted
    - retiring an entry preserves what it said
        - superseding without touching the wording is accepted
        - rewriting the wording while superseding is refused
        - delivering a promise is not rewriting it
        - filing a delivered promise as an intention is refused
        - correcting a record that was wrong is accepted when it is claimed
        - demoting a promise to a draft is refused
        - deciding a draft is accepted
        - dropping a draft is accepted
        - a withdrawn promise coming back is refused
    - a revision answers for what it did, not what it inherited
        - a rewrite in the resolution is reported
        - a deletion in the resolution is reported
        - what came in from the other branch is not
        - what this branch had already done is not
        - a parent that never had the entry does not acquit it
        - the parent that notices need not be the first
        - an entry that only arrived with one parent is left alone
    - every field an entry has is decided about
        - the parser produces exactly the fields the guard has decided about
        - nothing is in both lists
        - the sweep is looking at a real entry
    - a supersession introduces the promise that replaces it
        - a successor that already existed is refused
        - a successor introduced by the same change is accepted
        - a supersession that was already there is left alone
        - but retargeting one that was already there is refused
        - a withdrawal naming where the ground is covered is accepted
    - a claim excuses the edit that made it, and no other
        - a claim covers the step that carries it
        - and does not reach the step after it
        - the same two edits pooled into one step would pass
    - the editorial claim is read from the commits, not from the entry
        - a trailer names one identifier
        - a trailer names several, however they are separated
        - several commits each contribute their own
        - the word inside a sentence is not a trailer

<!-- END proof -->

### SC-COMP-007 — A change that would otherwise be silent breaks the integrator's build instead

🟢 Where an integrator supplies their own data access, a new fact the platform depends on is required
rather than optional. An implementation that omitted the two cancellation dates could not tell a
subscription that ends next January from one that ended last January, and the quiet answer is that
it keeps everything.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/schema-check.test.js`
    - parseFields
        - reads name, type and modifiers, skips attributes and comments
    - reads single-line model blocks
    - identical attributes produce no finding
    - a missing index is reported but does not fail the check
    - a missing unique constraint fails the check
    - a diverging @@map fails the check and names both sides
    - whitespace and attribute options do not create false findings
    - extra consumer indexes are not reported
    - parseEnumValues
        - reads members and ignores attributes
        - reads members sharing one line
    - parseSchema
        - separates models from enums
        - commented-out relations are not fields
    - checkSchema
        - identical schema has no drift
        - consumer extensions are not drift
        - missing field in an adopted model fails
        - absent model is informational, not a failure
        - missing enum value in an adopted enum fails
        - absent enum is informational, not a failure
        - type change is a mismatch
        - String replaced by a locally declared enum is allowed
        - String[] replaced by a local enum list is allowed
        - a non-String spec type is not substitutable by an enum
        - a consumer widening a required field to nullable is a mismatch
        - a consumer tightening a nullable field to required is allowed
        - list change is a mismatch
    - parser hardening (review findings)
        - a commented-out @@unique or @@map counts as absent, not present
        - a brace inside a string default does not close the model early
        - a // inside a string literal is not treated as a comment
        - indexed field arguments are parsed past their parentheses
        - @@map survives the comment strip
    - blankStringLiterals
        - blanks contents, keeps quotes and length
        - handles escaped quotes without leaving the string early
        - leaves a line without strings untouched
        - is linear on pathological input

<!-- END proof -->

### SC-COMP-008 — An implementation offers only what it can actually answer

🟢 Declaring an operation and then failing inside it turned a recoverable fallback into a server
error on three tenant-facing routes. Where the underlying store cannot answer, the operation is
absent and the platform falls back.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/codegen-drift.test.js`
    - Q.4 Codegen drift gate
        - every schema has a generated file, and every generated file a schema
        - a schema with no title is refused rather than generated as undefined
        - ${genFile} is in sync with ${file}
- `packages/spec/tests/openapi-version-is-the-package-version.test.js`
    - the OpenAPI document carries the version this package publishes
- `tests/dist-is-self-contained.test.js`
    - dist/ contains exactly what the entry points reach
        - every package that builds was swept
        - ${pkg.name}: the export map names entry points that exist
        - ${pkg.name}: every export target the manifest commits to is on disk
        - ${pkg.name}: every relative reference inside dist/ resolves
        - ${pkg.name}: no emitted file is unreachable
- `tests/export-map-matches-filesystem.test.js`
    - package.json#exports matches the filesystem
        - the sweep finds the packages it claims to check
        - ${pkg.name}: exports its own package.json
        - ${pkg.name}: every non-wildcard target exists
        - ${pkg.name}: every wildcard pattern resolves to something
        - ${pkg.name}: a require condition never hands out an ESM .d.ts
        - ${pkg.name}: files[] covers every exported path
    - the ui-vue source subpaths stay curated
        - no NEW subpath duplicates a target
- `tests/openapi-covers-the-implementation.test.js`
    - the OpenAPI document describes the implementation
        - both sweeps reach what they claim to read
        - every admin route the platform serves is documented
        - every documented operation is served by the platform or declared app-served
        - nothing is marked app-served that the platform actually serves
        - a controller with a computed path says which document covers it
- `tests/public-options-name-only-what-we-publish.test.js`
    - a public option type names only types this package publishes
        - the sweep found the components and their interfaces
        - every Quasar type in an exported interface is re-exported
- `tests/vue-entry-is-complete.test.js`
    - the vue entry publishes exactly the layer the main entry re-exports
        - there is a layer to compare
        - the two lists are the same
        - the vue entry re-exports nothing outside its own layer

<!-- END proof -->

### SC-COMP-009 — Shipped source stays within a language level an integrator's toolchain can read

🟢 Their compiler reads it, not SaaSiCat's. Raising that floor breaks consumers below it and is a
deliberate, announced change — never a way to make a build pass.

_Source:_ `CONTRIBUTING.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/module-resolution.test.js`
    - readEffectiveModuleResolution
        - reads the live value, not the commented-out one above it
    - follows extends to a base config that sets the old resolution
    - a local value overrides the inherited one
    - returns null when nothing in the chain sets it
    - returns null for a config TypeScript cannot parse, or none at all
    - judgeModuleResolution
        - accepts the three kinds that resolve subpath exports, and unset
        - refuses node10 and classic, naming the setting the reader knows it by
- `packages/create-saasicat-admin/tests/scaffold-typechecks.test.js`
    - a scaffolded admin type-checks against the ui-vue it was scaffolded for
        - vue-tsc accepts the templates as written
- `packages/ui-vue/tests/component/sfc-compiles.test.ts`
    - every SFC compiles
        - the sweep finds the files it claims to check
        - no file fails the SFC compiler
- `packages/ui-vue/tests/composables-survive-the-server.test.js`
    - the premise holds: there is no document here
    - an initially-open dialog renders on the server
        - it does not reach for a document that is not there
        - the markup it emits is still named
    - a wizard renders on the server
        - the step machine needs no document to say where it is
    - the brand bridge on a server
        - applying a brand colour is a no-op, and so is undoing it

<!-- END proof -->

### SC-COMP-010 — An integrator's own data access translates; it does not decide

🟢 Domain rules live above the storage layer, which is what keeps two implementations
interchangeable. An implementation that decides something — filtering on its own, defaulting a
status — moves a rule to where the other one does not have it.

_Source:_ ADR 0007

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/drizzle-adapters.test.js`
    - schema table map
        - table names match the canonical @@map names
        - camelCase column names are preserved (no snake_case mapping)
    - drizzlePersistence()
        - instance db → ready instances; declared capabilities
        - token db → factory specs injecting the token
        - hasher instance + instance db enables provisioning
        - transaction runner passes the drizzle tx through as context
- `packages/adapter-prisma/tests/prisma-adapters.test.js`
    - PrismaMfaAdapter
        - secret roundtrip incl. enabledAt handling
    - PrismaAuditAdapter
        - write maps actor to userId + actorTag on audit_logs
        - write without changes defaults to {}
    - PrismaAuditQueryAdapter
        - maps wildcard actorTag, pagination and row → AuditEntry
    - AsyncLocalRlsBypassAdapter
        - isBypassActive only inside runWithBypass
    - PrismaTransactionRunner
        - run passes the interactive tx client through as context
    - PrismaSubscriptionRepository
        - findByTenantId maps row + plan version to SubscriptionRecord
        - findByTenantIdLocked takes the FOR UPDATE lock inside the tx
        - countByPlanVersionId uses a single OR count
        - countActiveByPlanKey aggregates by authoritative PlanVersion identity
    - PrismaSubscriptionUsageAdapter
        - maps the canonical subscription to the tenant billing display form
    - PrismaPlanVersionRepository
        - findLatestLive filters live versions and maps the record
    - PrismaPromoCodeRepository
        - claimSlot issues the atomic guarded UPDATE
        - releaseSlot floors at 0 and reactivates EXHAUSTED
        - create normalizes the code and serializes decimals
        - findByCode hides soft-deleted codes
        - update persists every field editable in the Admin promo page
        - expireDueCodes targets ACTIVE/PAUSED with validUntil &lt; now
    - PrismaPromoCodeRedemptionRepository
        - create maps defaults and double redemption rejects
    - PrismaSuperAdminBootstrapAdapter
        - createSuperAdmin hashes the password and lowercases the email
        - duplicate email throws PlatformUserExistsError
    - PrismaPlanCatalogImportSink
        - upsertPlanVersion is idempotent and supersedes older live versions on publish
    - PrismaPlanCatalogReadSink
        - loadSnapshot maps rows to wire formats with ISO dates and defaults
    - prismaPersistence() bundle options
        - bundle.validityWindows reaches the catalog bundle repository
        - bundle.validityWindows reaches the entitlement bundle repository too
        - defaults to the 0.6-compatible behavior when omitted
    - prismaPersistence()
        - token client → factory specs injecting the token
        - instance client → ready instances; hasher instance enables provisioning
        - token client + hasher token → provisioning factory injecting both
- `packages/core/tests/canonical-rows-become-records.test.js`
    - a plan row becomes a plan record
        - dates leave as ISO strings, and an undeleted plan says so
        - a soft-deleted plan carries the date it was deleted on
    - a plan version row becomes a version record
        - the plan key is the one passed, not the one on the row
        - prices survive as strings, whatever the driver handed over
        - a schema without validity windows reads them as null, not as dates
        - a schema without endsAt omits the field rather than saying null
        - publishedChanges that is not an array reads as null
        - a quota written as a string is the number it says
        - and one nothing can read stays, so the diff can tell it from absent
        - features and quotas drop entries of the wrong type
        - a JSON column holding nothing usable reads as empty, not as a crash
    - a contract row becomes a contract record
        - dates stay Date objects — a contract record is not a wire format
        - the lines it is handed become its lines
        - an entitlement snapshot that is not an object reads as null
        - snapshot arrays that are not arrays read as empty
        - terms that are not an object read as null
    - a line item row becomes a line item record
        - money becomes a number, from a string or from a Decimal
        - the currency and the tax come back as the row recorded them
        - a discount line keeps its negative tax
        - an amount arrives with the cent it left with
        - and the guarantee stops where the column does
        - the commitment date and the metadata survive both ways round
        - a features snapshot of mixed types keeps only the strings
        - a quota written as a string is the number it says
        - and one nothing can read stays declared rather than vanishing
- `packages/nest/tests/saasicat-persistence.test.js`
    - SaaSiCatModule persistence bundle
        - forRoot wires from a bundle without individual adapters
        - missing core adapters are reported by name
        - entitlement pulls repositories + transaction runner from the bundle
        - entitlement without required capabilities fails fast at boot
        - explicit adapters combine with a bundle
        - DB hydration forwards the dbCatalog identity to the plan-catalog factory
        - DB hydration without dbCatalog fails fast instead of loading an empty catalog
        - the mega module COMPILES through Nest DI with a bundle (boot smoke)
        - bundle without entitlement slice still requires repositories for entitlement
        - the high-level standard stack wires catalog and tenant billing from one bundle
        - the high-level standard stack compiles through Nest DI
- `packages/nest/tests/the-module-hands-over-what-it-was-given.test.js`
    - SubscriptionBundleModule.forRoot
        - says nothing about the term when the consumer said nothing
        - hands over a term the consumer did configure
        - hands over an explicit zero rather than treating it as unset
        - and the services then commit the tenant to nothing

<!-- END proof -->

### SC-COMP-011 — Every data-access implementation is held to the same executable contract

🟢 Against a real database, covering the behaviours that only appear under concurrency. "Atomic"
means four different things to four implementations, and prose could not settle it.

_Source:_ ADR 0007

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/persistence-contract.integration.test.js`
    - drizzle-specific schema interop
        - text-declared enum columns round-trip against Postgres enum types
        - the required planVersionId constraint bites through the drizzle write path
- `packages/adapter-drizzle/tests/the-query-map-describes-the-real-tables.test.js`
    - every table in the query map
        - there is more than one, so a broken scan cannot pass by finding none
        - ${table} declares exactly the canonical columns
- `packages/adapter-prisma/tests/integration/persistence-contract.integration.test.js`
    - canonical schema structure
        - partial unique draft indexes exist
        - one draft per plan lineage is enforced by the database
        - subscriptions require planVersionId
- `packages/adapter-prisma/tests/prisma-adapters.test.js`
    - PrismaMfaAdapter
        - secret roundtrip incl. enabledAt handling
    - PrismaAuditAdapter
        - write maps actor to userId + actorTag on audit_logs
        - write without changes defaults to {}
    - PrismaAuditQueryAdapter
        - maps wildcard actorTag, pagination and row → AuditEntry
    - AsyncLocalRlsBypassAdapter
        - isBypassActive only inside runWithBypass
    - PrismaTransactionRunner
        - run passes the interactive tx client through as context
    - PrismaSubscriptionRepository
        - findByTenantId maps row + plan version to SubscriptionRecord
        - findByTenantIdLocked takes the FOR UPDATE lock inside the tx
        - countByPlanVersionId uses a single OR count
        - countActiveByPlanKey aggregates by authoritative PlanVersion identity
    - PrismaSubscriptionUsageAdapter
        - maps the canonical subscription to the tenant billing display form
    - PrismaPlanVersionRepository
        - findLatestLive filters live versions and maps the record
    - PrismaPromoCodeRepository
        - claimSlot issues the atomic guarded UPDATE
        - releaseSlot floors at 0 and reactivates EXHAUSTED
        - create normalizes the code and serializes decimals
        - findByCode hides soft-deleted codes
        - update persists every field editable in the Admin promo page
        - expireDueCodes targets ACTIVE/PAUSED with validUntil &lt; now
    - PrismaPromoCodeRedemptionRepository
        - create maps defaults and double redemption rejects
    - PrismaSuperAdminBootstrapAdapter
        - createSuperAdmin hashes the password and lowercases the email
        - duplicate email throws PlatformUserExistsError
    - PrismaPlanCatalogImportSink
        - upsertPlanVersion is idempotent and supersedes older live versions on publish
    - PrismaPlanCatalogReadSink
        - loadSnapshot maps rows to wire formats with ISO dates and defaults
    - prismaPersistence() bundle options
        - bundle.validityWindows reaches the catalog bundle repository
        - bundle.validityWindows reaches the entitlement bundle repository too
        - defaults to the 0.6-compatible behavior when omitted
    - prismaPersistence()
        - token client → factory specs injecting the token
        - instance client → ready instances; hasher instance enables provisioning
        - token client + hasher token → provisioning factory injecting both
- `packages/cli/tests/migration-constraints.test.js`
    - which migration the constraints belong to
        - the one that appeared between the two listings
        - nothing new means nothing to append to, even with migrations present
        - directories that are not migrations are not candidates
        - the newest of several, when a run somehow produced two
        - no migrations at all is not an error, it is nothing to do
    - appending them
        - the statements land after the tables
        - it says where the copy came from
        - running it twice appends once
        - a migration that already has them is recognised
        - a migration without a trailing newline still gets a separating one
    - only the constraints this schema has tables for
        - reads the table off each statement
        - keeps the ones whose table is present
        - keeps everything when every table is present
        - a statement it cannot read is kept, not dropped
        - nothing applicable appends nothing at all
    - what step 3 did, and whether step 4 may follow
        - only a failure stops the command
        - "before applying" is said exactly when the command will not apply
        - a failure says where the SQL is, because the operator now needs it
        - nothing to append is not a failure
        - every outcome carries a message and a decision
- `packages/core/tests/canonical-rows-become-records.test.js`
    - a plan row becomes a plan record
        - dates leave as ISO strings, and an undeleted plan says so
        - a soft-deleted plan carries the date it was deleted on
    - a plan version row becomes a version record
        - the plan key is the one passed, not the one on the row
        - prices survive as strings, whatever the driver handed over
        - a schema without validity windows reads them as null, not as dates
        - a schema without endsAt omits the field rather than saying null
        - publishedChanges that is not an array reads as null
        - a quota written as a string is the number it says
        - and one nothing can read stays, so the diff can tell it from absent
        - features and quotas drop entries of the wrong type
        - a JSON column holding nothing usable reads as empty, not as a crash
    - a contract row becomes a contract record
        - dates stay Date objects — a contract record is not a wire format
        - the lines it is handed become its lines
        - an entitlement snapshot that is not an object reads as null
        - snapshot arrays that are not arrays read as empty
        - terms that are not an object read as null
    - a line item row becomes a line item record
        - money becomes a number, from a string or from a Decimal
        - the currency and the tax come back as the row recorded them
        - a discount line keeps its negative tax
        - an amount arrives with the cent it left with
        - and the guarantee stops where the column does
        - the commitment date and the metadata survive both ways round
        - a features snapshot of mixed types keeps only the strings
        - a quota written as a string is the number it says
        - and one nothing can read stays declared rather than vanishing
- `packages/nest/tests/create-saasicat-test-module.test.js`
    - createSaaSiCatTestModule
        - returns a DynamicModule with a test host
        - default stubs are no-op capable
        - overrides can replace individual adapters
- `packages/nest/tests/saasicat-persistence.test.js`
    - standard adapters
        - SubscriptionPlanResolver only grants active subscriptions
        - QuotaProvidersUsageSnapshot reuses every quota counter
- `packages/spec/tests/reference-sql-drift.test.js`
    - prisma-fragments compose and reference-schema.postgres.sql is in sync
    - normative constraints are part of the reference schema
    - bundle validity windows and their lookup index are in the reference schema
    - plan-version validity, termination and lookup index are in the reference schema
    - the reference schema makes one subscription per tenant impossible to break

<!-- END proof -->

### SC-COMP-012 — Where one implementation cannot do what another can, the gap is recorded

🟢 Deliberately, rather than widened quietly and discovered by whoever chose the lagging one.

_Source:_ ADR 0007

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/drizzle-adapters.test.js`
    - schema table map
        - table names match the canonical @@map names
        - camelCase column names are preserved (no snake_case mapping)
    - drizzlePersistence()
        - instance db → ready instances; declared capabilities
        - token db → factory specs injecting the token
        - hasher instance + instance db enables provisioning
        - transaction runner passes the drizzle tx through as context
- `packages/adapter-drizzle/tests/every-exported-class-reaches-the-factory.test.js`
    - the persistence factory
        - names enough exports for this check to mean anything
        - ${name} is reachable through drizzlePersistence()
- `packages/adapter-drizzle/tests/integration/persistence-contract.integration.test.js`
    - drizzle-specific schema interop
        - text-declared enum columns round-trip against Postgres enum types
        - the required planVersionId constraint bites through the drizzle write path
- `packages/adapter-prisma/tests/integration/persistence-contract.integration.test.js`
    - canonical schema structure
        - partial unique draft indexes exist
        - one draft per plan lineage is enforced by the database
        - subscriptions require planVersionId
- `packages/nest/tests/an-adapter-without-a-plan-catalogue-can-sell-bundles.test.js`
    - an adapter with bundles but no plan catalogue
        - boots with subscriptionBundles enabled
        - and the module is handed the repository it found
        - an adapter with neither is still refused, by name
        - a plan catalogue still wins where an adapter has one
- `packages/nest/tests/saasicat-persistence.test.js`
    - standard adapters
        - SubscriptionPlanResolver only grants active subscriptions
        - QuotaProvidersUsageSnapshot reuses every quota counter

<!-- END proof -->

### SC-COMP-013 — An installation whose store cannot hold a limit exactly does not start the enforcement

🟢 Enforcing a limit needs a store that can serialise a count and a write. An installation whose
store says it cannot is told at start-up rather than at the moment two customers slip past a
limit.

_Source:_ `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/fk-pointers.test.js`
    - finding them
        - every commented relation to Tenant or User
        - prose that merely mentions @relation is not one
        - a relation to something else is left alone
    - enabling them
        - both targets, renamed to the app models
        - naming only the tenant leaves the user relations commented, and says so
        - naming nothing changes nothing
        - the column alignment the fragment chose survives
        - running it twice is a no-op — there is nothing left to uncomment
    - a relation Prisma would refuse is left commented
        - a missing opposite field stops the pointer, and names the line to add
        - the relation NAME is part of the question
        - relationNameOf reads the name, and only a name
        - hasBackRelation matches on type and name together
    - refusing a model that does not exist
        - and listing what the schema does declare
        - a name that does exist passes
        - naming nothing passes
    - against the fragments as shipped
        - every commented FK pointer in them is one this recognises
    - a unique foreign key is recognised as one-to-one
    - the foreign key is read off the relation attribute
    - a singular opposite field counts as the back relation
    - so the pointer is enabled rather than reported as missing
    - and when it IS missing, the suggestion is singular too
    - a model name is data, not part of the pattern
        - a name full of metacharacters matches nothing rather than everything
        - and the same through hasBackRelation directly
        - a field name with an alternation does not match a different field
        - an ordinary name still works, so the escaping did not break matching
- `packages/nest/tests/a-preview-answers-on-an-older-schema.test.js`
    - a bundle preview on a schema without validity windows
        - answers, using the newest live version for the redundancy hint
        - and the same answer as a schema that does offer the lookup
        - a bundle the plan does not cover gets no redundancy warning either way
        - with no plan repository at all it still answers
        - a repository that offers the lookup and throws inside it is the bug itself

<!-- END proof -->

### SC-COMP-014 — The example application is kept in step with the platform

🟢 It is what an integrator copies from, and an outdated example teaches the wrong integration to
everyone who reads it.

_Source:_ `docs/explanation/test-coverage.md`

<!-- BEGIN proof -->

_Tested by:_

- `examples/notesapp/tests/dev-proxy-targets-own-backend.test.mjs`
    - docker-compose declares a default for every port the dev server needs
    - the vite config reads the ports from the file, not from the shell
    - ${variable}: the config fallback equals the compose default
    - .env.example documents the same defaults it tells people to override
- `examples/notesapp/tests/notesapp-smoke.test.mjs`
    - notesapp platform wiring (smoke)
        - static entitlement resolves the STARTER plan for every tenant
- `tests/the-example-sends-the-role-its-guards-require.test.js`
    - the notesapp clients present a role the platform accepts
        - the guard still names roles
        - ${label} assigns the role header
        - ${label} assigns a role the guard accepts
- `tests/tutorials-match-the-example.test.js`
    - the tutorials print what the example actually contains
        - the sweep finds the tutorials and their claims
        - every annotated block appears in the file it names
        - every saasicat command a tutorial gives exists

<!-- END proof -->

### SC-COMP-015 — A public interface is changed only after its consumers have been checked

🟢 Reusable components, exported types, configuration formats and extension points reach real
applications. Additive is preferred; a break is intentional and reflected in the release notes.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/saasicat-module-escape-hatches.test.js`
    - root entry incremental migration
        - root SaaSiCatModule composes the same root-entry module classes

<!-- END proof -->

## 24. Being understandable to a stranger

SaaSiCat is read by people who did not build it and cannot ask anyone. That makes
comprehensibility a property of the product rather than a courtesy: what is not in the code or the
documentation does not exist for the reader. The requirements here are what that costs.

### SC-READ-001 — Someone deciding whether to depend on SaaSiCat can judge what is tested

🟢 By name and by what a failure would cost, not by a percentage. A number is not a risk assessment.

_Source:_ `docs/explanation/test-coverage.md`

<!-- BEGIN proof -->

_Tested by:_

- `tests/package-readmes-follow-one-shape.test.js`
    - every package README answers the same questions
        - the sweep finds every package
        - each README names its package and carries the three sections
        - a package with more than one entry point documents all of them
        - "what this is not" says something concrete
- `tests/repository-carries-no-heavy-binaries.test.js`
    - no tracked binary is heavier than it needs to be
        - the sweep finds the assets it claims to weigh
        - every tracked binary stays under ${LIMIT_KB} KB
- `tests/tutorials-match-the-example.test.js`
    - the tutorials print what the example actually contains
        - the sweep finds the tutorials and their claims
        - every annotated block appears in the file it names
        - every saasicat command a tutorial gives exists

<!-- END proof -->

### SC-READ-002 — A gap is named rather than papered over

🟢 Where a property cannot be checked automatically, that is said plainly instead of prose being
presented as enforcement.

_Source:_ `docs/explanation/test-coverage.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `tests/a-suite-that-throws-fails-the-run.test.js`
    - no suite hides its failure in a describe body
        - the sweep finds the suites
        - no describe body is async
- `tests/coverage-measures-every-package-it-can.test.js`
    - the coverage ratchet sees every package it can
        - the sweep finds the packages
        - every measurable package has a recorded baseline
        - no baseline entry describes a package that is gone

<!-- END proof -->

### SC-READ-003 — A statement about the software is part of it

🟢 A comment, a release note or a documentation sentence that is wrong is worse than none: it sends
the next reader off with a false premise. A release note is worse still, because after publication
it cannot be corrected.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `tests/a-promise-is-not-edited-into-another.test.js`
    - the fingerprint is the promise, not the prose around it
        - a line break is not a change
        - code formatting is not a change
        - but emphasis is, because it cannot be told from a literal
        - an identifier is read as where its chain ends
        - and swapping in an unrelated one is a change
        - the heading is part of the promise
        - an underscore inside a name is not emphasis
        - an asterisk inside a pattern is not emphasis
        - a different word is a change
    - an entry that already exists may not quietly become another
        - an untouched entry is accepted
        - a rewritten promise is refused
        - a rewritten promise the commit calls editorial is accepted
        - an editorial claim for one entry does not cover another
        - a deleted entry is refused
        - a new entry beside the old one is accepted
    - retiring an entry preserves what it said
        - superseding without touching the wording is accepted
        - rewriting the wording while superseding is refused
        - delivering a promise is not rewriting it
        - filing a delivered promise as an intention is refused
        - correcting a record that was wrong is accepted when it is claimed
        - demoting a promise to a draft is refused
        - deciding a draft is accepted
        - dropping a draft is accepted
        - a withdrawn promise coming back is refused
    - a revision answers for what it did, not what it inherited
        - a rewrite in the resolution is reported
        - a deletion in the resolution is reported
        - what came in from the other branch is not
        - what this branch had already done is not
        - a parent that never had the entry does not acquit it
        - the parent that notices need not be the first
        - an entry that only arrived with one parent is left alone
    - every field an entry has is decided about
        - the parser produces exactly the fields the guard has decided about
        - nothing is in both lists
        - the sweep is looking at a real entry
    - a supersession introduces the promise that replaces it
        - a successor that already existed is refused
        - a successor introduced by the same change is accepted
        - a supersession that was already there is left alone
        - but retargeting one that was already there is refused
        - a withdrawal naming where the ground is covered is accepted
    - a claim excuses the edit that made it, and no other
        - a claim covers the step that carries it
        - and does not reach the step after it
        - the same two edits pooled into one step would pass
    - the editorial claim is read from the commits, not from the entry
        - a trailer names one identifier
        - a trailer names several, however they are separated
        - several commits each contribute their own
        - the word inside a sentence is not a trailer
- `tests/an-absolute-promise-names-its-boundary.test.js`
    - an absolute is recognised wherever it stands
        - in the promise under the heading
        - and in the heading itself, where nineteen entries keep their whole promise
        - a word that merely contains one does not count
        - an ordinary promise claims nothing of the kind
    - an exception is recognised the same way
        - the words an entry says it with
        - and nothing else
        - a denial of the noun is not a boundary
        - and the word that denies it has to stand directly in front of it
    - what the debt counts
        - an absolute with neither a test nor an exception
        - a test settles it
        - a named exception settles it
        - a draft owes nothing — it is a proposal, not a promise
        - one decided but not delivered owes nothing until it is built
        - a retired one owes nothing either
    - the ratchet moves one way
        - an unqualified absolute arriving with nothing to pay for it is refused
        - one arriving while another gains its boundary is allowed
        - nothing arriving is always allowed
        - retiring an old absolute does not pay for a new one
    - the two lists say what they are for
        - every absolute is a word about all cases, not an emphatic one
        - every exception is a word that opens a boundary
- `tests/requirements-are-generated.test.js`
    - the requirements document is generated, not maintained
        - the sources yield a catalogue worth checking
        - the document on disk is what the generator produces
        - the index names every entry that is not ordinary
        - the region markers stay in the sources
        - the page and the source it was spliced into say the same thing
        - the generated region inside the sources is current too
        - the sources satisfy every rule the checker can state
    - what a breach costs is marked where it is more than ordinary
        - a risk opens the promise, behind the state
        - and behind the delivery marker where that opens it
        - an entry without one is ordinary, not unmarked
        - a mark that is neither a state nor a risk is refused
    - the tests an entry names are written under it
        - the block is generated, and the page carries it
        - it is not part of the promise
        - an entry nothing tests carries no block
    - a generated region that lost its close destroys nothing
        - an unclosed marker keeps the requirement after it
        - an unclosed marker at the end keeps the rest of the file
        - and the checker refuses the file so nothing is written
        - a close that opens nothing is refused too
        - a well-formed chapter is not refused
    - the parser reads the entry, not the prose around it
        - a value keeps its colons, quotes and backticks
        - front matter that never closes is an error, not an empty chapter
        - a heading with a hyphen is kept as an entry with no identifier
        - dependencies come from the prose, and never point at the entry itself
        - a draft is read from its own first words
        - a marker wrapped across a line still counts
        - an entry with no marker is current and delivered
        - a retired entry is read from its own first words
    - the checks refuse what the conventions used to leave to care
        - a clean chapter is accepted
        - an identifier used twice
        - a heading with a hyphen instead of an em dash
        - an entry with no source
        - an entry with two sources
        - a marker line with a letter too many
        - a number skipped inside a chapter
        - an entry filed under the wrong chapter
        - a reference to an identifier that does not exist
        - a promise leaning on one that no longer holds
        - a successor that does not exist
        - a promise superseded by a draft
        - a chain that ends where nothing stands
        - a chain that arrives at a promise that stands is accepted
        - a supersession chain that loops
        - a chapter number that skips
        - an anchor that lands on no heading
        - an anchor across chapters resolves
        - a draft that also claims to be decided but not delivered
        - a state that opens with the wrong colour
        - a retired entry that opens with no state
        - an undelivered promise that opens with none
        - a state marker appended after the prose
        - a colour with no space before its marker
        - a colour with two spaces before its marker still parses
        - a state marker that nearly matches
        - a state marker wearing a colour no state has
        - an identifier with a digit missing
        - a mistyped identifier in a chapter introduction
        - a vanished reference in a chapter introduction
        - a real reference in a chapter introduction is accepted
        - a mistyped identifier in the heading
        - a real identifier in the heading is resolved
        - an identifier with a suffix that continues a name
        - a link into the repository
        - an anchor inside the document is still a link
        - a state word nobody defined
        - a directory that does not say where it belongs
        - nothing carrying the chapter table
        - two files carrying it
        - markers in the wrong order
        - a doubled pair of markers
        - Markdown that nothing reads
        - the file that is deliberately not published is not one
        - nothing to open the document with
        - a preamble part numbered out of sequence
        - a chapter field nobody reads
        - a chapter with a heading and nothing under it

<!-- END proof -->

### SC-READ-004 — An architectural decision records what breaks if it is ignored

🟢 Not only what was decided and why, but what a reader will experience if they do something else.

_Source:_ ADR 0001 to ADR 0011

<!-- BEGIN proof -->

_Tested by:_

- `tests/adrs-record-what-breaks.test.js`
    - every architecture decision is recorded the same way
        - the sweep finds the records
        - the numbering is unique and has no gaps
        - each record carries a status, a date and the five sections
        - the "what breaks" section says something

<!-- END proof -->

### SC-READ-005 — The product has one spelling of its own name

🟢 A reader who meets a second spelling has no way to tell a different product from an unfinished
rename.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `tests/one-spelling.test.js`
    - the product has one spelling
        - the scan reaches the repository
        - no tracked file carries an old spelling without declaring it
    - the scanner itself
        - flags each old spelling as a whole identifier
        - does not flag the three accepted forms
        - a declaration has to be in the head of the file

<!-- END proof -->

### SC-READ-006 — A reference a reader cannot follow is not made

🟢 Every link into this repository resolves, and link text says what it leads to. Pointing at a
document only the original team can open implies a rule exists somewhere and hides where — two
such citations had reached error messages an operator could read.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `tests/a-source-that-names-a-file-names-a-real-one.test.js`
    - a source that names a file names a real one
        - there are sources to look at — otherwise nothing below looks at anything
        - every path a source names is a tracked file
        - the reader of a source line tells a path from the rest of it
- `tests/docs-links-resolve.test.js`
    - documentation links resolve
        - the sweep found the documentation
        - every relative link points at a file that exists
        - every anchor points at a heading that exists
- `tests/no-dangling-doc-refs.test.js`
    - the sweep actually reaches the source tree
    - no shipped file cites a document from the private planning repo

<!-- END proof -->

### SC-READ-007 — Reference documentation is generated from the implementation

🟢 The list of refusal codes and the list of configuration rules are derived from the code that
implements them, so they cannot drift into describing something that is no longer true.

_Source:_ `docs/reference/error-codes.md` · `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `tests/docs-api-drift.test.js`
    - documentation matches the packages that exist
        - the sweep reaches the documentation it claims to check
        - every table that enumerates the packages lists all of them
        - no text claims a package count the repository does not have
    - code blocks in the documentation use the API that exists
        - the sweep finds the blocks it claims to read
        - every documented import resolves through the export map
        - every documented option exists, and a complete example passes the required ones
- `tests/openapi-covers-the-implementation.test.js`
    - the OpenAPI document describes the implementation
        - both sweeps reach what they claim to read
        - every admin route the platform serves is documented
        - every documented operation is served by the platform or declared app-served
        - nothing is marked app-served that the platform actually serves
        - a controller with a computed path says which document covers it
- `tests/options-reference-is-generated.test.js`
    - the options reference is generated, not maintained
        - the committed page is what the generator produces
        - it says it is generated, at the top where an editor would see it
    - every rule links to a heading that exists
        - ${rule.id} resolves
        - the slug is the one GitHub uses
        - there are rules to check at all
- `tests/public-options-name-only-what-we-publish.test.js`
    - a public option type names only types this package publishes
        - the sweep found the components and their interfaces
        - every Quasar type in an exported interface is re-exported
- `tests/reference-pages-are-generated.test.js`
    - the reference pages are generated, not maintained
        - the generators produce every page they claim to
        - every page on disk is what the generator produces
    - every declaration is found, whatever the comments say
    - a var() reference is still not a declaration
    - a token name outside a declaration does not hide the next one
    - an unterminated comment swallows the rest rather than the scanner

<!-- END proof -->

### SC-READ-008 — There is one way to do each thing, not two right answers

🟢 One way to mount a screen, one spelling of a name, one place a setting lives. Where a reader can
see two correct-looking options and no rule saying which is meant, that is a defect in the
product, not a matter of taste.

_Source:_ ADR 0008 · #217

<!-- BEGIN proof -->

_Tested by:_

- `tests/agent-worktrees-are-not-linted.test.js`
    - agent worktrees under .claude/ stay out of the repo-wide gates
        - git ignores them — this keeps `git status` clean and Prettier out
        - eslint ignores them
        - and the ignore stops there — the source tree is still checked
- `tests/css-classes-have-a-user.test.js`
    - CSS classes have a user
        - no stylesheet defines a class nothing writes
- `tests/nest-domain-boundaries.test.js`
    - no barrel-to-barrel imports across nest domains
        - ${path} may not import a sibling barrel
        - a barrel one directory deeper is caught too
        - importing the declaring module is what the rule asks for
    - domains do not import platform/
        - ${domain}/ may not reach back into platform/
        - testing/ may, because it sits downstream of platform/
        - platform/ may import its own neighbours
    - the boundaries hold on the tree as it stands
        - no file in the package violates either rule

<!-- END proof -->
