---
title: Language and wording
---

Two audiences read SaaSiCat's text, and they are owed different things. A tenant reads it in the
language they chose. An integrating developer reads diagnostics, and those stay in one language on
purpose. This chapter also fixes what a refusal is: a code that does not change, and a wording
that may.

### SC-LANG-001 — A person reads the interface in the language they chose

🟢 They can change it from the shell, on the sign-in card and during first-run set-up, and the choice
is remembered and outranks whatever the installation configured.

_Source:_ #45 · #47 · release 0.16.0

### SC-LANG-002 — The admin interface falls back to English, the backend to German

🟢 Two answers to one question, and knowing which applies where matters: the shipped interface uses
English when nothing else is named, while several backend routes — registration and the public
price list among them — default to German. An installation that names its language everywhere
never meets the difference; one that relies on the default meets it as a screen in two languages.

_(Documented as it stands. One default for both belongs in a breaking change, because moving
either of them changes what an existing installation renders.)_

_Source:_ `docs/guides/upgrade-to-1.0.md` · current practice

### SC-LANG-003 — Which languages an application offers is the application's decision

🟢 SaaSiCat ships two complete ones and lets an installation narrow that set or add its own. A
language added by an installation is usable from its first translated key onwards, falling back
for the rest.

_Source:_ release 0.17.0

### SC-LANG-004 — A missing translation is never an empty line

🟢 Text a reader's own catalogue does not know falls back to the shipped English rather than
disappearing, and never to a bare internal code.

_Source:_ #243 · release 0.19.0

### SC-LANG-005 — Every string on a screen follows the language that was chosen

🟢 Including the ones assembled from parts. An installation that added a third language got a shell
in that language with thirty-four sentences stranded in another.

_Source:_ release 0.18.0

### SC-LANG-006 — Text a customer reads carries its values beside its code, not inside a sentence

🟢 A sentence with the numbers baked into it cannot be rebuilt in another language by anyone
downstream. A tenant read "Current usage 11 exceeds the target limit 5" in English whatever
language they had chosen, and no integrator could reach it.

_Source:_ #243

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/error-params-contract.test.js`
    - the sources contain coded throw sites at all
    - every throw site supplies the placeholders its message template names
    - all throw sites for one code agree on their params key names

<!-- END proof -->

### SC-LANG-007 — A refusal code never encodes its own subject

🟢 The subject travels as a value beside the code. Building a code out of the quota or the plan it is
about made the set of codes grow with every quota an installation defines, so no catalogue of
translations could ever be complete.

_Source:_ #243

### SC-LANG-008 — A refusal is identified by a stable code; only its wording may change

🟢 The code is the contract. Renaming or removing one is a breaking change; rewording its text is
not, and which group a code is listed under is presentation only.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/error-params-contract.test.js`
    - the sources contain coded throw sites at all
    - every throw site supplies the placeholders its message template names
    - all throw sites for one code agree on their params key names
- `packages/nest/tests/feature-guard.test.js`
    - StaticFeatureGuard — FEATURE_NOT_LICENSED body
        - emits the full FeatureNotLicensedBody with empty offers

<!-- END proof -->

### SC-LANG-009 — An integrator resolves their own refusals and SaaSiCat's through one mechanism

🟢 An integrator's catalogue is mostly their own text, not a re-translation of the platform's, and
resolving both through one path is the reason the mechanism exists.

_Source:_ #244

### SC-LANG-010 — Diagnostics an integrator reads are English and are not translated

🟢 Boot failures, log lines and console messages are read by the person integrating SaaSiCat, and one
language is what makes them searchable. Translating them once put the platform's internal wording
on a tenant's screen instead of the catalogue's.

_Source:_ #150 · release 0.19.0

### SC-LANG-011 — Everything that ships is written in English

🟢 Code, comments, documentation, developer-facing errors, release notes and the command-line tools.

_Source:_ #150 · release 0.22.0

### SC-LANG-012 — SaaSiCat carries no vocabulary from anybody's business

🟢 Shipped example text is neutral; an installation supplies its own wording for its own domain.

_Source:_ release 0.17.0

### SC-LANG-013 — A message says what to do next, not only what went wrong

🟢 A locked verification says to request a new code; a missing setting names the file and the field;
a refused booking names the plan and the rhythm it could not price.

_Source:_ `docs/reference/error-codes.md` · `docs/reference/options.md`
