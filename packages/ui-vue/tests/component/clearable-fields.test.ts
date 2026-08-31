// Quasar's clearable × emits `null`, never `''`.
//
// `use-field.js` does `emit('update:modelValue', null)` unconditionally, so any
// model bound to a `clearable` field is `string | null` no matter how it was
// initialised. Two search filters had it typed as `string` and called `.trim()`
// on it, which threw the moment a user cleared the box — a crash reachable by
// one click, on two pages, that no test and no typecheck saw.
//
// This checks the source rather than mounting: the hazard is a type claim, and
// there is no cheap way to render every filter on every page.

// @requirement SC-UI-004 — Nothing is written until the person saves or publishes

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const SRC = resolve(process.cwd(), 'src');

function vueFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.vue')) found.push(full);
        }
    };
    walk(SRC);
    return found.sort();
}

/** Models bound to a field that also carries `clearable`. */
function clearableModels(source: string): Set<string> {
    // Fields span several lines; each opening tag runs up to its `>`.
    const models = new Set<string>();
    for (const [, body] of source.matchAll(/<q-(?:input|select)\b([^>]*)>/g)) {
        if (!/\bclearable\b/.test(body!)) continue;
        const model = /v-model="([\w.]+)"/.exec(body!);
        if (model) models.add(model[1]!.split('.').pop()!);
    }
    return models;
}

describe('clearable fields', () => {
    test('the sweep finds the fields it claims to check', () => {
        const total = vueFiles().reduce(
            (n, f) => n + clearableModels(readFileSync(f, 'utf8')).size,
            0,
        );
        expect(total).toBeGreaterThan(5);
    });

    test('no clearable model has a string method called on it unguarded', () => {
        const STRING_OPS = 'trim|toLocaleLowerCase|toLowerCase|slice|split|padStart|charAt';
        const offenders: string[] = [];

        for (const file of vueFiles()) {
            const source = readFileSync(file, 'utf8');
            for (const model of clearableModels(source)) {
                // `x.value.trim()` or `x.trim()` with no `??` in front of it.
                const unguarded = new RegExp(
                    String.raw`(?<!\?\?\s{0,4}'[^']*'\s{0,4}\)\s{0,4})\b${model}(?:\.value)?\.(?:${STRING_OPS})\(`,
                );
                const guarded = new RegExp(String.raw`\(\s*${model}(?:\.value)?\s*\?\?`);
                if (unguarded.test(source) && !guarded.test(source)) {
                    offenders.push(`${relative(SRC, file)}: ${model}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
