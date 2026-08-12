#!/usr/bin/env node
// `saasicat` — bootstrap CLI for the SaaSiCat framework.
//
// Sub-commands:
//   schema apply [--prisma-schema=PATH] [--fragments=01,02,03]
//                [--all] [--dry-run]
//       Inserts missing platform Prisma models into your schema.prisma.
//       Idempotent; existing models are left untouched.
//
//   schema check [--prisma-schema=PATH] [--fragments=01,02,03]
//       Reports what your schema is missing relative to the canonical
//       fragments. Read-only; exits 1 on drift so CI can gate on it.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

import { applyFragmentBlocks, checkSchema, extractModelBlocks } from '../dist/index.js';

const require_ = createRequire(import.meta.url);

function parseArgs(argv) {
    const flags = {};
    for (const arg of argv) {
        if (arg.startsWith('--')) {
            const [key, value] = arg.slice(2).split('=');
            flags[key] = value === undefined ? true : value;
        }
    }
    return flags;
}

function resolveFragmentsDir() {
    // Resolve the `@saasicat/spec/prisma-fragments/` directory.
    // We try `require.resolve` on the package entry and step back one
    // directory to find the fragments.
    const specEntry = require_.resolve('@saasicat/spec');
    const root = dirname(specEntry);
    const candidate = join(root, 'prisma-fragments');
    if (!existsSync(candidate)) {
        throw new Error(
            `prisma-fragments/ directory not found at ${candidate}. ` +
                'Make sure @saasicat/spec is installed.',
        );
    }
    return candidate;
}

async function selectFragmentFiles(dir, filter) {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.prisma')).sort();
    if (!filter) return files;

    // A selector that matches nothing is a typo, and silently dropping it would
    // leave part of the requested schema surface unchecked while the command
    // still exits 0 — the worst outcome for something used as a CI gate.
    const available = new Set(files.map((f) => f.split('-')[0]));
    const unknown = filter.filter((prefix) => !available.has(prefix));
    if (unknown.length > 0) {
        console.error(
            `✗ Unknown fragments: ${unknown.join(', ')}. ` +
                `Available: ${[...available].join(', ')}`,
        );
        process.exit(1);
    }
    return files.filter((f) => filter.includes(f.split('-')[0]));
}

async function loadFragments(dir, filter) {
    const selected = await selectFragmentFiles(dir, filter);
    const blocks = new Map();
    for (const file of selected) {
        const content = await readFile(join(dir, file), 'utf8');
        const fileBlocks = extractModelBlocks(content);
        for (const [name, body] of fileBlocks) {
            if (!blocks.has(name)) {
                blocks.set(name, body);
            }
        }
    }
    return { files: selected, blocks };
}

function parseFragmentFilter(raw) {
    return raw ? raw.split(',').map((s) => s.padStart(2, '0')) : null;
}

async function readSchemaOrExit(args) {
    const schemaPath = resolve(args['prisma-schema'] ?? 'prisma/schema.prisma');
    if (!existsSync(schemaPath)) {
        console.error(`✗ schema.prisma not found: ${schemaPath}`);
        process.exit(1);
    }
    return { schemaPath, schema: await readFile(schemaPath, 'utf8') };
}

async function cmdSchemaApply(args) {
    const { schemaPath, schema } = await readSchemaOrExit(args);

    const fragmentsDir = resolveFragmentsDir();
    const filter = parseFragmentFilter(args.fragments);
    if (!filter && !args.all) {
        console.error('✗ Pass either --fragments=01,02,03 or --all. Available fragments:');
        const files = (await readdir(fragmentsDir)).filter((f) => f.endsWith('.prisma')).sort();
        for (const f of files) console.error(`    ${f}`);
        process.exit(1);
    }

    const { files, blocks } = await loadFragments(fragmentsDir, filter);
    if (blocks.size === 0) {
        console.error('✗ No models found in the selected fragments.');
        process.exit(1);
    }

    const result = applyFragmentBlocks(schema, blocks, {
        fragmentLabel: files.join(', '),
    });

    if (result.added.length === 0) {
        console.log(`→ Nothing to do. Models already present: ${result.skipped.join(', ')}`);
        return;
    }

    if (args['dry-run']) {
        console.log(`(--dry-run) Would append: ${result.added.join(', ')}`);
        if (result.skipped.length) {
            console.log(`(--dry-run) Skipped (already present): ${result.skipped.join(', ')}`);
        }
        console.log('');
        console.log(result.schema.slice(schema.length));
        return;
    }

    await writeFile(schemaPath, result.schema, 'utf8');
    console.log(`✓ Appended ${result.added.length} model(s): ${result.added.join(', ')}`);
    if (result.skipped.length) {
        console.log(`→ Skipped (already present): ${result.skipped.join(', ')}`);
    }
    console.log('');
    console.log('Next steps:');
    console.log('  1. Review schema.prisma — especially the FK pointers to User/Tenant');
    console.log('  2. pnpm prisma migrate dev --name add_saasicat');
}

const MISMATCH_LABELS = {
    type: 'type',
    optionality: 'optionality',
    list: 'list',
};

function printCheckReport(report) {
    if (report.missingFields.length > 0) {
        console.log(`✗ Missing fields (${report.missingFields.length}):`);
        for (const { model, field, type } of report.missingFields) {
            console.log(`    ${`${model}.${field}`.padEnd(44)} ${type}`);
        }
        console.log('');
    }

    if (report.missingEnumValues.length > 0) {
        console.log(`✗ Missing enum values (${report.missingEnumValues.length}):`);
        for (const entry of report.missingEnumValues) {
            console.log(`    ${entry.enum}.${entry.value}`);
        }
        console.log('');
    }

    if (report.fieldMismatches.length > 0) {
        console.log(`✗ Diverging fields (${report.fieldMismatches.length}):`);
        for (const { model, field, reason, expected, actual } of report.fieldMismatches) {
            const location = `${model}.${field}`.padEnd(44);
            console.log(
                `    ${location} [${MISMATCH_LABELS[reason]}] expected ${expected}, found ${actual}`,
            );
        }
        console.log('');
    }

    const breaking = report.missingBlockAttributes.filter((a) => a.kind !== 'index');
    if (breaking.length > 0) {
        console.log(`✗ Missing constraints (${breaking.length}):`);
        for (const { model, kind, expected, actual } of breaking) {
            const suffix = kind === 'map' ? ` — found: @@map("${actual}")` : '';
            console.log(`    ${model.padEnd(28)} ${expected}${suffix}`);
        }
        console.log('');
    }

    const missingIndexes = report.missingBlockAttributes.filter((a) => a.kind === 'index');
    if (missingIndexes.length > 0) {
        console.log(`→ Missing indexes (${missingIndexes.length}):`);
        for (const { model, expected } of missingIndexes) {
            console.log(`    ${model.padEnd(28)} ${expected}`);
        }
        console.log('  Not an error — costs query time, but breaks nothing.');
        console.log('');
    }

    const absent = [...report.absentModels, ...report.absentEnums];
    if (absent.length > 0) {
        console.log(`→ Not adopted (${absent.length}): ${absent.join(', ')}`);
        console.log('  Not an error — the app does not use these fragments.');
        console.log('');
    }
}

async function cmdSchemaCheck(args) {
    const { schemaPath, schema } = await readSchemaOrExit(args);
    const fragmentsDir = resolveFragmentsDir();
    const filter = parseFragmentFilter(args.fragments);
    const files = await selectFragmentFiles(fragmentsDir, filter);

    if (files.length === 0) {
        console.error('✗ No fragments selected.');
        process.exit(1);
    }

    const fragments = [];
    for (const file of files) {
        fragments.push(await readFile(join(fragmentsDir, file), 'utf8'));
    }

    console.log(`→ Checking ${schemaPath} against ${files.length} fragment(s) from @saasicat/spec`);
    console.log('');

    const report = checkSchema(fragments.join('\n'), schema);
    printCheckReport(report);

    const checked = `${report.checkedModelCount} Model(s), ${report.checkedEnumCount} Enum(s)`;
    if (report.ok) {
        console.log(`✓ No drift. Checked ${checked}.`);
        return;
    }

    console.log(`✗ Drift found (checked ${checked}).`);
    console.log('  Add the missing fields and enum values, then migrate.');
    console.log('  Review diverging fields: platform code reads them with the spec type.');
    process.exit(1);
}

function runChild(cmd, args, opts = {}) {
    return new Promise((resolve_, reject) => {
        const proc = spawn(cmd, args, { stdio: 'inherit', ...opts });
        proc.on('error', reject);
        proc.on('exit', (code) => {
            if (code === 0) resolve_(undefined);
            else reject(new Error(`${cmd} ${args.join(' ')} → exit ${code}`));
        });
    });
}

async function cmdSchemaMigrate(args) {
    if (!args.name) {
        console.error('✗ --name=<migration_name> is required.');
        process.exit(1);
    }

    console.log(
        `→ Step 1/2: saasicat schema apply ${args['fragments'] ? `--fragments=${args['fragments']}` : '--all'}`,
    );
    await cmdSchemaApply({
        ...args,
        all: args['fragments'] ? undefined : true,
    });

    console.log(
        `→ Step 2/2: ${args['package-manager'] ?? 'pnpm'} prisma migrate dev --name ${args.name}`,
    );
    const pmRunner = args['package-manager'] ?? 'pnpm';
    await runChild(pmRunner, ['prisma', 'migrate', 'dev', '--name', args.name]);
    console.log('✓ schema migrate succeeded.');
}

async function main() {
    const [, , cmd, sub, ...rest] = process.argv;
    if (cmd === 'schema' && sub === 'apply') {
        return cmdSchemaApply(parseArgs(rest));
    }
    if (cmd === 'schema' && sub === 'check') {
        return cmdSchemaCheck(parseArgs(rest));
    }
    if (cmd === 'schema' && sub === 'migrate') {
        return cmdSchemaMigrate(parseArgs(rest));
    }
    if (cmd === '--help' || cmd === '-h' || !cmd) {
        console.log('Usage: saasicat <command> [...args]');
        console.log('');
        console.log('Commands:');
        console.log('  schema apply --all                       insert all platform models');
        console.log('  schema apply --fragments=01,02           insert only these fragments');
        console.log('  schema apply --dry-run                   print the diff only');
        console.log(
            '  schema check                             report drift against @saasicat/spec',
        );
        console.log('  schema check --fragments=01,02           check only these fragments');
        console.log('  schema migrate --name=<name>             apply --all + prisma migrate dev');
        console.log('');
        console.log('Optional --prisma-schema=PATH (default prisma/schema.prisma).');
        console.log('Optional --package-manager=pnpm|npm|yarn (default pnpm).');
        return;
    }
    console.error(`Unknown command: ${cmd} ${sub ?? ''}`);
    process.exit(1);
}

main().catch((err) => {
    console.error('✗ ' + (err?.message ?? String(err)));
    process.exit(99);
});
