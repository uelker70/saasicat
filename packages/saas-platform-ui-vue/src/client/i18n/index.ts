// Framework-free i18n core: locale registry, typed catalogs, interpolation.
// The reactive Vue binding lives in `src/vue/use-super-admin-i18n.ts`.

export * from './locale.js';
export {
    defineMessages,
    mergeMessages,
    type MessageTree,
    type PartialMessages,
    type TranslationOf,
} from './define.js';
export * from './format.js';
export * from './currency.js';
export * from './messages.js';
