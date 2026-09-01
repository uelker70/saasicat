// Q.4.1 — Shared codegen logic for `gen-types-from-schemas.mjs` and
// `tests/codegen-drift.test.js`. Both use exactly the same compile path,
// so that the drift-gate is semantically identical to the build path.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'json-schema-to-typescript';
import { format, resolveConfig } from 'prettier';

export const SCHEMA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../spec/schemas');

export const HEADER = `// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/{{schemaFile}}
// Regenerate: \`pnpm --filter @saasicat/core gen:types\`
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

    // Dropping a declaration leaves the blank line that separated it behind, and
    // two blank lines in a row is the one thing Prettier will not let a
    // committed file keep. Collapsed here rather than in the caller: this is the
    // only place blocks are joined.
    return formatAsGenerated(blocks.join('\n').replace(/\n{3,}/g, '\n\n'));
}

/**
 * The repository's own Prettier settings, applied to what the compiler emits.
 *
 * `format:check` covers `src/generated/`, and the drift gate compares this
 * output against the committed file — so a compiler line that Prettier would
 * rewrite makes the two checks demand opposite files, and the schema cannot be
 * landed at all. It took one union of six members to reach 100 columns.
 */
async function formatAsGenerated(source) {
    const sampleTarget = join(SCHEMA_DIR, '..', '..', 'core', 'src', 'generated', 'sample.ts');
    const options = (await resolveConfig(sampleTarget)) ?? {};
    return format(source, { ...options, filepath: sampleTarget, parser: 'typescript' });
}

function filterAlreadySeen(compiled, seen) {
    const lines = compiled.split('\n');
    const out = [];
    // A declaration's own doc comment sits above it, so it is held back until
    // the declaration decides its fate. Emitting it first left the comment
    // behind whenever the declaration was dropped, and a description with
    // nothing under it reads as a type somebody deleted by hand.
    let pending = [];
    let skip = false;
    let braceDepth = 0;
    let inDocComment = false;
    for (const line of lines) {
        const m = line.match(/^export (?:interface|type) ([A-Za-z0-9_]+)/);
        if (m) {
            skip = seen.has(m[1]);
            braceDepth = 0;
            if (!skip) out.push(...pending);
            pending = [];
        }
        const atTopLevel = braceDepth === 0 && !m;
        if (atTopLevel && !inDocComment && line.startsWith('/**')) inDocComment = true;
        const holdBack = atTopLevel && (inDocComment || line.trim().length === 0);
        if (!skip) (holdBack ? pending : out).push(line);
        if (inDocComment && line.includes('*/')) inDocComment = false;
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
    out.push(...pending);
    return out.join('\n');
}

/**
 * The schemas that get a generated type, read off the schema directory.
 *
 * Derived rather than listed because the generator and the drift gate both need
 * the answer, and a hand-written list in each is a schema that is generated by
 * one and checked by neither — the drift gate would stay green over a file it
 * never compiles. The root type name is the schema's own `title`, which is
 * where the contract already states what the payload is called.
 */
export function schemasToGenerate(directory = SCHEMA_DIR) {
    return readdirSync(directory)
        .filter((name) => name.endsWith('.schema.json'))
        .sort()
        .map((file) => {
            const schema = JSON.parse(readFileSync(join(directory, file), 'utf8'));
            if (typeof schema.title !== 'string' || schema.title.length === 0) {
                throw new Error(
                    `${file} has no \`title\`. It names the generated root type, so a schema ` +
                        `without one cannot be generated. Add a title and regenerate.`,
                );
            }
            return { file, rootName: schema.title };
        });
}
