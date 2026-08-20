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
//   schema migrate --name=X [--package-manager=pnpm|npm|yarn]
//       apply --all, then `prisma migrate dev`, then append the constraints
//       Prisma's DSL cannot express to the migration it just wrote.
//
//   init --project-key=X [--quota=key:Model]... [--app-name=X] [--api-base=X]
//        [--skip-hasher] [--dry-run] [--dir=.]
//       Writes the platform wiring — config, persistence, manifest
//       contribution, admin module, one provider per quota — and adds
//       `SaaSiCatModule.forRoot(...)` to an existing `src/app.module.ts`.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
    LIMIT_FILTER_PROVIDER,
    appendConstraints,
    assertModelsExist,
    enableFkPointers,
    extractModelNames,
    applyFragmentBlocks,
    applyTokens,
    checkSchema,
    extractModelBlocks,
    findFkPointers,
    hasConstraints,
    kebabCase,
    newestMigration,
    patchAppModule,
    planInit,
} from '../dist/index.js';

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

    // The FK pointers, on whatever the schema ends up being — including a
    // schema that already had every model, which is the upgrade case and the
    // one where the manual step is most likely to have been forgotten.
    const fk = resolveFkPointers(result.schema, args);

    if (result.added.length === 0 && fk.enabled.length === 0) {
        console.log(`→ Nothing to do. Models already present: ${result.skipped.join(', ')}`);
        reportFkPointers(fk, args);
        return;
    }

    if (args['dry-run']) {
        console.log(`(--dry-run) Would append: ${result.added.join(', ')}`);
        if (result.skipped.length) {
            console.log(`(--dry-run) Skipped (already present): ${result.skipped.join(', ')}`);
        }
        reportFkPointers(fk, args);
        console.log('');
        console.log(result.schema.slice(schema.length));
        return;
    }

    await writeFile(schemaPath, fk.schema, 'utf8');
    console.log(`✓ Appended ${result.added.length} model(s): ${result.added.join(', ')}`);
    if (result.skipped.length) {
        console.log(`→ Skipped (already present): ${result.skipped.join(', ')}`);
    }
    reportFkPointers(fk, args);
    console.log('');
    console.log('Next steps:');
    if (fk.enabled.length === 0) {
        console.log('  1. Review schema.prisma — especially the FK pointers to User/Tenant');
        console.log('     (or re-run with --tenant-model=X --user-model=Y to enable them)');
    } else {
        console.log('  1. Review schema.prisma');
    }
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

/**
 * Enables the FK relations to the app's own models, when it named them.
 *
 * Refuses a name the schema does not declare rather than writing a relation to
 * a model that does not exist — that failure would come from Prisma, about a
 * line the consumer did not write.
 */
function resolveFkPointers(schema, args) {
    const models = { tenant: args['tenant-model'], user: args['user-model'] };
    if (!models.tenant && !models.user) {
        return { schema, enabled: [], skipped: findFkPointers(schema) };
    }
    try {
        assertModelsExist(extractModelNames(schema), models);
    } catch (err) {
        console.error(`✗ ${err.message}`);
        process.exit(1);
    }
    return enableFkPointers(schema, models);
}

/** Says what was enabled and what was left commented, and why. */
function reportFkPointers(fk, args) {
    if (fk.enabled.length > 0) {
        console.log(`✓ Enabled ${fk.enabled.length} foreign-key relation(s) to your models.`);
    }
    if (fk.skipped.length === 0) return;

    const targets = [...new Set(fk.skipped.map((p) => p.target))];
    const flags = targets.map((t) => `--${t.toLowerCase()}-model=Your${t}`).join(' ');
    const verb = args['dry-run'] ? 'would stay' : 'stay';
    console.log(
        `→ ${fk.skipped.length} foreign-key relation(s) ${verb} commented out ` +
            `(to ${targets.join(' and ')}).`,
    );
    console.log(`  Enable them with: ${flags}`);
    console.log('  Without them the columns exist and nothing enforces them.');
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
        `→ Step 2/3: ${args['package-manager'] ?? 'pnpm'} prisma migrate dev --name ${args.name}`,
    );
    const pmRunner = args['package-manager'] ?? 'pnpm';
    await runChild(pmRunner, ['prisma', 'migrate', 'dev', '--name', args.name]);

    console.log('→ Step 3/3: appending the constraints Prisma cannot express');
    await writeConstraintsIntoMigration(args);
    console.log('✓ schema migrate succeeded.');
}

/** `@saasicat/spec/sql/constraints.postgres.sql`, read from the installed package. */
function resolveConstraintsSql() {
    const specEntry = require_.resolve('@saasicat/spec');
    return join(dirname(specEntry), 'sql', 'constraints.postgres.sql');
}

/**
 * Appends the non-DSL constraints to the migration `prisma migrate dev` just
 * wrote.
 *
 * Deliberately after the Prisma run rather than into a hand-made file: the
 * statements need the tables, and Prisma decides what the migration is called.
 *
 * A failure here does not fail the command. The schema is migrated and the
 * constraints are additive — telling the operator what to run by hand is more
 * useful than a non-zero exit on a database that is already correct in every
 * other respect.
 */
async function writeConstraintsIntoMigration(args) {
    const { schemaPath } = await readSchemaOrExit(args);
    const migrationsDir = join(dirname(schemaPath), 'migrations');
    const sqlPath = resolveConstraintsSql();

    try {
        const directories = await readdir(migrationsDir);
        const newest = newestMigration(directories);
        if (!newest) {
            console.log(`  ! No migration found in ${migrationsDir} — nothing to append to.`);
            console.log(`    Add ${sqlPath} to your migration by hand.`);
            return;
        }

        const migrationFile = join(migrationsDir, newest, 'migration.sql');
        const migrationSql = await readFile(migrationFile, 'utf8');
        if (hasConstraints(migrationSql)) {
            console.log(`  = ${newest} already carries them.`);
            return;
        }

        const constraintsSql = await readFile(sqlPath, 'utf8');
        if (args['dry-run']) {
            console.log(`  → would append ${sqlPath} to ${newest}/migration.sql`);
            return;
        }
        await writeFile(migrationFile, appendConstraints(migrationSql, constraintsSql));
        console.log(`  + appended to ${newest}/migration.sql`);
        console.log('    Re-run `prisma migrate dev` (or `migrate deploy`) to apply them.');
    } catch (err) {
        console.log(`  ! Could not append them: ${err?.message ?? String(err)}`);
        console.log(`    Add ${sqlPath} to your migration by hand.`);
    }
}

/** Reads a repeated flag (`--quota=a --quota=b`) off argv. */
function repeatedFlag(argv, name) {
    return argv
        .filter((arg) => arg.startsWith(`--${name}=`))
        .map((arg) => arg.slice(name.length + 3));
}

async function cmdInit(args, argv) {
    if (!args['project-key']) {
        console.error('✗ --project-key=<key> is required.');
        console.error('  It names the catalogue this app administers.');
        process.exit(1);
    }

    const root = resolve(args.dir ?? '.');
    const plan = planInit({
        projectKey: args['project-key'],
        appName: args['app-name'],
        apiBase: args['api-base'],
        quotas: repeatedFlag(argv, 'quota'),
        skipHasher: args['skip-hasher'] === true,
    });

    const templatesDir = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'templates',
        'init',
    );
    if (!existsSync(templatesDir)) {
        console.error(`✗ Templates not found: ${templatesDir}`);
        process.exit(99);
    }

    // Every file first, then every write: a run that stops halfway leaves an
    // app that neither compiles nor can be re-generated over.
    const writes = [];
    for (const file of plan.files) {
        const raw = await readFile(join(templatesDir, `${file.template}.tpl`), 'utf8');
        writes.push({
            path: file.path,
            dest: join(root, file.path),
            content: applyTokens(raw, { ...plan.tokens, ...file.tokens }),
        });
    }

    const existing = writes.filter((w) => existsSync(w.dest));
    if (existing.length > 0 && !args['dry-run']) {
        console.error(`✗ ${existing.length} file(s) already exist — refusing to overwrite:`);
        for (const w of existing) console.error(`    ${w.path}`);
        console.error('  Move them aside, or run with --dry-run to see what would be written.');
        process.exit(1);
    }

    if (args['dry-run']) {
        console.log(`(--dry-run) Would write ${writes.length} file(s) under ${root}:`);
        for (const w of writes) {
            console.log(`    ${w.path}${existsSync(w.dest) ? '   (EXISTS — would refuse)' : ''}`);
        }
    } else {
        for (const w of writes) {
            await mkdir(dirname(w.dest), { recursive: true });
            await writeFile(w.dest, w.content, 'utf8');
        }
        console.log(`✓ Wrote ${writes.length} file(s) under ${root}`);
        for (const w of writes) console.log(`    ${w.path}`);
    }

    await patchAppModuleFile(root, plan, args);

    console.log('');
    console.log('Next steps:');
    console.log('  1. Put your auth guard into `controller: { guards: [...] }`');
    if (plan.quotaClasses.length > 0) {
        console.log('  2. Check each quota provider counts the right thing');
        console.log('  3. saasicat schema migrate --name=add_saasicat');
    } else {
        console.log('  2. saasicat schema migrate --name=add_saasicat');
    }
}

/** Adds the platform to `src/app.module.ts`, or says exactly what to paste. */
async function patchAppModuleFile(root, plan, args) {
    const appModulePath = join(root, 'src', 'app.module.ts');
    const adminModuleFile = `${kebabCase(plan.tokens.APP_NAME)}-admin.module`;
    const options = {
        persistenceImport: plan.hasherClass ? './saas/persistence' : null,
        adminModule: {
            className: plan.tokens.ADMIN_MODULE_CLASS,
            importPath: `./saas/${adminModuleFile}`,
        },
        quotaProviders: plan.quotaClasses.map((className) => ({
            className,
            importPath: `./saas/${kebabCase(className.replace(/QuotaProvider$/, ''))}-quota.provider`,
        })),
        registry: {
            constName: plan.tokens.REGISTRY_CONST,
            importPath: './saas/feature-ui-registry',
        },
    };

    if (!existsSync(appModulePath)) {
        console.log('');
        console.log(`! No ${appModulePath} — add the platform to your root module:`);
        console.log(patchAppModule('', options).manualBlock);
        return;
    }

    const source = await readFile(appModulePath, 'utf8');
    const result = patchAppModule(source, options);

    if (result.status === 'already-wired') {
        console.log('');
        console.log('= src/app.module.ts already calls SaaSiCatModule.forRoot — left alone.');
        return;
    }
    if (result.status === 'declined') {
        console.log('');
        console.log(`! src/app.module.ts not patched: ${result.reason}.`);
        console.log('  Add this yourself:');
        console.log(result.manualBlock);
        return;
    }

    if (args['dry-run']) {
        console.log('');
        console.log('(--dry-run) Would add SaaSiCatModule.forRoot(...) to src/app.module.ts');
    } else {
        await writeFile(appModulePath, result.source, 'utf8');
        console.log('');
        console.log('+ src/app.module.ts now imports SaaSiCatModule.');
    }
    console.log(`  Still yours to add to \`providers\`: ${LIMIT_FILTER_PROVIDER}`);
    console.log('  (maps @EnforceQuota overruns to HTTP 402 — see docs/quickstart.md)');
}

async function main() {
    const [, , cmd, sub, ...rest] = process.argv;
    if (cmd === 'init') {
        return cmdInit(parseArgs([sub, ...rest].filter(Boolean)), process.argv.slice(3));
    }
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
        console.log(
            '  schema migrate --name=<name>             apply --all + migrate dev + constraints',
        );
        console.log('');
        console.log('  init --project-key=<key>                 scaffold the platform wiring');
        console.log('  init --project-key=x --quota=notes:Note   …plus a quota provider');
        console.log('');
        console.log('Optional --prisma-schema=PATH (default prisma/schema.prisma).');
        console.log('Optional --tenant-model=X --user-model=Y for apply/migrate — enables');
        console.log('         the foreign keys from the platform tables to your models.');
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
