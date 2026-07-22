// @saasicat/ui-vue/quasar — the Quasar layer entry: everything that installs
// or calls Quasar from TypeScript. Kept out of the main entry so that
// `import ... from '@saasicat/ui-vue'` never executes a `quasar` import
// (Quasar is an optional peer dependency).
//
// The Quasar standard pages themselves are consumed as raw SFCs via the
// `./pages-standard/*`, `./pages-tenant/*` and `./components/*` subpath
// exports, not through this bundle (tsup ignores `.vue`).

export * from './create-super-admin-app.js';
export * from './notify.js';
