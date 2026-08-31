---
title: Compatibility and upgrading
---

What an integrating developer may expect when they raise a version. The whole chapter is one
promise with several consequences: a break is deliberate, announced, and accompanied by whatever
can be automated — and where it cannot be automated, it is named rather than guessed at.

### SC-COMP-001 — All packages carry one version number and move together

🟢 There is no compatibility matrix to reason about; a mixed set is a misconfiguration.

_Source:_ `CONTRIBUTING.md` · `README.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/cjs-entry-identity.test.js`
    - no exported name resolves to different values across entries
    - the shared bundle actually backs every entry
    - a class is shared even between entries that never import each other
- `packages/nest/tests/di-token-registry.test.js`
    - @saasicat/nest${name ===
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
    - the guard found Vue and read every file
    - there are keys and call sites to look at
    - every injection key is created with Symbol.for
    - every key a provide/inject call names is one the declaration scan found
    - every provide/inject call site was read
    - the annotated declarations survive the tree walk
    - an annotated declaration
    - an InjectionKey reached through a local type alias (#158, shape 1)
    - same-file homonyms stay in their own scope (#158, shape 2)
    - a cast and a satisfies
    - a second declarator, and one behind type arguments
    - a .vue script block that closes with
    - a key exported from a .vue and provided from a .ts
    - a .vue script block that never closes
    - provide and inject imported under another name
    - a key imported through
    - a string key is a key, and not a missing Symbol.for
    - grouping is grouping, and a decoy is not a Symbol.for
    - an assertion may contain what a type contains
    - a key reached through a property is reported, not skipped
    - a key declared outside the tree is reported, not skipped
    - a used key that is not declared as an InjectionKey
    - a local binding spelled Symbol is not the global Symbol
    - a comment and a string are not call sites
    - somebody else
    - the token count is a second reader, not the same one
- `tests/a-dependency-is-declared-once.test.js`
    - the sweep finds the manifests
    - nothing is both a dependency and a devDependency
    - nothing is both a dependency and a peer
- `tests/consumers-dedupe-singleton-peers.test.js`
    - the peer set is non-empty and is what we think it is
    - ${relative} dedupes them
- `tests/di-tokens-share-one-namespace.test.js`
    - the scan found the tokens
    - every key starts with saasicat/&lt;package&gt;/
    - no two declarations share a key
    - reads single- and multi-line calls, and reports template literals
    - derives the prefix from the package directory
- `tests/error-identity-across-entries.test.js`
    - the two entries really do hand out separate classes
    - instanceof does not survive the split
    - the brand does, and the error keeps everything it carried
    - a foreign error is still wrapped, so the brand is not a blanket pass
    - a transport failure marked through one entry is read back through the other
    - an empty response marked through one entry is read back through the other
    - an unmarked error is not mistaken for either
- `tests/every-published-package-is-in-the-fixed-group.test.js`
    - there is exactly one fixed group
    - every publishable package is in it
    - the group names no package that does not exist
    - while in pre mode, initialVersions names every publishable package

<!-- END proof -->

### SC-COMP-002 — A break is deliberate, documented, and belongs to a release that says it is breaking

🟢 It is never something a consumer discovers from a failing build after a patch release.

_Source:_ `CONTRIBUTING.md`

<!-- BEGIN proof -->

_Tested by:_

- `tests/pre-release-mode-is-documented.test.js`
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
    - it has entries
    - every destination is on a public surface
    - every move lands on a file that exists — in this package or the one it names
    - a component that left for the tenant package is rewritten, not reported
    - a package target names a package this repository publishes
    - a primitive that moved into ui/
    - the shell, which left pages/ for layouts/ — under either old spelling
    - a page that only lost the second spelling
    - a page that was already right stays untouched
    - a domain component is recognised as unreachable
    - and it survives the rewrite untouched, so the build names it
    - a primitive is not reported — it has somewhere to go
    - a page-private part under the old alias is a removal, not a page
    - counts what it changed and leaves the rest alone
    - the whole path below it comes along
    - the emitted specifier is not prefixed with the old package
    - a subpath that merely starts with the same letters is untouched
- `packages/cli/tests/v1-rename.test.js`
    - it has entries in every section
    - every registry-key target is inside the one namespace
    - every per-entry token target is exported by that entry
    - every identifier stem resolves to the one spelling
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
    - single-line, multi-line, type-only and aliased forms
    - finishes on the input a backtracking expression would choke on
    - is reported, not rewritten to whichever import came last
    - the dependency fields are rewritten, nothing else is
    - the optional flag follows the peer it belongs to
    - a workspace or path range is reported, not guessed at
    - a manifest without the package is returned untouched
    - the specifier rewrite stops at the package boundary
- `tests/pre-release-mode-is-documented.test.js`
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
    - the only parameter takes the question mark with it
    - the first of several hands the question mark to the next
    - a later one takes its own ampersand
    - an interpolation with an ampersand inside it stays whole
    - a fragment survives the parameter in front of it
    - a call expression is simple enough to keep
    - a nested object inside the interpolation
    - a brace inside a string inside the interpolation
    - an interpolation that never closes
    - somebody else
    - and the word in one of its query values does not make it ours
    - an occurrence at the very start does not end the scan
    - the endpoint constant
    - a create body
    - a string-literal type member, which
    - an interface member
    - a bare-identifier value
    - the shorthand form, which used to pass in silence
    - a consumer
    - several are reported in the order they appear, once per line
    - is neither rewritten nor reported
    - and neither is a suffix
    - a rewrite that shortens the file does not shift the lines it reports
    - and a parameter that was removed is not also reported
    - loses the top-level key and nothing else
    - an indented key of the same name is not the top-level one
- `packages/cli/tests/v1-rename.test.js`
    - it has entries in every section
    - every registry-key target is inside the one namespace
    - every per-entry token target is exported by that entry
    - every identifier stem resolves to the one spelling
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
    - single-line, multi-line, type-only and aliased forms
    - finishes on the input a backtracking expression would choke on
    - is reported, not rewritten to whichever import came last
    - the dependency fields are rewritten, nothing else is
    - the optional flag follows the peer it belongs to
    - a workspace or path range is reported, not guessed at
    - a manifest without the package is returned untouched
    - the specifier rewrite stops at the package boundary
- `tests/codemod-stylesheet-parser.test.js`
    - a comment before the property does not hide the declaration
    - a comment between two declarations hides neither
    - a comment glued to the property name is still a comment
    - a commented-out rule contributes no declarations
    - an unterminated comment swallows the rest and nothing more
    - a comment opener inside a string opens no comment
    - an apostrophe inside a comment opens no string
    - offsets survive a comment before the declaration
    - offsets survive a comment inside the value
    - offsets survive a multi-line comment
    - a selector colon is not a property
    - a colon inside parentheses does not split the property
    - the last declaration needs no trailing semicolon
    - nesting needs no special case — @media and :deep() are just depth
    - a custom property is a declaration like any other
    - the same literal lands in different groups
    - a custom property is its own group — its readers decide its role
    - a property that paints nothing is not a colour site
    - case and padding do not change the group
    - a .css file is one block at offset 0
    - an SFC contributes one block per &lt;style&gt;, offset into the file
    - an upper-case tag is still a block
    - an end tag is read however HTML lets it be written
    - scoped and lang attributes do not hide a block
    - a template is never a site — neither its text nor its inline style
    - start/end address the literal in the original file
    - the same literal under two properties yields two different keys
    - a colour inside a comment is prose, not paint
    - a functional colour with a var() channel is a token in use, not a literal
    - sites come back in document order
    - case and inner whitespace do not make a second key

<!-- END proof -->

### SC-COMP-005 — A step no command can take is named as a step the operator takes

🟢 The change to the integrator's own database is shipped as a file they run once, and the guide says
so rather than implying the command covered it.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/codemod-project-key.test.js`
    - the only parameter takes the question mark with it
    - the first of several hands the question mark to the next
    - a later one takes its own ampersand
    - an interpolation with an ampersand inside it stays whole
    - a fragment survives the parameter in front of it
    - a call expression is simple enough to keep
    - a nested object inside the interpolation
    - a brace inside a string inside the interpolation
    - an interpolation that never closes
    - somebody else
    - and the word in one of its query values does not make it ours
    - an occurrence at the very start does not end the scan
    - the endpoint constant
    - a create body
    - a string-literal type member, which
    - an interface member
    - a bare-identifier value
    - the shorthand form, which used to pass in silence
    - a consumer
    - several are reported in the order they appear, once per line
    - is neither rewritten nor reported
    - and neither is a suffix
    - a rewrite that shortens the file does not shift the lines it reports
    - and a parameter that was removed is not also reported
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
    - it has entries
    - every destination is on a public surface
    - every move lands on a file that exists — in this package or the one it names
    - a component that left for the tenant package is rewritten, not reported
    - a package target names a package this repository publishes
    - a primitive that moved into ui/
    - the shell, which left pages/ for layouts/ — under either old spelling
    - a page that only lost the second spelling
    - a page that was already right stays untouched
    - a domain component is recognised as unreachable
    - and it survives the rewrite untouched, so the build names it
    - a primitive is not reported — it has somewhere to go
    - a page-private part under the old alias is a removal, not a page
    - counts what it changed and leaves the rest alone
    - the whole path below it comes along
    - the emitted specifier is not prefixed with the old package
    - a subpath that merely starts with the same letters is untouched
- `tests/a-promise-is-not-edited-into-another.test.js`
    - a line break is not a change
    - code formatting is not a change
    - but emphasis is, because it cannot be told from a literal
    - an identifier is read as where its chain ends
    - and swapping in an unrelated one is a change
    - the heading is part of the promise
    - an underscore inside a name is not emphasis
    - an asterisk inside a pattern is not emphasis
    - a different word is a change
    - an untouched entry is accepted
    - a rewritten promise is refused
    - a rewritten promise the commit calls editorial is accepted
    - an editorial claim for one entry does not cover another
    - a deleted entry is refused
    - a new entry beside the old one is accepted
    - superseding without touching the wording is accepted
    - rewriting the wording while superseding is refused
    - delivering a promise is not rewriting it
    - filing a delivered promise as an intention is refused
    - correcting a record that was wrong is accepted when it is claimed
    - demoting a promise to a draft is refused
    - deciding a draft is accepted
    - dropping a draft is accepted
    - a withdrawn promise coming back is refused
    - a rewrite in the resolution is reported
    - a deletion in the resolution is reported
    - what came in from the other branch is not
    - what this branch had already done is not
    - a parent that never had the entry does not acquit it
    - the parent that notices need not be the first
    - an entry that only arrived with one parent is left alone
    - the parser produces exactly the fields the guard has decided about
    - nothing is in both lists
    - the sweep is looking at a real entry
    - a successor that already existed is refused
    - a successor introduced by the same change is accepted
    - a supersession that was already there is left alone
    - but retargeting one that was already there is refused
    - a withdrawal naming where the ground is covered is accepted
    - a claim covers the step that carries it
    - and does not reach the step after it
    - the same two edits pooled into one step would pass
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
    - reads name, type and modifiers, skips attributes and comments
    - reads single-line model blocks
    - reads members and ignores attributes
    - reads members sharing one line
    - separates models from enums
    - commented-out relations are not fields
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
    - identical attributes produce no finding
    - a missing index is reported but does not fail the check
    - a missing unique constraint fails the check
    - a diverging @@map fails the check and names both sides
    - whitespace and attribute options do not create false findings
    - extra consumer indexes are not reported
    - a commented-out @@unique or @@map counts as absent, not present
    - a brace inside a string default does not close the model early
    - a // inside a string literal is not treated as a comment
    - indexed field arguments are parsed past their parentheses
    - @@map survives the comment strip
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
    - ${genFile} is in sync with ${file}
- `packages/spec/tests/openapi-version-is-the-package-version.test.js`
    - the OpenAPI document carries the version this package publishes
- `tests/dist-is-self-contained.test.js`
    - every package that builds was swept
    - ${pkg.name}: the export map names entry points that exist
    - ${pkg.name}: every export target the manifest commits to is on disk
    - ${pkg.name}: every relative reference inside dist/ resolves
    - ${pkg.name}: no emitted file is unreachable
- `tests/export-map-matches-filesystem.test.js`
    - the sweep finds the packages it claims to check
    - ${pkg.name}: exports its own package.json
    - ${pkg.name}: every non-wildcard target exists
    - ${pkg.name}: every wildcard pattern resolves to something
    - ${pkg.name}: a require condition never hands out an ESM .d.ts
    - ${pkg.name}: files[] covers every exported path
    - no NEW subpath duplicates a target
- `tests/openapi-covers-the-implementation.test.js`
    - both sweeps reach what they claim to read
    - every admin route the platform serves is documented
    - every documented operation is served by the platform or declared app-served
    - nothing is marked app-served that the platform actually serves
    - a controller with a computed path says which document covers it
- `tests/public-options-name-only-what-we-publish.test.js`
    - the sweep found the components and their interfaces
    - every Quasar type in an exported interface is re-exported
- `tests/vue-entry-is-complete.test.js`
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
    - reads the live value, not the commented-out one above it
    - follows extends to a base config that sets the old resolution
    - a local value overrides the inherited one
    - returns null when nothing in the chain sets it
    - returns null for a config TypeScript cannot parse, or none at all
    - accepts the three kinds that resolve subpath exports, and unset
    - refuses node10 and classic, naming the setting the reader knows it by
- `packages/create-saasicat-admin/tests/scaffold-typechecks.test.js`
    - vue-tsc accepts the templates as written
- `packages/ui-vue/tests/component/sfc-compiles.test.ts`
    - the sweep finds the files it claims to check
    - no file fails the SFC compiler

<!-- END proof -->

### SC-COMP-010 — An integrator's own data access translates; it does not decide

🟢 Domain rules live above the storage layer, which is what keeps two implementations
interchangeable. An implementation that decides something — filtering on its own, defaulting a
status — moves a rule to where the other one does not have it.

_Source:_ ADR 0007

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/drizzle-adapters.test.js`
    - table names match the canonical @@map names
    - camelCase column names are preserved (no snake_case mapping)
    - instance db → ready instances; declared capabilities
    - token db → factory specs injecting the token
    - hasher instance + instance db enables provisioning
    - transaction runner passes the drizzle tx through as context
- `packages/adapter-prisma/tests/prisma-adapters.test.js`
    - secret roundtrip incl. enabledAt handling
    - write maps actor to userId + actorTag on audit_logs
    - write without changes defaults to {}
    - maps wildcard actorTag, pagination and row → AuditEntry
    - isBypassActive only inside runWithBypass
    - run passes the interactive tx client through as context
    - findByTenantId maps row + plan version to SubscriptionRecord
    - findByTenantIdLocked takes the FOR UPDATE lock inside the tx
    - countByPlanVersionId uses a single OR count
    - countActiveByPlanKey aggregates by authoritative PlanVersion identity
    - maps the canonical subscription to the tenant billing display form
    - findLatestLive filters live versions and maps the record
    - claimSlot issues the atomic guarded UPDATE
    - releaseSlot floors at 0 and reactivates EXHAUSTED
    - create normalizes the code and serializes decimals
    - findByCode hides soft-deleted codes
    - update persists every field editable in the Admin promo page
    - expireDueCodes targets ACTIVE/PAUSED with validUntil &lt; now
    - create maps defaults and double redemption rejects
    - createSuperAdmin hashes the password and lowercases the email
    - duplicate email throws PlatformUserExistsError
    - upsertPlanVersion is idempotent and supersedes older live versions on publish
    - loadSnapshot maps rows to wire formats with ISO dates and defaults
    - bundle.validityWindows reaches the catalog bundle repository
    - bundle.validityWindows reaches the entitlement bundle repository too
    - defaults to the 0.6-compatible behavior when omitted
    - token client → factory specs injecting the token
    - instance client → ready instances; hasher instance enables provisioning
    - token client + hasher token → provisioning factory injecting both
- `packages/core/tests/canonical-rows-become-records.test.js`
    - dates leave as ISO strings, and an undeleted plan says so
    - a soft-deleted plan carries the date it was deleted on
    - the plan key is the one passed, not the one on the row
    - prices survive as strings, whatever the driver handed over
    - a schema without validity windows reads them as null, not as dates
    - a schema without endsAt omits the field rather than saying null
    - publishedChanges that is not an array reads as null
    - features and quotas drop entries of the wrong type
    - a JSON column holding nothing usable reads as empty, not as a crash
    - dates stay Date objects — a contract record is not a wire format
    - the lines it is handed become its lines
    - an entitlement snapshot that is not an object reads as null
    - snapshot arrays that are not arrays read as empty
    - terms that are not an object read as null
    - money becomes a number, from a string or from a Decimal
    - the commitment date and the metadata survive both ways round
    - a features snapshot of mixed types keeps only the strings
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

- `packages/adapter-drizzle/tests/the-query-map-describes-the-real-tables.test.js`
    - there is more than one, so a broken scan cannot pass by finding none
    - ${table} declares exactly the canonical columns
- `packages/adapter-prisma/tests/prisma-adapters.test.js`
    - secret roundtrip incl. enabledAt handling
    - write maps actor to userId + actorTag on audit_logs
    - write without changes defaults to {}
    - maps wildcard actorTag, pagination and row → AuditEntry
    - isBypassActive only inside runWithBypass
    - run passes the interactive tx client through as context
    - findByTenantId maps row + plan version to SubscriptionRecord
    - findByTenantIdLocked takes the FOR UPDATE lock inside the tx
    - countByPlanVersionId uses a single OR count
    - countActiveByPlanKey aggregates by authoritative PlanVersion identity
    - maps the canonical subscription to the tenant billing display form
    - findLatestLive filters live versions and maps the record
    - claimSlot issues the atomic guarded UPDATE
    - releaseSlot floors at 0 and reactivates EXHAUSTED
    - create normalizes the code and serializes decimals
    - findByCode hides soft-deleted codes
    - update persists every field editable in the Admin promo page
    - expireDueCodes targets ACTIVE/PAUSED with validUntil &lt; now
    - create maps defaults and double redemption rejects
    - createSuperAdmin hashes the password and lowercases the email
    - duplicate email throws PlatformUserExistsError
    - upsertPlanVersion is idempotent and supersedes older live versions on publish
    - loadSnapshot maps rows to wire formats with ISO dates and defaults
    - bundle.validityWindows reaches the catalog bundle repository
    - bundle.validityWindows reaches the entitlement bundle repository too
    - defaults to the 0.6-compatible behavior when omitted
    - token client → factory specs injecting the token
    - instance client → ready instances; hasher instance enables provisioning
    - token client + hasher token → provisioning factory injecting both
- `packages/cli/tests/migration-constraints.test.js`
    - the one that appeared between the two listings
    - nothing new means nothing to append to, even with migrations present
    - directories that are not migrations are not candidates
    - the newest of several, when a run somehow produced two
    - no migrations at all is not an error, it is nothing to do
    - the statements land after the tables
    - it says where the copy came from
    - running it twice appends once
    - a migration that already has them is recognised
    - a migration without a trailing newline still gets a separating one
    - reads the table off each statement
    - keeps the ones whose table is present
    - keeps everything when every table is present
    - a statement it cannot read is kept, not dropped
    - nothing applicable appends nothing at all
    - only a failure stops the command
    - a failure says where the SQL is, because the operator now needs it
    - nothing to append is not a failure
    - every outcome carries a message and a decision
- `packages/core/tests/canonical-rows-become-records.test.js`
    - dates leave as ISO strings, and an undeleted plan says so
    - a soft-deleted plan carries the date it was deleted on
    - the plan key is the one passed, not the one on the row
    - prices survive as strings, whatever the driver handed over
    - a schema without validity windows reads them as null, not as dates
    - a schema without endsAt omits the field rather than saying null
    - publishedChanges that is not an array reads as null
    - features and quotas drop entries of the wrong type
    - a JSON column holding nothing usable reads as empty, not as a crash
    - dates stay Date objects — a contract record is not a wire format
    - the lines it is handed become its lines
    - an entitlement snapshot that is not an object reads as null
    - snapshot arrays that are not arrays read as empty
    - terms that are not an object read as null
    - money becomes a number, from a string or from a Decimal
    - the commitment date and the metadata survive both ways round
    - a features snapshot of mixed types keeps only the strings
- `packages/nest/tests/saasicat-persistence.test.js`
    - standard adapters
        - SubscriptionPlanResolver only grants active subscriptions
        - QuotaProvidersUsageSnapshot reuses every quota counter
- `packages/spec/tests/reference-sql-drift.test.js`
    - prisma-fragments compose and reference-schema.postgres.sql is in sync
    - normative constraints are part of the reference schema
    - bundle validity windows and their lookup index are in the reference schema
    - plan-version validity, termination and lookup index are in the reference schema

<!-- END proof -->

### SC-COMP-012 — Where one implementation cannot do what another can, the gap is recorded

🟢 Deliberately, rather than widened quietly and discovered by whoever chose the lagging one.

_Source:_ ADR 0007

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/drizzle-adapters.test.js`
    - table names match the canonical @@map names
    - camelCase column names are preserved (no snake_case mapping)
    - instance db → ready instances; declared capabilities
    - token db → factory specs injecting the token
    - hasher instance + instance db enables provisioning
    - transaction runner passes the drizzle tx through as context
- `packages/adapter-drizzle/tests/every-exported-class-reaches-the-factory.test.js`
    - names enough exports for this check to mean anything
    - ${name} is reachable through drizzlePersistence()
- `packages/nest/tests/an-adapter-without-a-plan-catalogue-can-sell-bundles.test.js`
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
    - every commented relation to Tenant or User
    - prose that merely mentions @relation is not one
    - a relation to something else is left alone
    - both targets, renamed to the app models
    - naming only the tenant leaves the user relations commented, and says so
    - naming nothing changes nothing
    - the column alignment the fragment chose survives
    - running it twice is a no-op — there is nothing left to uncomment
    - a missing opposite field stops the pointer, and names the line to add
    - the relation NAME is part of the question
    - relationNameOf reads the name, and only a name
    - hasBackRelation matches on type and name together
    - and listing what the schema does declare
    - a name that does exist passes
    - naming nothing passes
    - every commented FK pointer in them is one this recognises
    - a unique foreign key is recognised as one-to-one
    - the foreign key is read off the relation attribute
    - a singular opposite field counts as the back relation
    - so the pointer is enabled rather than reported as missing
    - and when it IS missing, the suggestion is singular too
    - a name full of metacharacters matches nothing rather than everything
    - and the same through hasBackRelation directly
    - a field name with an alternation does not match a different field
    - an ordinary name still works, so the escaping did not break matching
- `packages/nest/tests/a-preview-answers-on-an-older-schema.test.js`
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

- `tests/the-example-sends-the-role-its-guards-require.test.js`
    - the guard still names roles
    - ${label} assigns the role header
    - ${label} assigns a role the guard accepts
- `tests/tutorials-match-the-example.test.js`
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
