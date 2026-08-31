---
title: Being understandable to a stranger
---

SaaSiCat is read by people who did not build it and cannot ask anyone. That makes
comprehensibility a property of the product rather than a courtesy: what is not in the code or the
documentation does not exist for the reader. The requirements here are what that costs.

### SC-READ-001 — Someone deciding whether to depend on SaaSiCat can judge what is tested

🟢 By name and by what a failure would cost, not by a percentage. A number is not a risk assessment.

_Source:_ `docs/explanation/test-coverage.md`

### SC-READ-002 — A gap is named rather than papered over

🟢 Where a property cannot be checked automatically, that is said plainly instead of prose being
presented as enforcement.

_Source:_ `docs/explanation/test-coverage.md` · internal engineering guidelines

### SC-READ-003 — A statement about the software is part of it

🟢 A comment, a release note or a documentation sentence that is wrong is worse than none: it sends
the next reader off with a false premise. A release note is worse still, because after publication
it cannot be corrected.

_Source:_ internal engineering guidelines

### SC-READ-004 — An architectural decision records what breaks if it is ignored

🟢 Not only what was decided and why, but what a reader will experience if they do something else.

_Source:_ ADR 0001 to ADR 0011

### SC-READ-005 — The product has one spelling of its own name

🟢 A reader who meets a second spelling has no way to tell a different product from an unfinished
rename.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-READ-006 — A reference a reader cannot follow is not made

🟢 Every link into this repository resolves, and link text says what it leads to. Pointing at a
document only the original team can open implies a rule exists somewhere and hides where — two
such citations had reached error messages an operator could read.

_Source:_ internal engineering guidelines

### SC-READ-007 — Reference documentation is generated from the implementation

🟢 The list of refusal codes and the list of configuration rules are derived from the code that
implements them, so they cannot drift into describing something that is no longer true.

_Source:_ `docs/reference/error-codes.md` · `docs/reference/options.md`

### SC-READ-008 — There is one way to do each thing, not two right answers

🟢 One way to mount a screen, one spelling of a name, one place a setting lives. Where a reader can
see two correct-looking options and no rule saying which is meant, that is a defect in the
product, not a matter of taste.

_Source:_ ADR 0008 · #217
