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
    - error when no plans
    - ok with plans + details contain planIds
    - warning when snapshot empty
    - ok with content
    - ok when findByEmail does not throw
    - error when findByEmail throws
    - ok with standardPages count
    - error when getManifest throws
    - contains exactly 4 provider classes
- `packages/cli/tests/doctor-flow.test.js`
    - all checks ok → overall=ok, exitCode=0
    - one warning + ok → overall=warning, exitCode=0
    - one error → overall=error, exitCode=4
    - exception in check → severity=error with exception message
    - empty check list → overall=ok
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
    - warns when no plan resolver and no fallback plan are configured
    - stays silent once defaultPlanId activates the static entitlement stack
    - registers the coverage check instead of warning on the option alone
    - stays silent on the default path with the guard bound
    - the inert branch registers the check too, with the state that says so

<!-- END proof -->

### SC-CFG-008 — An operator can see when the running configuration was applied, and from where

🟡 _(Decided, not yet delivered.)_ Somebody who edited the file an hour ago otherwise has no way to
tell whether it has landed. The timestamp is the requirement, not decoration.

_Source:_ #217

### SC-CFG-009 — A configuration change is noticed and reported

🟡 _(Decided, not yet delivered.)_ The record inside the application is unconditional; notifying
people by mail is an addition, never a substitute. An address list that silently swallowed the
notification because nobody wired mail would be worse than having neither.

_Source:_ #217

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
    - inert entitlement plus an annotated route: boot fails
    - globalFeatureGuard: false plus an unguarded annotated route: boot fails
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
    - the minimum is seven files, one of them a quota provider
    - each quota adds one provider, named after its key
    - --skip-hasher drops the hasher and keeps the persistence bundle
    - with a hasher the bundle wires it
    - no file goes out with an unsubstituted token
    - every template is reachable through some plan
    - a multi-word key still produces valid identifiers
    - the quota model becomes the Prisma delegate, not the model name
    - a quota without a model counts a delegate named after the key
    - the case helpers round-trip the shapes the plan relies on
    - quotas land under both plans, at different limits
    - there is no such thing as a plan without quotas
    - nothing has a trailing space
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
    - a generated persistence bundle is an imported one
    - the admin module import path matches the file the plan writes
    - each quota provider import path matches its file
    - the block names one, so the file does not compile without it
    - the block names the modules the platform resolves from, for the same reason
    - and says why, where the reader is
    - is refused before anything is planned
    - and a valid one still plans
    - the message carries the pattern rather than a paraphrase of it
    - the quota key pattern is the schema
    - the minimum number of quotas is the schema
    - the classes get identifiers, the catalogue keeps the words
    - and the file names follow the identifier, not the label
    - every generated class name is a valid identifier
    - for a camel-cased key, where the two used to disagree
    - and for every spelling the schema allows
    - stays intact, and the new imports go after it
    - and a side-effect import is an import too, so nothing lands above it
- `packages/create-saasicat-admin/tests/scaffold.test.js`
    - positionals + flags + tokens are separated
    - replaces only tokens, passes other **X** strings through
    - finds all .tpl files under templates/
    - writes all templates into target + replaces tokens
    - dryRun writes nothing
    - runs through a bin symlink, as npm create / npx invoke it
- `tests/a-generated-admin-imports-every-stylesheet.test.js`
    - the export map still publishes stylesheets
    - ${label} imports all of them
    - ${label} loads the theme after Quasar
    - ${label} takes them from this package, not from Quasar
- `tests/templates-import-what-exists.test.js`
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
    - names every command
    - and every
    - an unknown command exits 1 rather than doing nothing
    - a model the app never adopted is reported, and is not an error
    - a field removed from an adopted model is drift, and exits 1
    - and says nothing is missing once the fragments are applied
    - a schema that does not exist is an error, not a stack trace
    - appends the selected fragments and says which
    - the enums a fragment declares arrive with its models
    - running it twice appends nothing the second time
    - a fragment selector that matches nothing is refused
    - without --name it says so instead of guessing one
    - --dry-run stops before Prisma, and says that it did
    - scaffolds the wiring, patches the module, and names the next steps
    - refuses to overwrite what is already there
    - a tsconfig on the old moduleResolution is refused before any write
    - a moduleResolution inherited through extends is refused too
    - a key the generated files would refuse is refused here, before any write
    - without a key it says which flag is missing
    - --dry-run lists the files and writes none of them
    - rewrites what moved and leaves the rest alone
    - names what no longer has a home rather than guessing one
    - --dry-run reports without writing
    - it does not walk into node_modules or dist
    - takes the key out of saas.yaml and the query, and reports the schema
    - is idempotent, like the other two
    - rewrites the four kinds of name and leaves the rest alone
    - reports the token it cannot decide, and leaves it
    - --dry-run reports and writes nothing
    - the package rename reaches package.json, under its own indentation
    - a second run has nothing left to do
    - runs the import rewrite and the rename, in that order
- `packages/cli/tests/init.test.js`
    - the minimum is seven files, one of them a quota provider
    - each quota adds one provider, named after its key
    - --skip-hasher drops the hasher and keeps the persistence bundle
    - with a hasher the bundle wires it
    - no file goes out with an unsubstituted token
    - every template is reachable through some plan
    - a multi-word key still produces valid identifiers
    - the quota model becomes the Prisma delegate, not the model name
    - a quota without a model counts a delegate named after the key
    - the case helpers round-trip the shapes the plan relies on
    - quotas land under both plans, at different limits
    - there is no such thing as a plan without quotas
    - nothing has a trailing space
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
    - a generated persistence bundle is an imported one
    - the admin module import path matches the file the plan writes
    - each quota provider import path matches its file
    - the block names one, so the file does not compile without it
    - the block names the modules the platform resolves from, for the same reason
    - and says why, where the reader is
    - is refused before anything is planned
    - and a valid one still plans
    - the message carries the pattern rather than a paraphrase of it
    - the quota key pattern is the schema
    - the minimum number of quotas is the schema
    - the classes get identifiers, the catalogue keeps the words
    - and the file names follow the identifier, not the label
    - every generated class name is a valid identifier
    - for a camel-cased key, where the two used to disagree
    - and for every spelling the schema allows
    - stays intact, and the new imports go after it
    - and a side-effect import is an import too, so nothing lands above it

<!-- END proof -->
