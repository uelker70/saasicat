// @saasicat/ui-vue/quasar — the Quasar layer entry: everything that installs
// or calls Quasar from TypeScript. Kept out of the main entry so that
// `import ... from '@saasicat/ui-vue'` never executes a `quasar` import
// (Quasar is an optional peer dependency).
//
// The Quasar standard pages themselves are consumed as raw SFCs via the
// `./pages-standard/*`, `./pages-tenant/*` and `./components/*` subpath
// exports, not through this bundle (tsup ignores `.vue`).

export * from './create-super-admin-app.js';
export * from './dark-bridge.js';
export * from './notify.js';
export * from './confirm.js';

// Quasar types that appear in this package's own public option surfaces.
//
// `TenantDetailPageOptions.userColumns` and `PromoCodeDetailPageOptions` are
// `QTableColumn[]`, so a consumer supplying columns has to be able to name that
// type — and since ADR 0011 they no longer install Quasar to get it. Re-exported
// rather than restated: a copy of the interface would drift from Quasar's on the
// first release that adds a field.
//
// A type-only re-export, so nothing about this reaches a consumer's bundle.
export type { QTableColumn } from 'quasar';
