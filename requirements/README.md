# The requirements catalogue — sources

This directory is where [`docs/requirements.md`](../docs/requirements.md) comes from. That page is
generated: it is the files here concatenated, in the order their names give. Edit these; never edit
the page.

```bash
pnpm run requirements          # check the sources, and say whether the page would change
pnpm run requirements:update   # check, then write the page
```

## Where to start

Read in the order of the numbers — that is the order the document has.

| Path                             | What it holds                                                       |
| -------------------------------- | ------------------------------------------------------------------- |
| `00_preamble/`                   | The prose that opens the document, in three parts                   |
| `00_preamble/00_introduction.md` | What the catalogue is, and which document governs what              |
| `00_preamble/01_roles.md`        | The three roles every entry is written from the side of             |
| `00_preamble/02_structure.md`    | How an entry is built and retired — and the table of every chapter  |
| `01_scope/` … `24_read/`         | One chapter each: `chapter.md` carries title, introduction, entries |

**Which chapter owns which identifiers** is the table at the end of
`00_preamble/02_structure.md`. It is generated between its markers, so it names every chapter, its
prefix and how many entries it holds without anybody keeping it current — and without opening
twenty-four files to find out.

A chapter directory is `<nn>_<prefix>`: its position in the document, then the identifier prefix it
owns. `SC-PLAN-004` lives in `03_plan/`. The number is in the name and nowhere else, so a listing reads
in document order and renumbering a chapter is a rename rather than an edit that has to agree with
something. The preamble is directory `00` for the same reason: one sequence of numbered
directories, rather than files and directories competing for the same numbers.

## Adding a requirement

Append it to the chapter it belongs to, with the next free number in that chapter — or beside what
it qualifies, if that reads better. Position and number are independent: what must hold is that the
numbers run `001..N` with none skipped.

```markdown
### SC-PLAN-026 — A published version says what changed

An empty note is refused: the note is what an operator reads a year later when a customer asks why
their price moved.

_Source:_ #253
```

The `_Source:_` line is required, and there is exactly one. The prose beneath the heading is not —
nineteen entries say everything in their heading, and repeating it below would be padding. Where
the reason for a promise is not obvious, that reason is the most valuable part of the entry.

Dependencies are not written down: an identifier mentioned anywhere in the prose is a reference,
and every one of them is resolved by the checker.

## What state it is in

An ordinary entry carries no marker: it stands, and the product keeps it. The other states open the
entry, because a reader arriving from an old link has to learn in the first few words that it does
not apply.

| State                                    | Written as                                     |
| ---------------------------------------- | ---------------------------------------------- |
| 🟢 Current                               | nothing                                        |
| ⚪ Draft — proposed, not decided         | `⚪ _(Draft since YYYY-MM-DD.)_`               |
| 🔵 Superseded — replaced, follow the id  | ``🔵 _(Superseded on YYYY-MM-DD by `SC-…`.)_`` |
| 🔴 Withdrawn — gone, nothing replaces it | `🔴 _(Withdrawn on YYYY-MM-DD.)_`              |

The colour is not the state — the words are — and it is checked against them, because a colour that
disagrees is read faster than the words and misleads whoever trusts it. Green has a colour and no
entry wears it: a dot on three hundred and eighty-nine ordinary entries would hide the ten that are
not.

A current entry that is not true yet says `🟡 _(Decided, not yet delivered.)_` at the end of its
prose. No other state may: a draft is not decided, and a retired one has nothing left to deliver.

`00_preamble/02_structure.md` carries the same table for readers of the published page. Under the
chapter table, a generated line counts each state and lists every entry that is not ordinary, with a
link to it — ten entries in three thousand lines are visible once you reach them and unfindable
before that.

## What proves it

A test names the promise it proves:

```js
/** @requirement SC-PLAN-004 */
```

The link goes this way round because in the test it sits beside the thing it describes and moves
when that moves. In the requirement it would be a second list to keep in step with the first.

Nothing was backfilled — 389 promises stand today with nothing naming them. `requirements:guard`
freezes that number instead: it may fall and may not rise. A new promise brings its test, or pays
for itself by proving one that was already owed.

Only a current, delivered promise is owed a proof. A draft is not a promise yet, a retired one is
not one any more, and one decided but not delivered has nothing to prove until it is built.

## Changing one

**An identifier is permanent, and a promise is not edited into a different promise.** Somebody
outside this repository may have written the identifier down. The old entry stays and says it is
retired; the new promise is a new entry:

```markdown
_(Superseded on 2026-09-01 by `SC-PLAN-026`.)_ …the wording that no longer holds.
```

A promise dropped with nothing in its place is `_(Withdrawn on 2026-09-01.)_` instead.

Not every edit is a change of the promise, and the difference matters: without it, one reworded
sentence would walk through the chapter superseding everything that mentions it. A typo, a clearer
sentence, or a reference following a supersession is edited in place. The question that decides it
is whether **what somebody can rely on** changes.

None of this is left to memory. `pnpm run requirements:guard` compares the promises on this branch
against the ones on `main` and refuses a promise that was rewritten in place, an entry that was
deleted, an entry rewritten while being retired, and a retired promise brought back. What is
compared is the promise and not the file: rewrapping a paragraph, bolding a phrase and following
somebody else's supersession all change the text and none of them change what was promised.

Where the words did change but the promise did not — a typo, a clearer sentence — say so in the
commit that makes the change:

```text
Editorial: SC-PLAN-004
```

It belongs there rather than in the entry because the claim is about one edit, not about the
requirement, and a reviewer can hold it against the diff sitting beside it. A marker in the entry
would outlive the typo it excused by years.

[`docs/explanation/requirements-as-sources.md`](../docs/explanation/requirements-as-sources.md) has
the long form, including every rule the checker enforces and the ones it cannot.
