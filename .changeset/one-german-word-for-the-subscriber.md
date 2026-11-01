---
'@saasicat/core': patch
'@saasicat/ui-vue': patch
---

The German texts call the subscriber _Vertragspartner_ throughout

Five refusal texts of `@saasicat/core` and the label of a feature withdrawal's
reason in `@saasicat/ui-vue` still said _Abonnent_, beside _Vertragspartner_
everywhere else. They now say _Vertragspartner_ as well, and a repository test
holds every shipped source to the one word. An application that overrides one
of those texts keeps its own wording.
