## How an entry is built

Every requirement carries an identifier of the form `SC-<CHAPTER>-<NNN>`, numbered from `001`
within its chapter. Under the heading stands the promise, and under that the `_Source:_` line
naming where the decision came from — an issue number, an architecture decision record, a document
in this repository, or the release the behaviour arrived in. Where the promise is complete in its
heading, there is nothing between the two, and where its reason is not obvious that reason is the
most valuable part of the entry.

**Identifiers are permanent and a number is never reused.** Somebody outside this repository may
have written one down, and it must never come to mean something other than it did. So a promise is
not edited into a different promise. The entry stays where it is, opens with what became of it, and
the new promise is a new entry:

- `_(Superseded on YYYY-MM-DD by \`SC-…\`.)_` — the promise now holds differently, and the
  successor says how.
- `_(Withdrawn on YYYY-MM-DD.)_` — the promise is gone and nothing replaces it.

A correction that leaves the promise intact — a typo, a clearer sentence, a reference following a
supersession — is made in the entry itself. What decides between the two is whether what somebody
can rely on changes.

A few entries are marked _(Decided, not yet delivered.)_ — the decision is settled and recorded,
the implementation is not there yet. They are listed because a decision nobody can find is a
decision that gets taken twice.

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
| 10  | What a tenant may do at runtime              | `SC-ENTL-…`  | 20      |
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

<!-- END chapters -->
