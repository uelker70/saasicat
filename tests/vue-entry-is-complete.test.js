import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `@saasicat/ui-vue` and `@saasicat/ui-vue/vue` publish the same layer.
//
// The main entry is the wider of the two: it re-exports the whole `client`
// layer as well, plus the five framework-free type and i18n modules the SFC
// directories may publish. `./vue` is the narrow door — the composables and
// nothing else.
//
// That makes one of them a subset of the other, and a subset maintained by
// hand drifts. A composable added to the main entry and forgotten here would
// be missing from the narrow door for no reason anyone could state; the
// reverse would publish something the wide entry does not.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'packages', 'ui-vue', 'src');

/** The `./vue/…` modules an entry re-exports, as bare names. */
function vueReExports(file, prefix) {
    return [
        ...readFileSync(file, 'utf8').matchAll(new RegExp(`from '${prefix}([\\w.-]+)\\.js'`, 'g')),
    ]
        .map((m) => m[1])
        .sort();
}

describe('the vue entry publishes exactly the layer the main entry re-exports', () => {
    const fromMain = vueReExports(join(SRC, 'index.ts'), './vue/');
    const fromVue = vueReExports(join(SRC, 'vue', 'index.ts'), './');

    test('there is a layer to compare', () => {
        // Both lists empty would satisfy the equality below without saying
        // anything — the shape of a guard that guards nothing.
        assert.ok(fromMain.length >= 20, `only ${fromMain.length} vue modules in the main entry`);
    });

    test('the two lists are the same', () => {
        assert.deepEqual(
            fromVue,
            fromMain,
            'The narrow entry and the main entry disagree about the Vue layer. ' +
                'Add the module to both, or to neither.',
        );
    });

    test('the vue entry re-exports nothing outside its own layer', () => {
        // `./vue` is the layer, not a second main entry. A `client` re-export
        // here would make the two doors the same width and the distinction
        // pointless.
        const source = readFileSync(join(SRC, 'vue', 'index.ts'), 'utf8');
        const foreign = [...source.matchAll(/from '(\.\.\/[^']+)'/g)].map((m) => m[1]);
        assert.deepEqual(foreign, [], 'the vue entry reaches outside src/vue/');
    });
});
