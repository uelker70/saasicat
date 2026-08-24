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

**Delete `src/styles/theme.scss`.** The six other variables it carried are gone
too, and only one of them was ever yours. `$secondary` and `$accent` were read
by nothing. The four status colours are the platform's own roles, and the
scaffolder asked you to restate them — which is how they drifted: `$warning`
was `#f59e0b` against a `--sa-color-warning` that resolves to `#b45309`, so
`color="warning"` painted 2.15:1 on white beside a role that paints 4.8:1. The
platform now points Quasar's status slots at its roles itself, through `var()`,
so they follow the colour scheme instead of staying light in dark mode. If you
had overridden one, override the role instead.

Quasar's stylesheet is shipped but not bundled. It restyles `html`, `body` and
typography — 76 computed properties across every element of a page that styles
itself — so it stays an import you write rather than one hidden inside the
bundle. You accept that today by importing it; bundling it would mean you could
no longer decline.

Measured on the example admin: 1.8 MB of build output before, 1.6 MB after, with
the same 11 page chunks. The component styles arrive as one file rather than
split per page.
