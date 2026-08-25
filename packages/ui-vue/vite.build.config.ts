import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { quasar } from '@quasar/vite-plugin';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

import { publicEntryFor } from './scripts/own-layer-entries.mjs';

// The SFC half of the build.
//
// tsup builds the four TypeScript entries; esbuild cannot compile a `.vue` file
// at all, which is why this package shipped its components as source for so
// long. ADR 0005 gave a second reason — a consumer themed them through Quasar's
// Sass variables, resolved by THEIR build — and ADR 0009 retired it by moving
// theming onto CSS custom properties, which resolve in the browser.
//
// What the source shipping cost is what this removes: a consumer installing
// `quasar`, `@quasar/vite-plugin` and `sass` to compile an application they
// only mount.
//
// One entry per component, and Rollup's ordinary chunking underneath. Each page
// is its own chunk in a consumer's build today — `BundlesPage` alone is 54 KB —
// and rolling eighteen into one entry would hand every visitor all of them.
// Separate entries keep their `() => import(…)` splitting exactly one component.
//
// NOT `preserveModules`, and that was measured rather than assumed: it emits
// each SFC's script and its `<style>` as two modules, the importers name the
// script one, and the style one ships as a chunk nothing imports — 55 of them,
// reported by `dist-is-self-contained`. Ordinary chunking merges the pair,
// which is also the layout that guard was written for: an entry is imported by
// a consumer, a chunk by a sibling.

const SRC = fileURLToPath(new URL('./src', import.meta.url));

/**
 * The package's own compiled layers, imported by their public specifier.
 *
 * Without this the SFC build emits a SECOND copy of `client/` and `vue/`
 * beside the ones tsup already bundled — the two-module-instance problem
 * ADR 0005 documents as a consequence, recreated inside our own `dist/`. Every
 * name they reach is published by a barrel: 360 of 360, measured, which is what
 * makes the rewrite total rather than mostly right.
 *
 * The table lives in `scripts/own-layer-entries.mjs`, because the declarations
 * emitted beside this output are rewritten the same way, and one decision
 * written twice drifts the first time a layer moves.
 */
function ownLayersStayExternal(): Plugin {
    return {
        name: 'saasicat:own-layers-external',
        enforce: 'pre',
        resolveId(source, importer) {
            if (!importer || !source.startsWith('.')) return null;
            const resolved = join(importer, '..', source);
            if (!resolved.startsWith(SRC)) return null;
            const entry = publicEntryFor(relative(SRC, resolved));
            return entry ? { id: entry, external: true } : null;
        },
    };
}

/** Every `.vue` under a directory the export map hands out, as an entry. */
function componentEntries(): Record<string, string> {
    const entries: Record<string, string> = {};
    const walk = (directory: string) => {
        for (const item of readdirSync(directory, { withFileTypes: true })) {
            const full = join(directory, item.name);
            if (item.isDirectory()) walk(full);
            // Keyed WITHOUT the extension, which is what the consumer writes:
            // `@saasicat/ui-vue/pages/UsersPage`. Rollup then emits a 79-byte
            // entry beside the preserved module — keying it WITH the extension
            // instead makes the entry name collide with the module's own and
            // Rollup renames one of them to `…2.vue.js`, which is a name no
            // export map can predict.
            else if (item.name.endsWith('.vue')) {
                entries[relative(SRC, full).replace(/\.vue$/, '')] = full;
            }
        }
    };
    for (const directory of ['pages', 'layouts', 'auth', 'ui']) walk(join(SRC, directory));
    // The barrel `./pages` hands out, as its own entry so the subpath and the
    // barrel resolve to the same modules rather than to two copies.
    entries['pages/index'] = join(SRC, 'pages', 'index.ts');
    return entries;
}

export default defineConfig({
    plugins: [
        ownLayersStayExternal(),
        vue(),
        // The plugin the consumer used to install, run once here instead.
        //
        // Without it every `q-btn` in a template compiles to
        // `resolveComponent('q-btn')` — a runtime lookup against the app's
        // component registry. `app.use(Quasar)` installs the plugin and
        // registers NO components (see `testing/mount-with-quasar.ts`, which
        // exists for that reason), so the lookup finds nothing and the page
        // renders unknown elements. It built clean, the bundle was complete,
        // and the login screen had no email field: the consumer end-to-end
        // suite is what said so.
        //
        // No `sassVariables`: branding is a custom property now (ADR 0011), and
        // Quasar's stylesheet is copied prebuilt rather than compiled here.
        quasar(),
    ],
    build: {
        outDir: 'dist',
        // tsup writes here too, and the two run separately.
        emptyOutDir: false,
        // Read by a consumer's bundler, which minifies its own output. Leaving
        // this readable is what makes a stack trace from their app legible.
        minify: false,
        // One stylesheet, not fifty.
        //
        // With `preserveModules`, Vite puts each SFC's `<style>` into a
        // separate re-export chunk — and nothing imports those chunks, because
        // every importer names the component module directly. The result built
        // clean and shipped 50 stylesheets that no JavaScript pulled in: the
        // admin would have rendered completely unstyled in a consumer's app,
        // which is the exact failure this phase exists to prevent. It was
        // `dist-is-self-contained` that said so, by reporting the orphans.
        //
        // The cost is real and worth naming: the consumer's build splits this
        // CSS per page today, and one file loads all of it up front. For an
        // application behind a login on its own route that is the cheaper of
        // the two mistakes.
        cssCodeSplit: false,
        lib: { entry: componentEntries(), formats: ['es'] },
        rollupOptions: {
            // Quasar is external here and a `dependencies` entry in the
            // manifest: the consumer stops declaring it, npm installs it, and
            // the built output imports it by name. Inlining it instead would
            // put a copy of the framework in every chunk that touches it.
            //
            // Vue, the router and Pinia stay peers, and that is not a
            // preference: two Vue instances break `provide`/`inject` silently.
            external: ['vue', 'vue-router', 'pinia', 'quasar', '@saasicat/core'],
            output: {
                entryFileNames: '[name].js',
                // Shared between components — a feature two pages both render.
                // Hashed because its contents decide its identity, and
                // `build-and-prune.mjs` is what keeps yesterday's hash from
                // piling up beside today's.
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: 'assets/[name][extname]',
            },
        },
    },
});
