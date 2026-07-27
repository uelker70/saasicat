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
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P5.

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
            `prisma-fragments/-Verzeichnis nicht gefunden unter ${candidate}. ` +
                'Stelle sicher, dass @saasicat/spec installiert ist.',
        );
    }
    return candidate;
}

async function selectFragmentFiles(dir, filter) {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.prisma')).sort();
    if (!filter) return files;
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
        console.error(`✗ schema.prisma nicht gefunden: ${schemaPath}`);
        process.exit(1);
    }
    return { schemaPath, schema: await readFile(schemaPath, 'utf8') };
}

async function cmdSchemaApply(args) {
    const { schemaPath, schema } = await readSchemaOrExit(args);

    const fragmentsDir = resolveFragmentsDir();
    const filter = parseFragmentFilter(args.fragments);
    if (!filter && !args.all) {
        console.error(
            '✗ Entweder --fragments=01,02,03 oder --all übergeben. ' +
                'Verfügbare Fragmente:',
        );
        const files = (await readdir(fragmentsDir)).filter((f) => f.endsWith('.prisma')).sort();
        for (const f of files) console.error(`    ${f}`);
        process.exit(1);
    }

    const { files, blocks } = await loadFragments(fragmentsDir, filter);
    if (blocks.size === 0) {
        console.error('✗ Keine Models in den gewählten Fragmenten gefunden.');
        process.exit(1);
    }

    const result = applyFragmentBlocks(schema, blocks, {
        fragmentLabel: files.join(', '),
    });

    if (result.added.length === 0) {
        console.log(`→ Nichts zu tun. Bereits vorhandene Models: ${result.skipped.join(', ')}`);
        return;
    }

    if (args['dry-run']) {
        console.log(`(--dry-run) Würde anfügen: ${result.added.join(', ')}`);
        if (result.skipped.length) {
            console.log(`(--dry-run) Übersprungen (vorhanden): ${result.skipped.join(', ')}`);
        }
        console.log('');
        console.log(result.schema.slice(schema.length));
        return;
    }

    await writeFile(schemaPath, result.schema, 'utf8');
    console.log(`✓ ${result.added.length} Model(s) angefügt: ${result.added.join(', ')}`);
    if (result.skipped.length) {
        console.log(`→ Übersprungen (vorhanden): ${result.skipped.join(', ')}`);
    }
    console.log('');
    console.log('Nächste Schritte:');
    console.log('  1. schema.prisma reviewen (insbesondere FK-Pointer zu User/Tenant)');
    console.log('  2. pnpm prisma migrate dev --name add_saas_platform');
}

const MISMATCH_LABELS = {
    type: 'Typ',
    optionality: 'Optionalität',
    list: 'Liste',
};

function printCheckReport(report) {
    if (report.missingFields.length > 0) {
        console.log(`✗ Fehlende Felder (${report.missingFields.length}):`);
        for (const { model, field, type } of report.missingFields) {
            console.log(`    ${`${model}.${field}`.padEnd(44)} ${type}`);
        }
        console.log('');
    }

    if (report.missingEnumValues.length > 0) {
        console.log(`✗ Fehlende Enum-Werte (${report.missingEnumValues.length}):`);
        for (const entry of report.missingEnumValues) {
            console.log(`    ${entry.enum}.${entry.value}`);
        }
        console.log('');
    }

    if (report.fieldMismatches.length > 0) {
        console.log(`✗ Abweichende Felder (${report.fieldMismatches.length}):`);
        for (const { model, field, reason, expected, actual } of report.fieldMismatches) {
            const location = `${model}.${field}`.padEnd(44);
            console.log(
                `    ${location} [${MISMATCH_LABELS[reason]}] erwartet ${expected}, vorhanden ${actual}`,
            );
        }
        console.log('');
    }

    const breaking = report.missingBlockAttributes.filter((a) => a.kind !== 'index');
    if (breaking.length > 0) {
        console.log(`✗ Fehlende Constraints (${breaking.length}):`);
        for (const { model, kind, expected, actual } of breaking) {
            const suffix = kind === 'map' ? ` — vorhanden: @@map("${actual}")` : '';
            console.log(`    ${model.padEnd(28)} ${expected}${suffix}`);
        }
        console.log('');
    }

    const missingIndexes = report.missingBlockAttributes.filter((a) => a.kind === 'index');
    if (missingIndexes.length > 0) {
        console.log(`→ Fehlende Indizes (${missingIndexes.length}):`);
        for (const { model, expected } of missingIndexes) {
            console.log(`    ${model.padEnd(28)} ${expected}`);
        }
        console.log('  Kein Fehler — kostet Query-Zeit, bricht aber nichts.');
        console.log('');
    }

    const absent = [...report.absentModels, ...report.absentEnums];
    if (absent.length > 0) {
        console.log(`→ Nicht übernommen (${absent.length}): ${absent.join(', ')}`);
        console.log('  Kein Fehler — diese Fragmente nutzt die App nicht.');
        console.log('');
    }
}

async function cmdSchemaCheck(args) {
    const { schemaPath, schema } = await readSchemaOrExit(args);
    const fragmentsDir = resolveFragmentsDir();
    const filter = parseFragmentFilter(args.fragments);
    const files = await selectFragmentFiles(fragmentsDir, filter);

    if (files.length === 0) {
        console.error('✗ Keine Fragmente ausgewählt.');
        process.exit(1);
    }

    const fragments = [];
    for (const file of files) {
        fragments.push(await readFile(join(fragmentsDir, file), 'utf8'));
    }

    console.log(`→ Prüfe ${schemaPath} gegen ${files.length} Fragment(e) aus @saasicat/spec`);
    console.log('');

    const report = checkSchema(fragments.join('\n'), schema);
    printCheckReport(report);

    const checked = `${report.checkedModelCount} Model(s), ${report.checkedEnumCount} Enum(s)`;
    if (report.ok) {
        console.log(`✓ Kein Drift. ${checked} geprüft.`);
        return;
    }

    console.log(`✗ Drift gefunden (${checked} geprüft).`);
    console.log('  Fehlende Felder und Enum-Werte ergänzen, dann migrieren.');
    console.log('  Abweichende Felder prüfen: Plattform-Code liest sie mit dem Spec-Typ.');
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
        console.error('✗ --name=<migration_name> ist Pflicht.');
        process.exit(1);
    }

    console.log(`→ Schritt 1/2: saasicat schema apply ${args['fragments'] ? `--fragments=${args['fragments']}` : '--all'}`);
    await cmdSchemaApply({
        ...args,
        all: args['fragments'] ? undefined : true,
    });

    console.log(`→ Schritt 2/2: pnpm prisma migrate dev --name ${args.name}`);
    const pmRunner = args['package-manager'] ?? 'pnpm';
    await runChild(pmRunner, ['prisma', 'migrate', 'dev', '--name', args.name]);
    console.log('✓ schema migrate erfolgreich.');
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
        console.log('  schema apply --all                       alle Plattform-Models einfügen');
        console.log('  schema apply --fragments=01,02           nur diese Fragmente einfügen');
        console.log('  schema apply --dry-run                   nur Diff ausgeben');
        console.log('  schema check                             Drift gegen @saasicat/spec melden');
        console.log('  schema check --fragments=01,02           nur diese Fragmente prüfen');
        console.log('  schema migrate --name=<name>             apply --all + prisma migrate dev');
        console.log('');
        console.log('Optional --prisma-schema=PATH (default prisma/schema.prisma).');
        console.log('Optional --package-manager=pnpm|npm|yarn (default pnpm).');
        return;
    }
    console.error(`Unbekannter Befehl: ${cmd} ${sub ?? ''}`);
    process.exit(1);
}

main().catch((err) => {
    console.error('✗ ' + (err?.message ?? String(err)));
    process.exit(99);
});
