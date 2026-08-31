# The requirements catalogue — sources

Everything SaaSiCat promises is written down once, here. The published page,
[`docs/requirements.md`](../docs/requirements.md), is built from these files — so **edit these, never
the page.**

```bash
pnpm run requirements          # check the sources; say whether the page is out of date
pnpm run requirements:update   # check, then rebuild the page
pnpm run requirements:guard    # check what this branch changed, against main
```

If you only came to add a requirement, read "Add a requirement" below and stop there. The rest
matters when you change one that already exists.

## What is where

`requirements/` holds one numbered directory per section, and they are read in that order.

| Path                             | What it holds                                                       |
| -------------------------------- | ------------------------------------------------------------------- |
| `00_preamble/00_introduction.md` | What the catalogue is, and which document governs what              |
| `00_preamble/01_roles.md`        | The three roles every entry is written from the side of             |
| `00_preamble/02_structure.md`    | How an entry is built — and a table of every chapter                |
| `01_scope/` … `24_read/`         | One chapter each: `chapter.md` carries title, introduction, entries |

A chapter directory is named `<nn>_<prefix>` — its position in the document, then the identifier
prefix it owns. `SC-PLAN-004` lives in `03_plan/`.

**Looking for a chapter?** The table at the end of `00_preamble/02_structure.md` lists every one
with its prefix and how many entries it holds. It is generated, so it is never out of date.

## Add a requirement

Put it in the chapter it belongs to, with the next free number in that chapter. Position and number
are independent — put it next to what it qualifies if that reads better.

```markdown
### SC-PLAN-026 — A published version says what changed

An empty note is refused: the note is what an operator reads a year later when a customer asks why
their price moved.

_Source:_ #253
```

- The **heading** is the promise, in one sentence.
- The **prose** below is optional. Use it for the reason, where the reason is not obvious. Nineteen
  entries say everything in their heading and have no prose at all.
- The **`_Source:_` line is required**, exactly once. An issue number, an ADR, a document, a
  release.
- **A test has to name it.** See "Prove it" below.

To refer to another requirement, just write its identifier in the prose — `SC-BUN-023` — and the
checker resolves it. Do that where your promise cannot be checked without the other one: it repeats
a rule the other owns, or uses a word the other defines. Not where the two are merely about the
same subject.

## Change one that already exists

**An identifier is permanent.** Somebody outside this repository may have written it down, so it
must never come to mean something else. That makes changing a requirement different from changing
code: you do not edit the promise, you retire the entry and write a new one.

| What you are doing                                      | What to do                       |
| ------------------------------------------------------- | -------------------------------- |
| The promise now holds differently, or more, or less     | Retire it, write a new entry     |
| The promise is gone and nothing replaces it             | Withdraw it                      |
| Fixing a typo, or saying the same thing more clearly    | Edit the entry, claim it (below) |
| Following somebody else's supersession in your own text | Just edit the entry              |

The question that decides between rows one and three: **does what somebody can rely on change?**

**A supersession introduces the promise that replaces it.** Point it at an entry you write in the
same change, so that following the trail arrives at the rewrite. It also has to arrive at a promise
that stands — a chain ending at a draft or at something withdrawn removes a promise and reads as
though there were something to follow it to.

Where another entry already covers the ground, the promise is gone rather than rewritten, and that
is a withdrawal whose prose says where the ground is covered:

```markdown
🔴 _(Withdrawn on 2026-09-01.)_ `SC-PLAN-026` covers this, and covering it twice was the defect.
```

To retire an entry, leave it exactly where it is and open it with a marker:

```markdown
### SC-PLAN-004 — A published version freezes once it applies

🔵 _(Superseded on 2026-09-01 by `SC-PLAN-026`.)_ Editing it would change what a customer already
agreed to.

_Source:_ #133
```

Then add the new wording as a new entry with the next free number.

For a typo or a clearer sentence — the words changed, the promise did not — say so in the commit
that makes the change:

```text
Fix a typo in the plan chapter

Editorial: SC-PLAN-004
```

The claim covers that commit and no other, so commit the fix and let the commit speak for it.

## What state an entry is in

**Every entry opens with exactly one state marker**, the ordinary case included.

| State                                    | Opens with                                     |
| ---------------------------------------- | ---------------------------------------------- |
| 🟢 Current — it holds                    | `🟢`                                           |
| 🟡 Decided, not built yet                | `🟡 _(Decided, not yet delivered.)_`           |
| ⚪ Draft — proposed, not decided         | `⚪ _(Draft since YYYY-MM-DD.)_`               |
| 🔵 Superseded — replaced, follow the id  | ``🔵 _(Superseded on YYYY-MM-DD by `SC-…`.)_`` |
| 🔴 Withdrawn — gone, nothing replaces it | `🔴 _(Withdrawn on YYYY-MM-DD.)_`              |

Nineteen entries say everything in their heading and carry nothing under it but `🟢`.

Behind the state, an entry may carry what a breach of it would cost — `💰` for money or law, `🔒`
for tenant separation, access or somebody's data. Most carry neither, which is the ordinary case.
It is what decides which untested promise to cover first, so `pnpm run requirements:list` reports
coverage against each. Only a
current entry may say it is not built yet — a draft is not decided, and a retired one has nothing
left to deliver.

Marking only the exceptions would be quieter, and it would mean the ordinary state is read out of a
blank. A state read out of a blank is a state nobody checked: a marker wrapped across a line went a
day unnoticed here, and two requirements counted as promises the product keeps while nothing
anywhere said otherwise.

The colour is not the state — the words are, where there are words — and the checker holds the two
together, because a colour is read faster than a sentence and a wrong one misleads whoever trusts
it. Current carries no words because it qualifies nothing: no date, no successor.

States move one way: a draft is decided or dropped; a promise that stands is superseded or
withdrawn; nothing comes back. Two moves are refused because they look like tidying and are not:

- **A promise is never demoted to a draft.** That takes it back without saying so.
- **A promise that was delivered may not go back to "not yet delivered"** without a claim. If the
  product stopped keeping it, that is a bug and belongs in an issue.

The summary under the chapter table counts every state and links every entry that is not current.
`pnpm run requirements:list` prints all of them, with the state and whether a test names it.

## Prove it

A test names the promise it proves, in a comment at the start of a line. Where it sits decides what
it covers:

```js
// @requirement SC-PLAN-004 — A published version freezes once it applies
                                    ↑ above the imports: every case in the file

// @requirement SC-BUN-003 — The first period of a booking is short, and charged …
describe('what the short first period costs', () => {   ← this block's cases

    // @requirement SC-PRIC-002 — A part-period is charged by days
    test('charges by days, not by whole months', () => {   ← this one case
```

Write the identifier; `pnpm run requirements:update` writes the title after it, so a reader of the
test learns what it answers for without opening the catalogue. Never type the title — a copy in
hundreds of files goes stale the first time somebody rewords a requirement, and then it misleads
exactly the reader it was added for. A test holds every annotation against what its requirement
says.

Put it on the narrowest thing that is true. A file-level annotation claims every case in the file
proves that promise, which is usually more than anybody meant.

The cases are written under the requirement itself, between markers, by the same command that
builds the page — so the question "which tests cover this" is answered where it is asked:

```markdown
_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewAdd
        - the preview quotes no commitment, because a booking makes none

<!-- END proof -->
```

Never edit that block; `pnpm run requirements:update` writes it, and an entry nothing tests carries
none. It is a fact about the tests rather than part of the promise, so it is cut out again before a
change is compared — annotating a test does not read as rewriting a requirement.

### What the checks cannot tell you

They verify that an annotation names a requirement that exists and still stands.
They cannot verify that the test proves it — nothing can, short of reading both.

That gap is not theoretical. Eleven annotations in this catalogue named a
requirement they did not prove, and every one of them looked right from a
distance: a date test claimed exact money, a drag-handle test claimed a
promotional lifecycle, a dry run claimed a migration that stops. Each was the
only proof its requirement had, so the coverage figure counted it and the
ratchet treated the requirement as settled.

Two habits keep it out:

- **Annotate the narrowest thing that is true** — one case, or one `describe`,
  and the whole file only where the whole file answers for the requirement. A
  file-level annotation on a broad file is where a wrong claim hides.
- **Read the requirement, then the case name, and ask whether one is evidence
  for the other.** `pnpm run requirements:cases` prints them side by side for
  exactly this. A requirement resting on a single file is where the question
  matters most, because there is nothing else holding it up.

Four ways to ask:

```bash
pnpm run requirements          # check the sources; is the page up to date
pnpm run requirements:list     # every requirement, its state, whether a test names it
pnpm run requirements:gaps     # only the ones nothing covers yet
pnpm run requirements:cases    # every requirement with the cases beneath it
```

`--risk money` or `--risk tenancy` narrows any of them to what a breach would cost, which is the
question worth asking when the list is long:

```bash
node scripts/requirements/index.mjs --list --owed --risk tenancy
```

`pnpm run requirements:cases` prints the same thing for the whole catalogue:

```text
SC-BUN-003    current    proved    The first period of a booking is short, and charged for …
                packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js
                  - a bundle booked on the plan day itself › gets a whole period rather than an empty one
                  - booked anywhere inside a plan period › in the middle it runs to the same day
```

**A case is identified by its name**, which is what the test runner prints and what you search for.
It carries no separate identifier: one that is written by hand goes stale across a thousand cases,
and one derived from the name changes when the name does, so it is no more stable than the name and
buys nothing.

The link goes this way round because in the test it sits next to the thing it describes, and moves
when that moves.

`pnpm run requirements:list` prints every requirement with its state, whether a test names it, and
which tests those are. The link runs both ways: from a requirement to the tests that prove it, and
from a test to the promises it answers for — so retiring a requirement names the test scripts that
go stale with it, rather than leaving them to be found later.

**Coverage is reported by the same command**, over the promises that stand and are delivered,
because those are the only ones owed a proof. None of that was backfilled, and the debt is
frozen rather than being turned into a target nobody would meet:

- A new promise brings its test — **or** a promise that was already owed one gains a test instead.
- A promise that had a proof may not lose it.
- Retiring an unproven promise makes the debt smaller and buys nothing. Retiring proves nothing.

Only a current, delivered promise is owed a proof. A draft is not a promise yet, a retired one is
not one any more, and one that is decided but not built has nothing to prove until it is.

## What runs, and when

| When                    | What                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| While you edit          | `pnpm run requirements` and `requirements:update`                           |
| Before you push         | `pnpm run requirements:guard` — it reads committed history, so commit first |
| Every pull request (CI) | the repo tests, plus `requirements:guard` against `main`                    |

Three groups of checks, by what they look at:

1. **The sources as they stand** — identifiers unique, numbering with no gaps, one `_Source:_` per
   entry, references that resolve, colours that match their words, chapters that are not empty.
   Two of these exist for what _nearly_ matches: a hyphen where the document uses an em dash,
   `_Sources:_` with one letter too many, `_(Draft.)_` with no date. Each reads correctly to a
   person and matches no pattern, so the entry would drop out of every other check as well.
2. **What this branch changed** — a promise rewritten in place, an entry deleted rather than
   withdrawn, an entry rewritten while being retired, a state that moved the wrong way. Compared is
   the promise, not the file: rewrapping a paragraph, marking a word as code and following somebody
   else's supersession all change the text and none of them change what was promised.
3. **What is proved** — the debt above.

## What none of it checks

Worth saying plainly, because a green check invites the opposite assumption:

- Whether a promise is **true**.
- Whether it is **one** statement rather than three.
- Whether the source given is the **real** reason it exists.
- Whether the tests beneath a requirement cover the cases a user can actually reach. One naming
  test is what a machine can count; which cases belong under it is a judgement, and it belongs in
  the pull request.

## Why it is built this way

The catalogue held to all of these rules before any of them was enforced, because one person wrote
it in one sitting and remembered them. That is a coincidence, not a property, and it ends at the
first entry added under time pressure.

The rest follows from the identifier being permanent. A reference from outside must never quietly
come to mean something else — which is why a promise is retired rather than edited, why numbers are
never reused, and why the check compares the promise rather than the file. Without that last part
the rule would eat itself: every retired entry would force its neighbours to be retired too, and
one reworded sentence would walk through the chapter.

[`docs/explanation/requirements-as-sources.md`](../docs/explanation/requirements-as-sources.md) is
the long form: every rule the checker enforces, and the reasoning behind the ones that are not
obvious.
