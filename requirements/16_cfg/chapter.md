---
title: Configuring and running an installation
---

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

### SC-CFG-025 — The installation records the configuration it applied, and notices when it changed

🟢 At every start the platform fingerprints the settings it is running on — the resolved values, not
the file's text, so a variable that moved in production is a change — and compares them with the
record of the last start. No record: written. Same fingerprint: nothing happens, which is what almost
every start is. Different: the record is replaced, and what changed is written down beside it, with
both values of every leaf that moved. The fingerprint covers the settings and not the catalogue: a
plan added to the file is not a configuration change. An installation whose data access keeps no
record runs the configuration all the same, and says so once, at start.

_Source:_ #260 · #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/settings-subtree.test.js`
    - the settings subtree
        - is the catalogue without its plans, features and format marker
        - a block left out of the file is left out of the subtree, not written as undefined
        - every excluded name is a property the schema declares
        - a block the schema gains is a setting until somebody says otherwise
    - the difference between two settings subtrees
        - is empty for the same values in another order
        - names each changed leaf by its dotted path, with both sides
        - a list that changed is one difference, not one per element
        - a leaf that appeared or vanished is reported with undefined on the missing side
- `packages/nest/tests/a-boot-records-what-it-applied.test.js`
    - the three states a boot can find the record in
        - no record: the first boot writes one, and the log says so
        - same fingerprint: the record is left alone, and nothing is said
        - different fingerprint: the record is replaced and the difference written down
        - a change that cannot be written leaves the record alone, so the next start notices again
        - a plan added to the catalogue is not a settings change
    - an installation whose adapter keeps no record
        - boots, says so once, and answers the endpoint without a record
        - a failing port does not take the boot down, and the log names the file

<!-- END proof -->

### SC-CFG-026 — The record of the applied configuration is a mirror, never a source

🟢 💰 Nothing reads it to decide behaviour. A record that disagrees with the file changes nothing about
what runs — the file is the one place a setting lives — and the disagreement is what the next start
records as a change. Held two ways: a start against a record that says otherwise runs on the file's
values, and no code outside the record's own module and its wiring reaches for the port.

_Source:_ #260 · #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-boot-records-what-it-applied.test.js`
    - the record is a mirror, never a source
        - a record that disagrees with the file changes nothing about what runs
- `packages/nest/tests/the-record-is-a-mirror.test.js`
    - the applied-settings port
        - the scan sees the wiring, so an empty result is not a broken scan
        - is reached from the record and its wiring, and from nowhere else
        - every wiring exemption is still there to be exempted
        - the record itself never reads a setting out of what it stored

<!-- END proof -->

### SC-CFG-027 — The record says where the values came from

🟢 The absolute path of the file the platform read, or a sentence saying the values were handed to it
in code, where no path exists to name: an object passed as `planCatalog`, or the `dbCatalog` block.
The platform does not invent a path it did not read.

_Source:_ #260

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-boot-records-what-it-applied.test.js`
    - where the record says the values came from
        - the absolute path of the file the platform read
        - a catalogue built in code says so rather than inventing a path

<!-- END proof -->

### SC-CFG-028 — There is one record per installation

🟢 The row's identity is the installation's, because one installation serves one application and owns
its database. A second row cannot be written — the database refuses it, not the code — and a start
replaces the one row rather than adding to it. A notice period negotiated per tenant would be a
different table, not a second row here.

_Source:_ #260

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-applied-settings.repository.test.js`
    - the one row
        - is keyed on the installation id, on create and on update alike
        - reads back what was written, and null before anything was
        - a JSON column that is not an object reads as no settings, not as a crash
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - the applied settings hold one row, and the database is what holds them to it
        - a second id is refused by the constraint, on the reference schema
        - and on a database that gained the tables from the migration alone

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
