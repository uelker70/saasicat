---
'@saasicat/nest': patch
---

Lift js-yaml to 4.3.2

`@saasicat/nest` declares js-yaml as a runtime dependency and parses
`config/saas.yaml` with it, so the bound moves for every installation that
installs the package rather than only for this repository's own tooling.
GHSA-2883-xcg3-v3hh (CVE-2026-84375): below 4.3.2 the parser's cap on merge
keys does not bound the work an empty merge source causes.

What an installation is exposed to depends on who writes the YAML it reads.
The catalogue file is written by the operator, so the ordinary path is not
reachable from outside; an application that hands the loader a document from
somewhere else is, and that is the case this closes.
