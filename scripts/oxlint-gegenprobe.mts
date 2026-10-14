// Holds that `pnpm run lint:correctness` applies the rules with types where
// `oxlint.correctness.config.mts` promises it, and not where it exempts them.
//
// The rules with types report only while `oxlint-tsgolint` can read the
// tsconfig next to a file; one it refuses turns them off silently, and the lint
// stays green. So this guard puts a file that breaks four typed rules next to
// every versioned `tsconfig.json` — the one tsgolint reads for the files below
// it — and demands every report. Where the file goes follows from the
// tsconfig's first `include` that takes subfolders; a new package gets its
// probe without an entry here.
//
// Three exemptions hang on behaviour a new version may tip silently, and each
// has its probe in both directions:
// - `describe`, `it` and `test` from `node:test` do not report, a forgotten
//   `await` inside a test still does (`allowForKnownSafeCalls`).
// - In JavaScript exactly four rules are off; a promise nobody waits for still
//   reports there.
// - tsgolint does not read single-file components. Should a new version report
//   the typed probe in `.vue`, this guard turns red and the sentence in the
//   configuration needs changing.
//
// The whole tree is linted, exactly as the lint step does: called with single
// paths, tsgolint does not resolve the types of `node:test` everywhere
// (measured in vereinsfux with oxlint 1.78.0 and tsgolint 7.0.2004), and a
// probe that forbids a report would then pass for the wrong reason.
//
// The files exist only for the run, because the overrides' `files` hang on
// paths. Started next to the lint step, that step would see them too.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');
const OXLINT = join(ROOT, 'node_modules', '.bin', 'oxlint');
const CONFIGURATION = 'oxlint.correctness.config.mts';
const FOLDER = '__oxlint_gegenprobe__';

const FLOATING_PROMISE = 'typescript(no-floating-promises)';
const UNBOUND_METHOD = 'typescript(unbound-method)';
const SORT_WITHOUT_COMPARE = 'typescript(require-array-sort-compare)';
const OBJECT_AS_TEXT = 'typescript(no-base-to-string)';
const OBJECT_IN_TEMPLATE = 'typescript(restrict-template-expressions)';

/** Four mistakes only someone who knows the types can see. */
const WITH_TYPES = `class Service {
    name = 'x';
    say(): string {
        return this.name;
    }
}

export const loose = new Service().say;
export const order = [3, 1, 2].sort();
export const text = String({ name: 'x' });

export function start(): void {
    Promise.resolve(1);
}
`;

const ALL_TYPED_RULES = [
    FLOATING_PROMISE,
    UNBOUND_METHOD,
    SORT_WITHOUT_COMPARE,
    OBJECT_AS_TEXT,
] as const;

/**
 * Test blocks the runner waits for itself. The promise `test()` returns, left
 * standing as a statement, proves the types of `node:test` are resolved here:
 * without that proof the ban would also hold if `test` were plain `any`.
 */
const TEST_BLOCKS = `import { describe, it, test } from 'node:test';

const run = test('returns a promise', () => {});
run;

describe('probe', () => {
    it('runs', () => {});
});
`;

/** A forgotten `await` inside a test block: that one the rule still reports. */
const FORGOTTEN_AWAIT = `import { it } from 'node:test';

it('forgets an await', () => {
    Promise.resolve(1);
});
`;

/** The same mistakes in JavaScript: four rules are off there, the promise rule is not. */
const JAVASCRIPT = `class Service {
    say() {
        return this.name;
    }
}

export const loose = new Service().say;
export const order = [3, 1, 2].sort();
export const text = \`\${{ name: 'x' }}\` + String({ name: 'x' });

Promise.resolve(1);
`;

/** A typed mistake in a component does not report; the export in the setup does. */
const COMPONENT = `<script setup lang="ts">
export const notAllowed = 1;

function start(): void {
    Promise.resolve(1);
}

start();
</script>

<template>
    <div />
</template>
`;

interface Probe {
    readonly file: string;
    readonly content: string;
    readonly expected: readonly string[];
    /** What must not report here, because an exemption of the configuration applies. */
    readonly forbidden: readonly string[];
}

function versionedTsconfigs(): string[] {
    return execFileSync('git', ['ls-files', '-z', '*tsconfig.json'], {
        cwd: ROOT,
        encoding: 'utf8',
    })
        .split('\0')
        .filter((path) => basename(path) === 'tsconfig.json');
}

/** The folder and extension the first subfolder-taking `include` of a tsconfig covers. */
function coveredFolder(tsconfig: string): { folder: string; extension: string } {
    const read = ts.getParsedCommandLineOfConfigFile(join(ROOT, tsconfig), undefined, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
            throw new Error(
                `${tsconfig}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
            );
        },
    });
    const raw: unknown = read?.raw;
    const include =
        typeof raw === 'object' && raw !== null && 'include' in raw && Array.isArray(raw.include)
            ? raw.include.filter((entry): entry is string => typeof entry === 'string')
            : [];
    for (const entry of include) {
        // A plain folder (`"src"`) takes everything below it.
        if (!entry.includes('*') && !entry.includes('.')) {
            return { folder: entry, extension: '.ts' };
        }
        const extension = entry.slice(entry.lastIndexOf('*') + 1);
        if (entry.includes('**/*.') && (extension === '.ts' || extension === '.mts')) {
            return { folder: entry.slice(0, entry.indexOf('**')), extension };
        }
    }
    throw new Error(
        `${tsconfig} names no own include that takes subfolders ("src" or "src/**/*.ts"); ` +
            'where its probe belongs cannot be derived from it.',
    );
}

function typedProbeFor(tsconfig: string): Probe {
    const { folder, extension } = coveredFolder(tsconfig);
    return {
        file: join(dirname(tsconfig), folder, FOLDER, `types${extension}`),
        content: WITH_TYPES,
        expected: ALL_TYPED_RULES,
        forbidden: [],
    };
}

const PROBES: readonly Probe[] = [
    ...versionedTsconfigs().map(typedProbeFor),
    {
        file: `packages/core/tests/${FOLDER}/test-blocks.test.js`,
        content: TEST_BLOCKS,
        expected: [FLOATING_PROMISE],
        forbidden: [],
    },
    {
        file: `packages/core/tests/${FOLDER}/exempt-blocks.test.js`,
        content: TEST_BLOCKS.replace('run;\n', ''),
        expected: [],
        forbidden: [FLOATING_PROMISE],
    },
    {
        file: `packages/core/tests/${FOLDER}/forgotten-await.test.js`,
        content: FORGOTTEN_AWAIT,
        expected: [FLOATING_PROMISE],
        forbidden: [],
    },
    {
        file: `packages/cli/tests/${FOLDER}/probe.js`,
        content: JAVASCRIPT,
        expected: [FLOATING_PROMISE],
        forbidden: [UNBOUND_METHOD, SORT_WITHOUT_COMPARE, OBJECT_AS_TEXT, OBJECT_IN_TEMPLATE],
    },
    {
        file: `packages/ui-vue/src/${FOLDER}/ProbeTypes.vue`,
        content: COMPONENT,
        expected: ['vue(no-export-in-script-setup)'],
        forbidden: [FLOATING_PROMISE],
    },
];

interface Report {
    readonly file: string;
    readonly rule: string;
}

function reportsFrom(output: string): Report[] {
    let value: unknown;
    try {
        value = JSON.parse(output);
    } catch (error) {
        // For instance when oxlint cannot read the configuration: its message
        // then stands where the JSON should be.
        throw new Error(`oxlint returned no JSON:\n${output}`, { cause: error });
    }
    if (
        typeof value !== 'object' ||
        value === null ||
        !('diagnostics' in value) ||
        !Array.isArray(value.diagnostics)
    ) {
        throw new Error(`oxlint returned no JSON with "diagnostics":\n${output}`);
    }
    return value.diagnostics.flatMap((entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'filename' in entry &&
        'code' in entry &&
        typeof entry.filename === 'string' &&
        typeof entry.code === 'string'
            ? [{ file: entry.filename, rule: entry.code }]
            : [],
    );
}

function foldersOf(probes: readonly Probe[]): string[] {
    return [...new Set(probes.map((probe) => dirname(probe.file)))];
}

let runningOxlint: ChildProcess | undefined;

/**
 * The JSON output of a full run. Once an exemption breaks, that is thousands of
 * findings, several megabytes; it is read as a stream without a ceiling.
 */
function oxlintOutput(): Promise<string> {
    return new Promise((fulfil, reject) => {
        const child = spawn(OXLINT, ['-c', CONFIGURATION, '--format', 'json'], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'inherit'],
        });
        runningOxlint = child;
        let output = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (part: string) => {
            output += part;
        });
        child.on('error', reject);
        child.on('close', (_code, signal) => {
            runningOxlint = undefined;
            if (signal === null) {
                fulfil(output);
            } else {
                reject(new Error(`oxlint ended with ${signal}; the guard has no result.`));
            }
        });
    });
}

function cleanUp(): void {
    for (const folder of foldersOf(PROBES)) {
        rmSync(join(ROOT, folder), { recursive: true, force: true });
    }
}

function deviations(reports: readonly Report[]): string[] {
    const reported = (probe: Probe, rule: string): boolean =>
        reports.some((report) => report.file === probe.file && report.rule === rule);
    return PROBES.flatMap((probe) => [
        ...probe.expected
            .filter((rule) => !reported(probe, rule))
            .map((rule) => `${probe.file}: ${rule} missing`),
        ...probe.forbidden
            .filter((rule) => reported(probe, rule))
            .map((rule) => `${probe.file}: ${rule} does not belong here`),
    ]);
}

// A signal is passed on to oxlint, a second one ends oxlint hard, `finally`
// removes the probes, and then the signal ends this script itself. Without a
// handler of its own, Node would end the process at once, the probes would stay
// in the tree, and the next build or `git add -A` would pick them up. With a
// handler but oxlint started synchronously, Node never calls the handler during
// the run: a signal to this script alone would let oxlint finish and end in
// success.
let abort: NodeJS.Signals | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        if (abort === undefined) {
            abort = signal;
            runningOxlint?.kill(signal);
        } else {
            runningOxlint?.kill('SIGKILL');
        }
    });
}

/**
 * Delivers a signal that came during synchronous work — Node calls the handler
 * only once the event loop runs again — and then ends on it instead of with a
 * code: a calling shell sees an end by the signal, and a loop around this
 * script stops.
 */
async function followPendingSignal(): Promise<void> {
    await new Promise((proceed) => setImmediate(proceed));
    if (abort !== undefined) {
        process.removeAllListeners(abort);
        process.kill(process.pid, abort);
    }
}

cleanUp();
let reports: Report[];
try {
    for (const probe of PROBES) {
        mkdirSync(join(ROOT, dirname(probe.file)), { recursive: true });
        writeFileSync(join(ROOT, probe.file), probe.content);
    }
    reports = reportsFrom(await oxlintOutput());
} finally {
    cleanUp();
    await followPendingSignal();
}

const open = deviations(reports);
if (open.length > 0) {
    console.error(
        `oxlint does not report what ${CONFIGURATION} promises:\n` +
            open.map((line) => `  ${line}`).join('\n') +
            '\n\nEither the rules with types are off — for instance because `oxlint-tsgolint`' +
            ' refuses a tsconfig, or the packages are not built — or an exemption of the' +
            ' configuration no longer holds or reaches too far. Its comments say which and why.',
    );
    process.exitCode = 1;
} else {
    const count = (field: 'expected' | 'forbidden'): number =>
        PROBES.reduce((sum, probe) => sum + probe[field].length, 0);
    console.log(
        `OK — ${PROBES.length} probes; expected reports present: ${count('expected')}, ` +
            `exempted ones absent: ${count('forbidden')}.`,
    );
}
await followPendingSignal();
