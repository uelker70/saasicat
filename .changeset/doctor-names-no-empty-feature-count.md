---
'@saasicat/cli': patch
---

`doctor` no longer reports "0 feature(s)" for a catalogue that lists none

`platform.plan-catalog` counts the features the catalogue file lists. A
`config/saas.yaml` that lists none leaves the features to discovery, which
`platform.discovery-snapshot` reports, so the check now says only how many
plans it loaded rather than claiming there are no features.
