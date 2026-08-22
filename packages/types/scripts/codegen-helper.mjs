// Q.4.1 — Shared codegen logic for `gen-types-from-schemas.mjs` and
// `tests/codegen-drift.test.js`. Both use exactly the same compile path,
// so that the drift-gate is semantically identical to the build path.

import { compile } from 'json-schema-to-typescript';

export const HEADER = `// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/{{schemaFile}}
// Regenerate: \`pnpm --filter @saasicat/types gen:types\`
// Drift gate: tests/codegen-drift.test.js fails the PR when the schema and
// the generated output diverge.
`;

const COMPILE_OPTIONS = {
    bannerComment: '',
    style: { singleQuote: true, tabWidth: 4 },
    additionalProperties: false,
};

/**
 * Schemas that only provide `$defs` without top-level `properties` (e.g.
 * promo-code.schema.json) produce an empty `interface PromoCode {}` without
 * this helper setup. We therefore ADDITIONALLY compile every `$defs` entry as
 * its own root, so that the drift-gate also covers the sub-definitions.
 */
export async function compileSchemaWithDefs(schema, rootName) {
    const seen = new Set();
    const blocks = [];

    if (!schema.title) schema.title = rootName;
    const rootCompiled = await compile(schema, rootName, COMPILE_OPTIONS);
    blocks.push(rootCompiled);
    for (const m of rootCompiled.matchAll(/^export (?:interface|type) ([A-Za-z0-9_]+)/gm)) {
        seen.add(m[1]);
    }

    const defs = schema.$defs ?? {};
    for (const [defName, defSchema] of Object.entries(defs)) {
        if (seen.has(defName)) continue;
        const subSchema = { ...defSchema, $defs: defs, title: defName };
        try {
            const subCompiled = await compile(subSchema, defName, COMPILE_OPTIONS);
            const filtered = filterAlreadySeen(subCompiled, seen);
            if (filtered.trim().length > 0) {
                blocks.push(filtered);
                for (const m of filtered.matchAll(/^export (?:interface|type) ([A-Za-z0-9_]+)/gm)) {
                    seen.add(m[1]);
                }
            }
        } catch (err) {
            // Ignore — the drift-gate test catches the cases we really
            // need. $defs without a meaningful TS form (e.g. pure string enums
            // without wrapping) may fail silently here.

            console.warn(`  ⚠ ${defName}: ${err.message}`);
        }
    }

    return blocks.join('\n');
}

function filterAlreadySeen(compiled, seen) {
    const lines = compiled.split('\n');
    const out = [];
    let skip = false;
    let braceDepth = 0;
    for (const line of lines) {
        const m = line.match(/^export (?:interface|type) ([A-Za-z0-9_]+)/);
        if (m) {
            skip = seen.has(m[1]);
            braceDepth = 0;
        }
        if (!skip) out.push(line);
        for (const c of line) {
            if (c === '{') braceDepth++;
            else if (c === '}') braceDepth--;
        }
        if (skip && line.match(/^export type [A-Za-z0-9_]+ =.*;\s*$/)) {
            skip = false;
        }
        if (skip && braceDepth === 0 && line.includes('}')) {
            skip = false;
        }
    }
    return out.join('\n');
}
