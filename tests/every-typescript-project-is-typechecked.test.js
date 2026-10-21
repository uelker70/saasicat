import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse } from 'yaml';

// Every TypeScript file in a workspace package is typechecked in CI.
//
// CI's typecheck step is `pnpm -r typecheck`, which reaches a package only
// through a `typecheck` script of its own and skips one without it. A build
// does not stand in for one: a build with declarations is not a typecheck, and
// does not catch every error `tsc --noEmit` does, and a bundler loads its own
// configuration file without checking it at all. So each package names every
// `tsconfig*.json` it holds in its script, and every `.ts`, `.mts`, `.cts` and
// `.vue` file in it belongs to one of those projects — the build configuration
// as much as the sources.
//
// The packages are the ones `pnpm -r` walks, read from `pnpm-workspace.yaml`;
// the projects and the files are read from each package directory, and what a
// project covers from TypeScript's own reading of it. A package, a project or a
// file added later is held to this without being listed here.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Never a package's own sources: installed and built output. */
const NOT_SOURCES = new Set(['node_modules', 'dist']);
const TYPESCRIPT = /\.(?:[cm]?ts|vue)$/;
const VUE = [{ extension: '.vue', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred }];

/**
 * The directories a `pnpm-workspace.yaml` pattern names. A segment is either a
 * directory name or `*`, any directory; anything else is a glob this reading
 * does not know, and it fails rather than leaving packages out.
 */
function directoriesOf(pattern) {
    let found = [ROOT];
    for (const segment of pattern.split('/')) {
        if (segment !== '*' && /[*?!{}[\]]/.test(segment)) {
            throw new Error(
                `pnpm-workspace.yaml pattern '${pattern}' is not one this test expands`,
            );
        }
        found = found.flatMap((dir) =>
            segment === '*'
                ? readdirSync(dir)
                      .map((name) => join(dir, name))
                      .filter((path) => statSync(path).isDirectory())
                : [join(dir, segment)],
        );
    }
    return found;
}

/**
 * Every file of the package at `root`, below it as well: not installed or built
 * output, not a dot directory — tooling and scratch output such as a test's
 * temporary directory — and not a package of its own, which is read as one.
 */
function filesOf(root, dir = root) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (!statSync(path).isDirectory()) return [path];
        if (NOT_SOURCES.has(name) || name.startsWith('.')) return [];
        if (existsSync(join(path, 'package.json'))) return [];
        return filesOf(root, path);
    });
}

/** The files TypeScript reads a project to cover, `.vue` included. */
function coveredBy(project) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
        project,
        {},
        {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
                throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
            },
        },
        undefined,
        undefined,
        VUE,
    );
    return parsed.fileNames;
}

const workspace = parse(readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'));
const packages = workspace.packages
    .flatMap(directoriesOf)
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .map((dir) => {
        const files = filesOf(dir);
        const projects = files.filter((file) => /^tsconfig.*\.json$/.test(basename(file)));
        return {
            dir,
            at: relative(ROOT, dir),
            manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
            projects,
            sources: files.filter((file) => TYPESCRIPT.test(file)),
        };
    })
    .filter(({ projects, sources }) => projects.length > 0 || sources.length > 0);

describe('every TypeScript file in a workspace package is typechecked', () => {
    test('the scan finds the packages, their projects and their files', () => {
        const found = packages.map(({ at }) => at);
        for (const expected of ['packages/nest', 'examples/notesapp/admin']) {
            assert.ok(found.includes(expected), `${expected} not among ${found.join(', ')}`);
        }
        const nest = packages.find(({ at }) => at === 'packages/nest');
        assert.ok(nest.sources.includes(join(nest.dir, 'src', 'index.ts')), 'nest has no sources');
        assert.ok(
            nest.sources.includes(join(nest.dir, 'tsup.config.ts')),
            'nest has no build file',
        );
    });

    for (const { dir, at, manifest, projects, sources } of packages) {
        const named = projects.map((project) => relative(dir, project));

        test(`${manifest.name} (${at}) typechecks ${named.join(' and ') || 'nothing'}`, () => {
            const script = manifest.scripts?.typecheck;
            assert.ok(script, `${manifest.name} has no typecheck script, so CI never reaches it`);
            assert.ok(script.includes('--noEmit'), `${manifest.name}: '${script}' emits`);
            for (const project of named) {
                assert.ok(
                    script.includes(`-p ${project}`),
                    `${manifest.name}: '${script}' leaves ${project} out`,
                );
            }
        });

        test(`${manifest.name} (${at}) has every TypeScript file in one of its projects`, () => {
            const covered = new Set(projects.flatMap(coveredBy));
            assert.deepEqual(
                sources.filter((file) => !covered.has(file)).map((file) => relative(dir, file)),
                [],
                `${manifest.name}: files in no project, so no typecheck reads them`,
            );
        });
    }
});
