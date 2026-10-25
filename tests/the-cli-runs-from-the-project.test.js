import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `@saasicat/cli` declares `@nestjs/common` and `nest-commander` as peers: the
// commands it exports are registered in an application's own CLI and have to
// resolve that application's Nest classes, not a copy of their own. A one-off
// run that fetches the package — `npx`, `pnpm dlx` and their kin — installs
// none of those peers, and the CLI stops at its first import with
// `ERR_MODULE_NOT_FOUND`, before it reads its arguments. So a command a reader
// copies runs the CLI from the project, where the peers are: `pnpm exec
// saasicat …`.
//
// For the same reason the CLI is a runtime dependency of the application, as
// the quickstart installs it. A command that adds it as a development one
// moves it there — `pnpm add -D` takes it out of `dependencies` — and the next
// production install leaves the application's own CLI without the commands it
// registers, while the command that moved it ran fine.
//
// Every Markdown file a reader meets is read, inside a fence or not, because a
// changeset quotes its command inline, and a pending one is written into the
// 1.0.0 changelog when pre mode ends. `CHANGELOG.md` is what was published,
// and is not rewritten.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'));
const GUIDE = 'docs/guides/upgrade-to-1.0.md';

/** Runners that fetch the package they are handed instead of running an installed one. */
const FETCHING_RUNNERS = [
    ['npx'],
    ['pnpx'],
    ['bunx'],
    ['bun', 'x'],
    ['npm', 'exec'],
    ['npm', 'x'],
    ['pnpm', 'dlx'],
    ['yarn', 'dlx'],
];

/**
 * Install commands, each with the flags that save to `devDependencies` — per
 * package manager, since `-d` is bun's and means a log level to npm.
 */
const INSTALLS = [
    { command: ['pnpm', 'add'], dev: ['-D', '--save-dev'] },
    { command: ['pnpm', 'install'], dev: ['-D', '--save-dev'] },
    { command: ['pnpm', 'i'], dev: ['-D', '--save-dev'] },
    { command: ['npm', 'install'], dev: ['-D', '--save-dev'] },
    { command: ['npm', 'i'], dev: ['-D', '--save-dev'] },
    { command: ['npm', 'add'], dev: ['-D', '--save-dev'] },
    { command: ['yarn', 'add'], dev: ['-D', '--dev'] },
    { command: ['bun', 'add'], dev: ['-d', '-D', '--dev'] },
];

/** Shell tokens after which the next word starts another command, or a comment. */
const COMMAND_ENDS = new Set(['&&', '||', '|', '#']);

const SURROUNDING = new Set(['`', "'", '"', '(', ')', ',', '.', ';', ':']);

/** `token` without the quotes, brackets and punctuation prose puts around a command. */
function bare(token) {
    let start = 0;
    let end = token.length;
    while (start < end && SURROUNDING.has(token[start])) start += 1;
    while (end > start && SURROUNDING.has(token[end - 1])) end -= 1;
    return token.slice(start, end);
}

/**
 * Whether `token` hands over the CLI's package: as a word of its own, or as the
 * value of a flag written with `=` — `--package=`, `-p=` or any spelling a
 * runner accepts, so the rule does not depend on knowing each one.
 */
function namesTheCli(token) {
    const equals = token.indexOf('=');
    const spec = token.startsWith('-') && equals !== -1 ? token.slice(equals + 1) : token;
    return spec === CLI.name || spec.startsWith(`${CLI.name}@`);
}

/**
 * Each place in `text` where a fetching runner is handed the CLI's package, as
 * the runner and the package it was handed.
 *
 * Read as one stream of words rather than line by line, and a lone `\` left
 * out, so a command continued onto the next line is still one command. The
 * runner's package is the first word after its flags, so the stream needs no
 * end.
 */
function oneOffRunsIn(text) {
    const words = text
        .split(/\s+/)
        .map(bare)
        .filter((word) => word !== '' && word !== '\\');
    const runs = [];
    for (let i = 0; i < words.length; i += 1) {
        for (const runner of FETCHING_RUNNERS) {
            if (!runner.every((word, k) => words[i + k] === word)) continue;
            let next = i + runner.length;
            while (
                next < words.length &&
                words[next].startsWith('-') &&
                !namesTheCli(words[next])
            ) {
                next += 1;
            }
            if (next < words.length && namesTheCli(words[next])) {
                runs.push(`${runner.join(' ')} ${words[next]}`);
            }
        }
    }
    return runs;
}

function backticksIn(line) {
    let count = 0;
    for (const character of line) if (character === '`') count += 1;
    return count;
}

/**
 * `text` as the lines a command can stand on: a line ending in `\` goes on,
 * and so does one outside a fence that leaves an inline code span open, since
 * prose may break a span that Markdown still reads as one.
 */
function logicalLines(text) {
    const lines = [];
    let pending = '';
    let fenced = false;
    for (const line of text.split('\n')) {
        if (line.trimStart().startsWith('```')) {
            fenced = !fenced;
            if (pending !== '') lines.push(pending);
            pending = '';
            continue;
        }
        const joined = pending === '' ? line : `${pending} ${line}`;
        const spanOpen = !fenced && backticksIn(joined) % 2 === 1;
        if (line.trimEnd().endsWith('\\') || spanOpen) {
            pending = joined;
        } else {
            lines.push(joined);
            pending = '';
        }
    }
    if (pending !== '') lines.push(pending);
    return lines;
}

/**
 * Each install command in `text` that saves the CLI's package as a development
 * dependency.
 *
 * Unlike a runner, an install takes any number of packages and its flags may
 * follow them, so it is read to where the command ends: the end of its line,
 * a shell separator or comment, or the close of the inline code span it stands
 * in.
 */
function devInstallsIn(text) {
    const installs = [];
    for (const line of logicalLines(text)) {
        const raw = line.split(/\s+/).filter((token) => token !== '' && token !== '\\');
        const words = raw.map(bare);
        for (let i = 0; i < words.length; i += 1) {
            for (const install of INSTALLS) {
                if (!install.command.every((word, k) => words[i + k] === word)) continue;
                const args = [];
                for (let next = i + install.command.length; next < words.length; next += 1) {
                    if (COMMAND_ENDS.has(raw[next])) break;
                    args.push(words[next]);
                    if (raw[next].endsWith(';') || raw[next].endsWith('`')) break;
                }
                if (args.some((arg) => install.dev.includes(arg)) && args.some(namesTheCli)) {
                    installs.push(`${install.command.join(' ')} ${args.join(' ')}`);
                }
            }
        }
    }
    return installs;
}

/** Every Markdown file in the working tree, untracked ones too, but no changelog. */
function markdownFiles() {
    const listed = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'],
        { cwd: ROOT, encoding: 'utf8' },
    );
    return listed
        .split('\n')
        .filter(Boolean)
        .filter((file) => basename(file) !== 'CHANGELOG.md');
}

describe('a one-off run of the CLI is told apart from one from the project', () => {
    const fetching = [
        'npx @saasicat/cli@latest codemod v1 --dir=.',
        'Run `npx -y @saasicat/cli codemod v1` first.',
        'npx --package=@saasicat/cli saasicat schema check',
        'npx -p=@saasicat/cli@latest saasicat codemod v1',
        'npx -p @saasicat/cli saasicat schema check',
        'pnpm dlx @saasicat/cli@1.0.0 init',
        'npm exec @saasicat/cli@latest -- codemod v1',
        'npm x @saasicat/cli@latest codemod v1',
        'bun x @saasicat/cli codemod v1',
        'npx \\\n    @saasicat/cli@latest codemod v1',
    ];
    for (const text of fetching) {
        test(`fetches: ${JSON.stringify(text)}`, () => {
            assert.equal(oneOffRunsIn(text).length, 1);
        });
    }

    const installed = [
        'pnpm exec saasicat codemod v1 --dir=.',
        'pnpm add @saasicat/cli@latest',
        'a one-off run through `npx` or `pnpm dlx` installs neither',
        'pnpm dlx jscpd@4',
        'npx --yes --dir=. jscpd',
        'npx @saasicat/climate',
    ];
    for (const text of installed) {
        test(`runs nothing fetched: ${JSON.stringify(text)}`, () => {
            assert.deepEqual(oneOffRunsIn(text), []);
        });
    }
});

describe('an install of the CLI keeps it a runtime dependency', () => {
    const asDevelopment = [
        'pnpm add -D @saasicat/cli@latest',
        'pnpm add @saasicat/core @saasicat/cli --save-dev',
        'npm install --save-dev @saasicat/cli',
        'npm i -D @saasicat/cli@1.0.0',
        'yarn add @saasicat/cli --dev',
        'bun add -d @saasicat/cli',
        'pnpm add -D \\\n    @saasicat/cli@latest',
        'Run `pnpm add -D\n@saasicat/cli` first.',
    ];
    for (const text of asDevelopment) {
        test(`as a development dependency: ${JSON.stringify(text)}`, () => {
            assert.equal(devInstallsIn(text).length, 1);
        });
    }

    const atRuntime = [
        'pnpm add @saasicat/cli@latest',
        'pnpm add @saasicat/core @saasicat/spec @saasicat/nest @saasicat/cli',
        'pnpm add -D @saasicat/persistence-testing',
        'npm i -d @saasicat/cli',
        'pnpm add -D vitest && pnpm add @saasicat/cli',
        'Run `pnpm add @saasicat/cli` and `pnpm add -D vitest`.',
        'pnpm add -D vitest # not @saasicat/cli',
        '```bash\npnpm add -D vitest a`b\npnpm add @saasicat/cli\n```',
    ];
    for (const text of atRuntime) {
        test(`at runtime: ${JSON.stringify(text)}`, () => {
            assert.deepEqual(devInstallsIn(text), []);
        });
    }
});

// @requirement SC-COMP-003 — There is one deliberate break on the way to 1.0, and one guide for it
describe('the command the migration guide gives runs as written', () => {
    test('no Markdown a reader copies from runs the CLI through a one-off fetch', () => {
        const files = markdownFiles();
        assert.ok(files.includes(GUIDE), `${GUIDE} is among the files read`);
        const found = files.flatMap((file) =>
            oneOffRunsIn(readFileSync(join(ROOT, file), 'utf8')).map((run) => `${file}: ${run}`),
        );
        assert.deepEqual(
            found,
            [],
            `run it from the project instead — \`pnpm exec ${Object.keys(CLI.bin)[0]} …\` with ` +
                `${CLI.name} installed — since a one-off run installs none of its peers`,
        );
    });

    test('no Markdown a reader copies from installs the CLI as a development dependency', () => {
        const found = markdownFiles().flatMap((file) =>
            devInstallsIn(readFileSync(join(ROOT, file), 'utf8')).map((run) => `${file}: ${run}`),
        );
        assert.deepEqual(
            found,
            [],
            `install ${CLI.name} as a dependency — the application's own CLI registers its ` +
                'commands at runtime, and a production install leaves a development one out',
        );
    });

    test('the guide runs its codemod from the project', () => {
        const words = readFileSync(join(ROOT, GUIDE), 'utf8').split(/\s+/).map(bare);
        const at = words.findIndex(
            (word, i) =>
                word === 'pnpm' &&
                words[i + 1] === 'exec' &&
                Object.keys(CLI.bin).includes(words[i + 2]) &&
                words[i + 3] === 'codemod' &&
                words[i + 4] === 'v1',
        );
        assert.notEqual(at, -1, `${GUIDE} gives \`pnpm exec saasicat codemod v1\``);
    });
});
