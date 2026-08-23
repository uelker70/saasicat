// The canonical list of public entry points, derived from `package.json`
// `exports` — the one place that actually defines them.
//
// Everything else reads from here: the tsup entry list, the shared-bundle
// stub generator, and the cross-entry identity test. A hand-maintained copy
// in any of those would let a newly added entry slip through: it would keep
// its own duplicated CJS bundle, the classes inside it would stop matching
// the other entries, and no check would notice (see `src/_all-entries.ts`).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** './checkout-offer' → 'checkoutOfferNs'; '.' → 'rootNs' */
export function namespaceFor(exportPath) {
    if (exportPath === '.') return 'rootNs';
    const camel = exportPath
        .replace(/^\.\//, '')
        .split('-')
        .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
        .join('');
    return `${camel}Ns`;
}

/**
 * @returns {Array<{exportPath: string, srcFile: string, distBase: string, namespace: string}>}
 */
export function publicEntries() {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    return (
        Object.keys(pkg.exports ?? {})
            .filter((exportPath) => exportPath === '.' || exportPath.startsWith('./'))
            // `./package.json` is exported for tooling that reads the manifest; it
            // is a file, not a module with an `index.ts` behind it.
            .filter((exportPath) => !exportPath.endsWith('.json'))
            .map((exportPath) => {
                const dir = exportPath === '.' ? '' : `${exportPath.replace(/^\.\//, '')}/`;
                return {
                    exportPath,
                    srcFile: `src/${dir}index.ts`,
                    distBase: `${dir}index`,
                    namespace: namespaceFor(exportPath),
                };
            })
    );
}
