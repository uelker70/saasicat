---
'@saasicat/ui-vue': minor
---

The admin UI brings its own framework

`@saasicat/ui-vue` ships its components built and carries `quasar` as its own
dependency. You can remove `quasar`, `@quasar/vite-plugin` and `sass` from your
admin app — you were installing them to compile an application you only mount.

**Your imports do not change.** `@saasicat/ui-vue/pages/UsersPage.vue` still
resolves: your typechecker reads the source, your bundler loads the build.

What changes: the Quasar plugin leaves your Vite config, four stylesheet imports
replace the two you had (`@saasicat/ui-vue/quasar.css`, `/icons.css`,
`/theme.css`, `/style.css`), and your brand colour moves from `$primary` in a
Sass file to `createSuperAdminApp({ brand: { color } })` — one value that writes
`--q-primary`, which `--sa-color-accent` already reads.
`docs/guides/upgrade-to-1.0.md` walks all four.

Quasar's stylesheet is shipped but not bundled. It restyles `html`, `body` and
typography — 76 computed properties across every element of a page that styles
itself — so it stays an import you write rather than one hidden inside the
bundle. You accept that today by importing it; bundling it would mean you could
no longer decline.

Measured on the example admin: 1.8 MB of build output before, 1.6 MB after, with
the same 11 page chunks. The component styles arrive as one file rather than
split per page.
