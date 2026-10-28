---
'@saasicat/ui-vue': patch
---

`mountWithQuasar` renders every Quasar component and directive

`@saasicat/ui-vue/testing/mount-with-quasar` registered 21 of Quasar's
components and one directive, so a page tested with it that used another —
`q-tabs`, `q-tooltip`, `q-drawer`, `q-td`, `v-ripple` — rendered an unknown
element where the component belonged, and a test reading the page found
nothing there and could pass. It now registers every component and directive
the installed Quasar exports, as `@quasar/vite-plugin` resolves them in an
application, and provides a `ResizeObserver` that reports nothing where the
test environment has none, as jsdom does, since Quasar's layout and tabs
observe their size from the moment they mount; it stays installed for the rest
of the test file.

A test of your own can turn red with this, and rightly: what a component that
was not registered held — a tooltip's text, an inactive tab panel, a popup
proxy's content — stood in the page as plain children and was found, and now
the test sees what the application shows, which is nothing until it opens.
