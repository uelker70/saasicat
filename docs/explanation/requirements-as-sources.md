# The requirements catalogue and how to change it

[`docs/requirements.md`](../requirements.md) is generated. The sources are one Markdown file per
chapter under `requirements/`, and the published document is those files concatenated under the
preamble. **No requirement text is transformed on the way** — a source file can be read exactly as
it will be published, and there is no gap between the two for a mistake to live in. The generator
adds only what a chapter cannot say about itself: its numbered heading, the note saying where the
page comes from, and the removal of the two comment markers that delimit the generated table in the
source and have nothing to delimit here.

```text
requirements/
    README.md                          how to edit these files — not part of the page
    00_preamble/00_introduction.md     what the catalogue is, and which document governs what
    00_preamble/01_roles.md            the three roles every entry is written from the side of
    00_preamble/02_structure.md        how an entry is built and retired, and the chapter table
    01_scope/chapter.md                chapter 1 — title, introduction, its requirements
    03_plan/chapter.md                 chapter 3
    …
```

`requirements/` holds one sequence of numbered directories and nothing else: `00_preamble/` for the
opening prose, then one per chapter. A chapter directory is its position and then the identifier
prefix it owns, so `SC-PLAN-004` lives in `03_plan/`. The number is in the name and nowhere else —
renumbering is a rename git follows rather than an edit to a field that has to agree with something,
and `ls` reads in document order. Two sequences side by side were tried first and abandoned: they
put `01_roles.md` next to `01_scope/` and undid the reason for numbering anything.

The table of chapters at the end of `00_preamble/02_structure.md` is generated between markers, so
it names every chapter, its prefix and how many entries it holds without anybody keeping it current.
It sits in the sources rather than only in the published page because that is where the question
gets asked — which chapter owns `SC-PROMO-…`, and where is the weight — and answering it should not
mean opening twenty-four files.

```bash
pnpm run requirements          # check the sources, say whether the document would change
pnpm run requirements:update   # check, then write docs/requirements.md
```

## What a requirement is made of

An entry is a heading, its promise, and where the promise came from:

```markdown
### SC-PLAN-004 — A published version freezes once it applies

Editing it would change what a customer already agreed to.

_Source:_ #133 · ADR 0009
```

The promise text is optional: nineteen entries state everything they have to say in the heading,
and repeating it below would be padding. The `_Source:_` line is not optional, and there is exactly
one of it.

Almost nothing else is written down, on purpose. **Dependencies are read from the prose** — an
identifier mentioned in the text of an entry is a reference to it, and the checker resolves every
one. Writing them a second time in a field would be a copy, and a copy goes stale. The release a
requirement arrived in comes from git for the same reason.

A reference belongs where the promise cannot be checked without the other one: where the entry
restates a rule another owns, or leans on a word another defines. `SC-MKT-016` requires every add-on
in an offer to still be _bookable_, and what bookable means is `SC-BUN-023`'s to say — change that
and this promise silently means something else, which is precisely what a reference makes visible.
Two entries merely being about the same subject is not that. Every reference is an edge somebody
has to follow when the other end is superseded, so one added out of tidiness costs that and buys
nothing; if the link does not read as part of the sentence, it is probably not a dependency.

## Changing a requirement

An identifier is permanent. Somebody outside this repository may have written it down, and it must
never come to mean something else than it did when they did.

So a requirement is not edited into a different promise. The old entry stays and says it is
retired, and the new promise is a new entry with the next free number in its chapter:

```markdown
### SC-PLAN-004 — A published version freezes once it applies

_(Superseded on 2026-09-01 by `SC-PLAN-026`.)_ Editing it would change what a customer already
agreed to.

_Source:_ #133 · ADR 0009
```

A promise that is dropped rather than replaced is withdrawn instead, with no successor:
`🔴 _(Withdrawn on 2026-09-01.)_`. Both markers open the entry, because a reader arriving from an old
link has to learn in the first few words that it does not apply.

A promise moves between states in one direction: a draft is decided or dropped, a promise that
stands is superseded or withdrawn, and nothing comes back. Delivery moves the same way. The marker
is stripped before the promise is fingerprinted, so building one of the ten costs nothing —
implementing a promise is not rewriting it, and leaving the marker in would have left the author
with only a false editorial claim or a supersession of something that never changed. Adding the
marker to a promise the product kept is the move that has to be claimed: it files a kept promise as
an intention, and the entry stops being owed a proof. The move deliberately missing from that
list is current to draft. It reads as tidying and it is a promise being demoted to a proposal — and
because prepending the marker leaves the wording untouched, no comparison of the prose would notice,
while the entry silently stops being owed a proof.

Each state carries a colour — ⚪ draft, 🔵 superseded, 🔴 withdrawn, 🟡 decided but not yet
delivered — and the checker refuses one that disagrees with the words beside it, because a colour is
read faster than a sentence and a wrong one misleads whoever trusts it. Current is 🟢 and no entry
wears it: a dot on three hundred and eighty-nine ordinary entries would hide the ten that are not
ordinary among them. It appears once, in the generated line under the chapter table, which counts
every state and links each entry that is not current — a question asked before somebody buys rather
than while they scroll.

**Not every edit is a change of the promise.** The question that decides it is whether what
somebody can rely on changes:

| The edit                                                            | What to do              |
| ------------------------------------------------------------------- | ----------------------- |
| The promise now holds differently, or more widely, or more narrowly | Supersede it            |
| The promise is gone and nothing replaces it                         | Withdraw it             |
| A typo, a clearer sentence, the same promise                        | Edit the entry in place |
| A referenced identifier was superseded and the link follows on      | Edit the entry in place |

Without that last pair the rule would eat itself: every superseded entry would force its neighbours
to be superseded too, and one reworded sentence would walk through the chapter.

The rule is checked rather than remembered. `pnpm run requirements:guard` compares this branch's
promises against `main` and refuses four things: a promise rewritten in place, an entry deleted
rather than withdrawn, an entry rewritten while being retired, and a retired promise brought back to
life. It compares the promise and not the file — identifiers inside the prose are blanked, code
formatting is dropped and whitespace is collapsed first — so following somebody else's supersession,
marking a word as a literal and rewrapping a hand-wrapped paragraph all cost nothing. Asterisks and
underscores are left alone: they belong to `*.json` and `tenant_id` as much as they belong to
emphasis, and telling the two apart needs a Markdown parser.

An edit that changes the words without changing the promise is claimed in the commit that makes it,
as `Editorial: SC-PLAN-004`. The claim covers exactly the identifiers it names, and it lives in the
commit rather than in the entry for two reasons: it is about one edit rather than about the
requirement, and a reviewer can hold it against the diff sitting right beside it. A marker in the
entry would outlive the typo it excused by years.

It covers exactly the commit that carries it, which is why the branch is judged commit by commit
rather than as one diff. Pooled, a trailer would outlive its edit: a commit legitimately excusing a
typo in an entry would also excuse a later commit rewriting that entry into a different promise.
Anything still uncommitted is judged with no claim available.

**Every revision is judged, and each one against its own parents.** A parent acquits an entry when
it has that entry and finds nothing wrong with it — whoever wrote that version answered for it
where they wrote it. What none of the parents acquits is this revision's own doing.

One rule covers a commit and a merge, because they differ in nothing but how many parents they
have. A merge is not skipped: resolving a conflict can rewrite or delete a requirement, and that
edit belongs to nobody else. What arrived along one parent matches that parent and costs nothing;
what the resolution wrote matches none of them and is reported. A parent that never carried the
identifier acquits nothing, because that silence is absence rather than agreement.

Every earlier version of this walk was an assumption about the shape of history — skip merges,
follow the first parent, compare against where the walk had reached — and each was wrong for a
shape git allows: a merged local topic branch, a feature branch that merges a newer `main`, and
the merge commit GitHub synthesises for a `pull_request` checkout, which for a while left the
check comparing that merge result against itself: green, and blind. The rule above is derived from
what a commit is rather than from a branch anybody had in mind, which is why it needs no case for
any of them. CI still names the head it means, because judging the merge GitHub invents says
nothing about the branch.

## What proves a requirement

A test names the promise it proves, as `@requirement SC-PLAN-004` in a comment. The link goes that
way round on purpose: in the test it sits beside the thing it describes and moves when that moves,
while in the requirement it would be a second list of test identifiers to keep in step with the
first, and the two would drift the first time a file was renamed.

When the catalogue was written, no test anywhere named a requirement. Backfilling 389 of them would
have been a week of work for a number nobody would trust afterwards, so nothing was backfilled and
the debt is frozen instead: **a new promise brings its test, or a promise already owed one gains a
test.** That is what makes the rule liveable — a promise with no test worth writing can still be
added by settling a debt, rather than through an exemption somebody has to judge.

Refusing a _rise in the count_ would not be the same rule, and the difference is a hole: superseding
an unproven promise drops it out of the count while its untested successor arrives, both sides total
the same, and a new promise passes having proved nothing. Retiring something proves nothing about
it, so only a test earns credit.

Only a current, delivered promise is counted. A draft is not a promise yet, a retired one is not one
any more, and one decided but not delivered has nothing to prove until it is built. Counting those
would ask for tests of things that are not true, and the number would stop meaning anything the
moment somebody wrote one.

**What is not enforced, and is written here as prose because it is prose:** the intended rule is
that every standing requirement has at least one test of its correctness, and beyond that the
positive and negative cases that its own boundaries imply — a refusal with its code, the value
either side of a limit, the missing and empty input, the state the model forbids. One naming test
per requirement is what a machine can count. Whether the cases beneath it are the ones a user can
actually reach is a judgement, and it belongs in the pull request that makes the promise.

## What is enforced, and what is not

`node scripts/requirements/index.mjs` refuses a catalogue where an identifier is used twice, a
heading does not parse, numbering inside a chapter skips, an entry has no source or two, a marker
line is misspelled, an entry sits under the wrong chapter, a reference names something that does
not exist, a current promise leans on a retired one, a successor is missing or loops, an in-document
link lands on no heading, a chapter is empty, a directory does not say where it belongs, or the
chapter table has no home or two. `tests/requirements-are-generated.test.js` runs the same checks
and compares both the published document and the generated table against their sources.

Link fragments are the one rule that moved rather than being added. A chapter file is a fragment of
one page, so an anchor into another chapter is unresolvable where it is written and correct where it
lands — markdownlint's MD051 sees one file at a time and calls every such link broken. It is off for
`requirements/`, and the checker resolves fragments against the headings of the whole catalogue
instead, which is more than MD051 could do here even if it agreed with the split.

Two of those checks exist for what nearly matches rather than what clearly does not. A heading with
an ordinary hyphen where the document uses an em dash, or a `_Sources:_` line with one letter too
many, reads correctly to a person and matches nothing — so without them the entry would fall out of
every other check as well, including the one that notices entries going missing.

What no check can reach stays prose and is named as prose: whether a promise is true, whether it is
one statement rather than three, whether the source given is the real reason it exists. Those are
read by a person or not at all.
