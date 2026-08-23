---
'@saasicat/ui-vue': patch
---

`@saasicat/ui-vue/testing/mount-with-quasar` mounts a component with Quasar's
components registered — the fixture the platform's own component tests use.

`app.use(Quasar)` installs the plugin but registers nothing, so without it every
`q-*` in the component under test stays an unresolved element and assertions
pass or fail for reasons that have nothing to do with the component. Two
packages in this repository had a byte-identical copy of it; a consumer testing
a page they mounted needs the same one.
