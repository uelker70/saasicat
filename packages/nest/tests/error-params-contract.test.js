import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ERROR_MESSAGES_EN } from '@saasicat/types';

// A code is the i18n contract: a consumer resolves a template by code and fills
// its `{placeholders}` from the error body. That only works if every throw site
// carrying a code actually supplies the values its template names — and if all
// sites for one code agree on the key names. Neither is expressible in the type
// system, so it is checked here against the source.
//
// This is what catches a rename that updates one throw site and not its
// sibling: the review of #99 found five codes whose params keys differed by
// call site, which no unit test noticed.

const SRC = new URL('../src', import.meta.url).pathname;

function sourceFiles(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return path.endsWith('.ts') ? [path] : [];
    });
}

/** Reads the balanced `(`…`)` or `{`…`}` block starting at or after `from`. */
function block(text, from, open, close) {
    const start = text.indexOf(open, from);
    if (start === -1) return '';
    let depth = 1;
    let i = start + 1;
    while (i < text.length && depth > 0) {
        if (text[i] === open) depth += 1;
        else if (text[i] === close) depth -= 1;
        i += 1;
    }
    return text.slice(start, i);
}

/** Every `new *Exception({ code, … })` in the sources, with the keys it sends. */
function throwSites() {
    const sites = [];
    for (const file of sourceFiles(SRC)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/new \w*Exception\(/g)) {
            const arg = block(text, match.index + 3, '(', ')');
            const code = arg.match(/code:\s*(?:\w+\.)?([A-Z][A-Z0-9_]*)/)?.[1];
            if (!code) continue;

            const keys = new Set();
            const paramsAt = arg.search(/params:\s*\{/);
            if (paramsAt !== -1) {
                for (const [, key] of block(arg, paramsAt, '{', '}').matchAll(/(\w+)\s*:/g)) {
                    keys.add(key);
                }
                // shorthand `params: { received }` — the delimiter has to be a
                // lookahead, or a global match eats the comma between two
                // shorthand keys and only ever sees the first of them.
                for (const [, key] of block(arg, paramsAt, '{', '}').matchAll(
                    /[{,]\s*(\w+)\s*(?=[,}])/g,
                )) {
                    keys.add(key);
                }
            }
            const paramKeys = new Set(keys);
            // Top-level fields count for interpolation too: the resolver merges
            // them under params. They are per-site diagnostics though, so they
            // do not take part in the shape comparison below.
            for (const [, key] of arg.matchAll(/^\s{12,}(\w+)[:,]/gm)) keys.add(key);

            const line = text.slice(0, match.index).split('\n').length;
            sites.push({ code, keys, paramKeys, where: `${file.slice(SRC.length)}:${line}` });
        }
    }
    return sites;
}

const SITES = throwSites();
const placeholders = (template) => [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

describe('error params contract', () => {
    test('the sources contain coded throw sites at all', () => {
        assert.ok(
            SITES.length > 50,
            `only found ${SITES.length} coded throw sites — parser broken?`,
        );
    });

    test('every throw site supplies the placeholders its message template names', () => {
        const gaps = [];
        for (const site of SITES) {
            const template = ERROR_MESSAGES_EN[site.code];
            if (!template) continue; // covered by the catalogue completeness test
            const missing = placeholders(template).filter((name) => !site.keys.has(name));
            if (missing.length)
                gaps.push(`${site.where} (${site.code}) misses ${missing.join(', ')}`);
        }
        assert.deepEqual(gaps, [], `\n  ${gaps.join('\n  ')}\n`);
    });

    // Compares `params` only. Top-level fields are per-site diagnostics and
    // legitimately differ — `validUntil` on one expiry branch, `offers` on the
    // upsell 403, `valid` where a guard mirrors a preview result. What must not
    // differ is the name a code gives the same value, because that is what a
    // consumer's translation interpolates.
    test('all throw sites for one code agree on their params key names', () => {
        const byCode = new Map();
        for (const site of SITES) {
            const shape = [...site.paramKeys].sort().join(',');
            if (!byCode.has(site.code)) byCode.set(site.code, new Map());
            byCode.get(site.code).set(shape, site.where);
        }
        const divergent = [...byCode]
            .filter(([, shapes]) => shapes.size > 1)
            .map(
                ([code, shapes]) =>
                    `${code}: ${[...shapes].map(([shape, where]) => `{${shape}} at ${where}`).join(' vs ')}`,
            );
        assert.deepEqual(divergent, [], `\n  ${divergent.join('\n  ')}\n`);
    });
});
