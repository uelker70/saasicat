---
'create-saasicat-admin': patch
---

Scaffolded apps now dedupe the peer dependencies in their Vite config.

`createSuperAdminApp()` creates the router, the Pinia instance and the Quasar
plugin; your own pages read them back with `useRoute()`, `useRouter()` and store
hooks. Those APIs work by module identity, so two copies of a library do not
share one — and because the UI package ships its pages as `.vue` source, its
imports resolve relative to the package while yours resolve relative to your app.

With both in the bundle, `inject` returns `undefined` and the first thing that
touches it throws somewhere unrelated:

```text
TypeError: Cannot read properties of undefined (reading 'params')
```

The shell renders and the content area is blank. Pages that read no route params
keep working, so it reads as one broken page rather than a broken wiring.

Existing apps: add `resolve: { dedupe: ['vue', 'vue-router', 'pinia', 'quasar'] }`
to your Vite config — see handbook §8.0.
