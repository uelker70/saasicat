---
title: Working in the interface
---

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
    - renders the title as the page heading
    - omits the subtitle and the actions bar when neither is supplied
    - renders a markup subtitle through the slot
    - names the section by pointing aria-labelledby at its own heading
    - gives sibling sections distinct heading ids
    - renders no heading level above h2
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
    - the sweep reaches the pages it claims to check
    - no page reaches for Quasar directly
    - no page redeclares the frame the theme draws
    - a page imports only from the layers below it
    - no primitive hard-codes a user-visible string
    - no file grows past the budget for its layer
- `packages/ui-vue/tests/pages-take-no-callbacks.test.js`
    - the guard reads every page in
    - no prop in
    - the one exception says why, in its own source
    - an inline callback prop
    - a callback hidden behind a type alias — what a pattern cannot see
    - a sixth prop
    - an exception tag with no real reason
    - a declared exception passes
- `tests/baselines-record-a-page-at-rest.test.js`
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
    - positionals + flags + tokens are separated
    - replaces only tokens, passes other **X** strings through
    - finds all .tpl files under templates/
    - writes all templates into target + replaces tokens
    - dryRun writes nothing
    - runs through a bin symlink, as npm create / npx invoke it
- `packages/ui-vue/tests/component/route-mounted-pages.test.ts`
    - ${name} declares no required props
    - ${name} mounts with no props and without Vue warnings
    - the roster covers every page create-admin-routes mounts directly
    - boots into a guarded route rather than reloading the public error route
    - discards the cached manifest before booting, not after
    - its buttons are wired to handlers, never to a possibly-undefined prop
- `packages/ui-vue/tests/pages-barrel-is-complete.test.js`
    - there are pages to compare
    - every page on disk is in the barrel
    - every entry in the barrel is a page on disk
    - each name matches the file it loads
    - there are routes to check
    - each names a page the barrel maps
    - no two routes answer the same path
    - the error page is not among them
- `packages/ui-vue/tests/pages-read-the-params-their-routes-declare.test.js`
    - the table was read at all
    - every parameterised route is answered by a page that reads it
    - a mismatched read is reported
    - a read written across lines counts
    - a bracketed read counts
    - the path parser finds the parameter

<!-- END proof -->

### SC-UI-003 — Replacing one operation that does not exist is refused at start-up

🟢 With the list of the ones that do. A typo in an override is otherwise a call that quietly keeps
the old behaviour until somebody notices an approval was never recorded.

_Source:_ release 0.26.0

### SC-UI-004 — Nothing is written until the person saves or publishes

🟢 Editors keep unsaved work across the steps of a wizard, and a step only moves on when the save
actually succeeded — a rejected save used to look exactly like a successful one.

_Source:_ release 1.0.0-rc.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/bundles-page-owns-what-it-saves.test.ts`
    - each plan maps to its live version
    - an edited label shows in the row the page owns
    - a saved version reaches the aggregate map the KPIs read
- `packages/ui-vue/tests/component/clearable-fields.test.ts`
    - the sweep finds the fields it claims to check
    - no clearable model has a string method called on it unguarded
- `packages/ui-vue/tests/component/discovery-page-keeps-the-first-edit.test.ts`
    - the second payload still holds the first edit
- `packages/ui-vue/tests/component/plan-wizard-keeps-its-draft.test.ts`
    - the editor writes what was typed into the wizard, not into the page
    - the review renders the unsaved values, not the published version
    - the draft outlives the navigation between the two steps
    - cancelling clears the draft rather than leaving it for the next plan
    - a refused save keeps the draft and stays on the step
    - a save that succeeds clears the draft
    - publish carries the form and the checklist flags
    - a publish that does not go through keeps the draft

<!-- END proof -->

### SC-UI-005 — A failure appears where the person was looking

🟢 A page that could not load says so under its title; an action that failed inside an open dialog
says so in the dialog; only a failure with nothing on screen to attach to becomes a notification.
Never a notification for a failed load, and never one for something already visible.

_Source:_ `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/admin-error.test.js`
    - defaults to status 0 — a request that never produced one
    - the diagnostic message names the request, the status and the code
    - the diagnostic carries the detail when there is one
    - an explicit message overrides the derived one
    - cause is preserved
    - recognises an instance
    - rejects a plain error, a look-alike object, and nothing at all
    - recognises what a throw site marked, and nothing else
    - the marker is not enumerable, so it does not leak into a log line
    - recognises what a client marked, and nothing else
    - marking a non-object is a no-op rather than a second failure
    - the marker is not enumerable, so it does not leak into a log line
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
    - a null dereference is not a connection problem
    - a real fetch failure still says
    - a malformed URL is a transport failure too, not an unknown one
    - the client passes a response through untouched
    - a consumer error carrying a status keeps its message
    - a consumer error merely NAMED like ours is still a consumer error
    - a mutation the server answered without a body is an empty response
    - a boot GET a client resolved as status 0 never reached the server
    - a manifest GET a client resolved as status 0 never reached the server
    - nor did a mutation a client resolved as status 0 — on any of the surfaces
    - a discovery load a client resolved as status 0 never reached the server
    - a plain object keeps the message it carries
    - an Error from another realm is such an object
    - an object with nothing readable falls through to the generic wording
    - a non-string message is not a message
    - what the failing side said outranks anything the platform could guess
    - maps the statuses that have their own wording
    - any other status falls through to the generic template, with the number in it
    - a failure nothing knows anything about says so, rather than blaming the network
    - a seam that declares the request never went out gets the network wording
    - converts before formatting, so an axios rejection needs no pre-processing
    - German is a complete alternative, not a fallback to English
    - the two names are one class, so an existing instanceof check keeps working
    - a non-2xx carries status, code, detail, url and method
    - postJson reports its own method
    - an error body that is not JSON does not become a second failure
    - a validation rejection keeps its constraints — the array is joined here too
    - a 2xx still returns the parsed body
    - an AdminError carries it at
    - an axios rejection carries it at
    - anything else has none
- `packages/ui-vue/tests/component/error-state-outranks-the-accent.test.ts`
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
    - defaults to status 0 — a request that never produced one
    - the diagnostic message names the request, the status and the code
    - the diagnostic carries the detail when there is one
    - an explicit message overrides the derived one
    - cause is preserved
    - recognises an instance
    - rejects a plain error, a look-alike object, and nothing at all
    - recognises what a throw site marked, and nothing else
    - the marker is not enumerable, so it does not leak into a log line
    - recognises what a client marked, and nothing else
    - marking a non-object is a no-op rather than a second failure
    - the marker is not enumerable, so it does not leak into a log line
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
    - a null dereference is not a connection problem
    - a real fetch failure still says
    - a malformed URL is a transport failure too, not an unknown one
    - the client passes a response through untouched
    - a consumer error carrying a status keeps its message
    - a consumer error merely NAMED like ours is still a consumer error
    - a mutation the server answered without a body is an empty response
    - a boot GET a client resolved as status 0 never reached the server
    - a manifest GET a client resolved as status 0 never reached the server
    - nor did a mutation a client resolved as status 0 — on any of the surfaces
    - a discovery load a client resolved as status 0 never reached the server
    - a plain object keeps the message it carries
    - an Error from another realm is such an object
    - an object with nothing readable falls through to the generic wording
    - a non-string message is not a message
    - what the failing side said outranks anything the platform could guess
    - maps the statuses that have their own wording
    - any other status falls through to the generic template, with the number in it
    - a failure nothing knows anything about says so, rather than blaming the network
    - a seam that declares the request never went out gets the network wording
    - converts before formatting, so an axios rejection needs no pre-processing
    - German is a complete alternative, not a fallback to English
    - the two names are one class, so an existing instanceof check keeps working
    - a non-2xx carries status, code, detail, url and method
    - postJson reports its own method
    - an error body that is not JSON does not become a second failure
    - a validation rejection keeps its constraints — the array is joined here too
    - a 2xx still returns the parsed body
    - an AdminError carries it at
    - an axios rejection carries it at
    - anything else has none

<!-- END proof -->

### SC-UI-007 — Loading, empty and error are handled deliberately on every screen

🟢 Through the same shared elements rather than a variant per page.

_Source:_ `docs/explanation/design-guide.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/list-resource.test.js`
    - the three spellings of
    - the falsy values that are answers are not
    - always states its page, first and in order
    - appends to an endpoint that already carries a query
    - serialises the filter after the pagination, in insertion order
    - omits the empty values and keeps the falsy ones
    - encodes with URLSearchParams — a space is a plus, not %20
    - is empty when nothing survives the rule
    - leads with a question mark when something does
    - a bare array reports the rows it sent
    - an envelope is read field by field
    - what the answer did not state stays absent
    - a body that is neither is an empty page, not a crash
    - an
    - a page below the first is the first
    - a fractional page is the one it is on
    - a page size stays inside 1..max

<!-- END proof -->

### SC-UI-008 — Equivalent actions behave the same everywhere

🟢 Delete, save, cancel, edit, back, filter, search, pagination, confirmation and validation errors
work the same way on every screen unless there is a stated reason not to.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/pages-take-no-callbacks.test.js`
    - the guard reads every page in
    - no prop in
    - the one exception says why, in its own source
    - an inline callback prop
    - a callback hidden behind a type alias — what a pattern cannot see
    - a sixth prop
    - an exception tag with no real reason
    - a declared exception passes

<!-- END proof -->

### SC-UI-009 — A destructive action says what it will destroy, by name

🟢 Not "Are you sure?" but "Delete API key 'Production Integration'? This action cannot be undone."

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/ui-confirm-port.test.ts`
    - carries the wording the page wrote, not a generic
    - a destructive action is coloured as one
    - tone defaults to primary — only the caller may call something destructive
    - both buttons are labelled, so neither reads
    - no prompt means no input — a plain confirm stays plain
    - a prompt carries its initial value and type
    - a prompt with no initial value starts empty and takes text
    - an app-provided port is the one that gets asked
    - without one, the Quasar implementation is the fallback — which still asks
    - a context from an older package version still resolves, because the key is Symbol.for

<!-- END proof -->

### SC-UI-010 — An action sits with the object it acts on

🟢 "Publish this version" does not share a footer with "delete this bundle and every version of it".
One releases a draft; the other destroys the thing.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/bundle-actions-belong-to-their-object.test.ts`
    - save and publish share one bar
    - discard stays with the draft state that offers it
    - nothing spans both columns any more
    - soft-delete is not among the version actions
    - it sits in the card header, named for a reader who cannot see icons
    - it is not a button inside a button
    - deleting does not also expand the row it removes
    - the confirm port decides, and window.confirm is never called
    - a pristine form offers nothing to save
    - an edit shows the marker and enables the button
- `packages/ui-vue/tests/component/one-dialog-per-page-not-per-row.test.ts`
    - the fixture renders several rows — without that this proves nothing
    - one instance exists, however many rows there are

<!-- END proof -->

### SC-UI-011 — A list says how many rows there are, or says it is showing what it received

🟢 It does not present the number of rows in hand as a total it cannot know.

_Source:_ release 0.26.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/typed-lists-carry-their-row-type.test.ts`
    - hands a page its rows already typed, with no assertion at the call site
    - refuses the resources and operations that cannot answer with a page
- `packages/ui-vue/tests/list-resource.test.js`
    - the three spellings of
    - the falsy values that are answers are not
    - always states its page, first and in order
    - appends to an endpoint that already carries a query
    - serialises the filter after the pagination, in insertion order
    - omits the empty values and keeps the falsy ones
    - encodes with URLSearchParams — a space is a plus, not %20
    - is empty when nothing survives the rule
    - leads with a question mark when something does
    - a bare array reports the rows it sent
    - an envelope is read field by field
    - what the answer did not state stays absent
    - a body that is neither is an empty page, not a crash
    - an
    - a page below the first is the first
    - a fractional page is the one it is on
    - a page size stays inside 1..max

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
    - each tone brings its own icon, so the shape differs before the hue does
    - an explicit
    - the close button is only there when the caller asked for it
    - a null error renders nothing at all — no empty box above the body
    - a rejection becomes a sentence, not
    - retry is offered only when there is something to retry
    - a failed submit keeps the dialog open and shows the reason
    - a successful submit closes it and says so once
    - typing the wrong name leaves the confirming button unusable
    - the typed answer does not survive a reopen
    - a hidden action is not rendered — a row shows what it is eligible for
    - a disabled action stays visible, so the row does not change shape
    - the error is announced, and it replaces the hint rather than joining it
    - the slot is handed the id to point
    - the end group is pushed away from the start one, not centred
    - with no end content there is no empty end group to space against
    - sticky is opt-in — a toolbar that follows the scroll is a decision
    - the column count reaches the DOM, because the layout is CSS
    - a field carries its span, so one wide input can sit in a narrow grid
    - the title is the message; description and actions are optional
    - inline and block are different treatments, not the same one twice
    - the tone is a class, so the theme decides what it looks like
    - the label is always there — colour never carries the status alone
- `tests/px-to-scale.test.js`
    - an exact value takes its own token
    - a midpoint rounds down
    - a value nearer one rung takes it, up or down
    - radii use their names, not their numbers
    - a negative keeps its sign in a calc
    - tracking is converted rather than snapped
    - a property no scale answers for
    - a declaration that already reads a token
    - a token definition
    - every value in a shorthand moves together
    - a zero stays a zero
    - touches declarations and nothing else

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
    - No composable/loader has
    - useTenants() WITHOUT the endpoint option throws with a clear error message
- `packages/ui-vue-tenant/tests/component/tenant-primitives.test.ts`
    - it renders a native button that does not submit
    - an accessible name from the call site lands on the button itself
    - a click listener from the call site reaches the button
    - the two axes are independent
    - loading disables the button and marks it busy
    - the ring is added beside the label, not instead of it
    - a disabled button is not a busy one
    - the default animation turns
    - a reduce block replaces the turn for the spinner
- `tests/the-tenant-package-needs-no-quasar.test.js`
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

- `tests/a-generated-admin-imports-every-stylesheet.test.js`
    - the export map still publishes stylesheets
    - ${label} imports all of them
    - ${label} loads the theme after Quasar
    - ${label} takes them from this package, not from Quasar
- `tests/quasar-colours-resolve-to-the-theme.test.js`
    - the sources actually paint Quasar colours
    - no page paints a Quasar palette rung the theme cannot move
    - every painted colour is one the platform decides
    - the neutral greys do not grow
    - every linked tone is a role the theme declares
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
    - it lands on the document element, not the body
    - an app that names no colour leaves the variable alone
    - the colour is also handed to the components as part of the brand
    - a shell that set a colour removes it again
    - a host value marked !important keeps its priority
    - our own writes claim no priority of their own
    - a value the host set itself is put back, not deleted
    - a shell that named no colour touches nothing on the way out
    - the accent role reads Quasar’s variable
    - the shell writes no status colour of its own
    - the theme hands Quasar the filled role, in both schemes
- `packages/ui-vue/tests/design-token-budget.test.js`
    - the audit reaches the source tree
    - the inline-style sweep reads a fixture it cannot miss
    - a CSS-wide keyword is not a typographic value
    - a palette prop counts on a Quasar component and nowhere else
    - ${metric} does not grow (floor ${floor} — ${why})
    - ${metric} baseline has not overshot its floor
- `packages/ui-vue/tests/identity-accents-match-theme.test.js`
    - the resolver reaches a hex at all
    - both halves are the same length
    - every stored value is what its role resolves to in the light theme
    - the neutral matches too
    - every hex in the file is one of the ramp values
    - ${label} is concrete, not a token reference
    - ${label} fits the promotion column
- `packages/ui-vue/tests/login-branding.test.js`
    - a complete boot response is used as-is
    - production is not shown as an environment badge
    - ${name}: falls back instead of throwing
    - without boot and without app branding the card still renders
    - empty strings from boot do not blank the card
    - true only for an explicit production environment
    - a malformed payload is not treated as production
    - other environments are not production
- `tests/quasar-colours-resolve-to-the-theme.test.js`
    - the sources actually paint Quasar colours
    - no page paints a Quasar palette rung the theme cannot move
    - every painted colour is one the platform decides
    - the neutral greys do not grow
    - every linked tone is a role the theme declares
    - the guides show some overrides
    - every role the bridge links is one a guide tells you to override
- `tests/token-audit-template-scan.test.js`
    - a static style attribute
    - a bound style with a literal fallback
    - an SVG paint attribute
    - a functional notation with literal channels
    - a named colour is a literal too
    - a named colour BARE in an SVG paint attribute
    - a named colour as a string inside a bound paint attribute
    - the two halves do not report the same colour twice
    - the namespace, not the tag name — a bare &lt;g&gt; is not SVG
    - every CSS named colour, not the obvious eighteen
    - a longer keyword is not read as the shorter one inside it
    - several literals in one binding
    - a literal nested deep in the tree
    - a literal AFTER a nested &lt;template&gt;
    - a hex in template TEXT is content, not paint
    - a pull-request number in an HTML comment
    - a slot shorthand that happens to spell a colour
    - an input mask
    - an anchor href
    - a Quasar
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
    - a &lt;style&gt; block is not a template finding
    - a &lt;script&gt; block is not a template finding
    - a file that is not an SFC is null, not empty
    - an SFC with no template at all is null
    - an SFC the parser cannot read is null, not empty
    - a template that parses and holds nothing is empty, not null
    - a literal on the third line of the template
    - a binding spread over several lines points at the literal
    - the text keeps its length, so every offset still points where it did
    - a comparison between two literals is left alone
    - a path it cannot cross is kept, because it cannot tell
    - but a name inside another string is not a use of it
    - a name is bounded by the alphabet it is written in
    - a trailing ! ends the name, and only
    - and the literal survives, because the class is rendered
    - a size, a weight or a leading in it is a literal
    - a tokenized shorthand is not
    - a number in the family name is a name, not a size
    - a static style attribute is a fragment
    - several attributes, in template order
    - a bound :style is NOT a fragment
    - an attribute that is not
    - null and empty still mean different things
    - a bound style that is one string literal is inline CSS too
    - the line is the line the attribute value starts on
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
    - the class form belongs to the class category
    - a comment in a binding is prose, not a palette
    - null and empty still mean different things
    - the line is the line the value sits on
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
    - Quasar
    - an explicit scheme still outranks what Quasar was set to
    - Quasar
    - the machine still decides when Quasar says
    - Quasar
    - with no dark configuration at all, the theme is left on system
    - Quasar
    - the two directions do not chase each other
    - a
    - Quasar
    - a hard pick that agrees with the machine is still a pick
    - dispose() stops the bridge writing to the document
- `packages/ui-vue/tests/component/theme-switcher.test.ts`
    - renders when the shell provides a theme
    - renders nothing when the app opted out
    - a context from an older package version still shows it
    - a catalog from an older package version renders instead of throwing
    - the button names the active scheme
    - an unknown active scheme falls back to its value instead of blanking
    - the accessible label comes from the catalog
    - all three schemes become menu entries
    - picking an entry writes the shared scheme
    - picking
    - only the active entry carries the check mark
- `packages/ui-vue/tests/identity-accents-match-theme.test.js`
    - the resolver reaches a hex at all
    - both halves are the same length
    - every stored value is what its role resolves to in the light theme
    - the neutral matches too
    - every hex in the file is one of the ramp values
    - ${label} is concrete, not a token reference
    - ${label} fits the promotion column
- `tests/a-role-that-is-read-is-defined.test.js`
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
    - carries the wording the page wrote, not a generic
    - a destructive action is coloured as one
    - tone defaults to primary — only the caller may call something destructive
    - both buttons are labelled, so neither reads
    - no prompt means no input — a plain confirm stays plain
    - a prompt carries its initial value and type
    - a prompt with no initial value starts empty and takes text
    - an app-provided port is the one that gets asked
    - without one, the Quasar implementation is the fallback — which still asks
    - a context from an older package version still resolves, because the key is Symbol.for

<!-- END proof -->

### SC-UI-018 — Where two answers are outstanding, the current question's answer wins

🟢 Not the one that happens to arrive last. A slower response is not necessarily the older one, and
prices resolved against a plan the tenant has since left are not stale — they are about a
different question.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/ui-confirm-port.test.ts`
    - carries the wording the page wrote, not a generic
    - a destructive action is coloured as one
    - tone defaults to primary — only the caller may call something destructive
    - both buttons are labelled, so neither reads
    - no prompt means no input — a plain confirm stays plain
    - a prompt carries its initial value and type
    - a prompt with no initial value starts empty and takes text
    - an app-provided port is the one that gets asked
    - without one, the Quasar implementation is the fallback — which still asks
    - a context from an older package version still resolves, because the key is Symbol.for
- `packages/ui-vue-tenant/tests/component/a-preview-in-flight-blocks-the-confirmation.test.ts`
    - the answer to the abandoned question is taken off the screen
    - and the confirmation cannot be given
    - the outdated one does not install itself
- `packages/ui-vue-tenant/tests/component/the-latest-question-wins.test.ts`
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

- `packages/ui-vue/tests/component/disclosures-open-what-they-say.test.ts`
    - the row is a button that says whether it is open
    - clicking one row opens that row, and only that one
    - clicking the open row closes it again
    - the timeline bar that opens the same row is a control too
    - the toggle is a button that says whether it is open
    - the backend-only fields appear once it is open
    - the toggle asks its owner rather than deciding
    - an edit in the open editor reaches the update handler
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

### SC-UI-021 — A campaign that worked looks like a success, not a fault

🟢 A fully redeemed promotional code is shown as spent, not in the colour reserved for errors.

_Source:_ release 1.0.0-rc.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/promo-code-tiles.test.ts`
    - count every row the tenant has
    - keep their counts when a tile narrows the table
    - keep their counts while the search narrows the table

<!-- END proof -->
