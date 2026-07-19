// Q.4.1 — Gemeinsame Codegen-Logik für `gen-types-from-schemas.mjs` und
// `tests/codegen-drift.test.js`. Beide nutzen exakt denselben Compile-Pfad,
// damit das Drift-Gate semantisch identisch zum Build-Pfad ist.

import { compile } from 'json-schema-to-typescript';

export const HEADER = `// AUTO-GENERATED — nicht manuell editieren.
//
// Quelle: @saasicat/spec/schemas/{{schemaFile}}
// Regenerieren: \`pnpm --filter @saasicat/types gen:types\`
// Drift-Gate: tests/codegen-drift.test.js bricht den PR, wenn Schema und
// generierter Output auseinanderlaufen.
`;

const COMPILE_OPTIONS = {
    bannerComment: '',
    style: { singleQuote: true, tabWidth: 4 },
    additionalProperties: false,
};

/**
 * Schemas, die nur `$defs` ohne Top-Level-`properties` liefern (z. B.
 * promo-code.schema.json), produzieren ohne dieses Helper-Setup ein leeres
 * `interface PromoCode {}`. Wir kompilieren deshalb ZUSÄTZLICH jeden
 * `$defs`-Eintrag als eigenen Root, sodass das Drift-Gate auch die
 * Sub-Definitionen abdeckt.
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
            // Ignorieren — der Drift-Gate-Test fängt Cases, die wir wirklich
            // brauchen. $defs ohne sinnvolle TS-Form (z. B. reine String-Enums
            // ohne Wrapping) können hier still scheitern.

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
