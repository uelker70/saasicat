---
title: Being understandable to a stranger
---

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
