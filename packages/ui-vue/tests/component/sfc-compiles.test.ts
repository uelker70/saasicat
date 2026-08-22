// Every `.vue` in the package has to compile.
//
// This is not as obvious as it sounds: pages and components ship as source
// (`"./components/*": "./src/components/*"`), so `pnpm build` never runs the
// SFC compiler over them — the consumer's Vite does, at their build time. A
// broken template or a `withDefaults` default that references a local const
// therefore passes build and typecheck here and breaks in someone else's app.
//
// Both of those have happened. This runs the compiler over every file instead.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc';
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

function compileErrorFor(file: string): string | null {
    const id = relative(SRC, file);
    const source = readFileSync(file, 'utf8');

    try {
        const { descriptor, errors } = parse(source, { filename: file });
        if (errors.length > 0) return String(errors[0]);

        if (descriptor.script || descriptor.scriptSetup) {
            compileScript(descriptor, { id });
        }
        if (descriptor.template) {
            const { errors: templateErrors } = compileTemplate({
                source: descriptor.template.content,
                filename: file,
                id,
            });
            if (templateErrors.length > 0) return String(templateErrors[0]);
        }
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

describe('every SFC compiles', () => {
    test('the sweep finds the files it claims to check', () => {
        expect(vueFiles().length).toBeGreaterThan(50);
    });

    test('no file fails the SFC compiler', () => {
        const failures = vueFiles()
            .map((file) => ({ file: relative(SRC, file), error: compileErrorFor(file) }))
            .filter((r) => r.error !== null)
            .map((r) => `${r.file}: ${r.error}`);

        expect(failures).toEqual([]);
        // Compiling every SFC takes a few seconds, and more when the rest of
        // the suite is competing for workers.
    }, 30_000);
});
