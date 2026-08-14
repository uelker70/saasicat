---
'@saasicat/ui-vue': patch
---

`DiscoveryPage` no longer takes the route down when the discovery payload is not
a snapshot.

`useDiscovery` assigns the response body with an unchecked
`as DiscoverySnapshot`, so anything a server answers 200 with reaches the page —
an older backend, a proxy's JSON error page, a partial response. The page read
`props.snapshot?.app.key`: the optional chain covered `snapshot` being nullish
and stopped there, so a body that is non-null but has no `app` threw inside a
computed. A throw in a computed does not degrade a component, it takes the route
down — the admin shell rendered and the content area stayed blank.

The three fallbacks already in that file (`—`, `Discovery`, `0.0.0`) are what
should happen instead; the chain simply did not carry that intent far enough.
