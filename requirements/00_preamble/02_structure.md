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

<!-- BEGIN chapters — generated, do not edit: node scripts/requirements/index.mjs --write -->

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
| 13  | The public catalogue, checkout and contracts | `SC-MKT-…`   | 21      |
| 14  | Administration and access to it              | `SC-ADM-…`   | 18      |
| 15  | Working in the interface                     | `SC-UI-…`    | 21      |
| 16  | Configuring and running an installation      | `SC-CFG-…`   | 19      |
| 17  | Accessibility                                | `SC-A11Y-…`  | 12      |
| 18  | Language and wording                         | `SC-LANG-…`  | 13      |
| 19  | Security and keeping tenants apart           | `SC-SEC-…`   | 12      |
| 20  | What is kept, and what is never written down | `SC-PRIV-…`  | 10      |
| 21  | Answering the question afterwards            | `SC-AUD-…`   | 11      |
| 22  | Repeating an operation safely                | `SC-OPS-…`   | 11      |
| 23  | Compatibility and upgrading                  | `SC-COMP-…`  | 15      |
| 24  | Being understandable to a stranger           | `SC-READ-…`  | 8       |

Of 400 entries: 🟢 387 stand today, 🟡 12 decided but not yet delivered, ⚪ 0 drafts,
🔵 1 superseded, 🔴 0 withdrawn.

🟡 **Decided, not yet delivered** — [SC-PLAN-007](#sc-plan-007--publishing-says-what-changed),
[SC-PLAN-025](#sc-plan-025--every-quota-a-version-carries-counts-as-a-limit-that-can-be-lowered),
[SC-PRIC-015](#sc-pric-015--an-amount-records-the-currency-it-was-booked-in),
[SC-PRIC-017](#sc-pric-017--the-tax-rate-and-the-tax-amount-are-recorded-not-re-derived),
[SC-PRIC-018](#sc-pric-018--rounding-happens-once-when-a-charge-is-written),
[SC-PRIC-019](#sc-pric-019--a-tenant-can-see-their-own-account),
[SC-PRIC-020](#sc-pric-020--a-charge-once-written-is-never-edited),
[SC-PRIC-021](#sc-pric-021--an-internal-account-reference-is-never-shown-to-a-customer-as-an-invoice-number),
[SC-CFG-008](#sc-cfg-008--an-operator-can-see-when-the-running-configuration-was-applied-and-from-where),
[SC-CFG-009](#sc-cfg-009--a-configuration-change-is-noticed-and-reported),
[SC-AUD-010](#sc-aud-010--a-charge-names-where-it-came-from-and-which-agreement-line-it-belongs-to),
[SC-AUD-011](#sc-aud-011--a-charge-carries-the-period-it-belongs-to)

🔵 **Superseded** — [SC-ENTL-004](#sc-entl-004--once-a-contract-is-agreed-it-is-the-truth-about-what-the-tenant-may-do)

<!-- END chapters -->
