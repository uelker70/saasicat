---
'@saasicat/ui-vue': patch
---

Discovery feature cards: two meta texts move off the disabled colour.

The separator between a feature's owner and its capability count, and the
`n · read-only` count above the code-capability list, were painted
`--sa-color-fg-disabled`. Nothing there is disabled — that role is the bottom of
the palette, not the bottom of the readable text ladder — and on the card's own
surface it measured **1.48:1** and **1.42:1**. Both now take
`--sa-color-fg-subtle`, the quietest readable rung, at 3.50:1 and 3.35:1. They
stay a step quieter than the line around them, which was the point of the
distinction in the first place.

Neither reading was a regression. They had been there since the cards were
written, and no check had ever looked: the visual fixture handed `DiscoveryPage`
an empty catalog, so the contrast reader saw the page's empty state and nothing
else. It now renders real feature and quota rows, and reported both on the first
run.
