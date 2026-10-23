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
    ['npm', 'exec'],
    ['pnpm', 'dlx'],
    ['yarn', 'dlx'],
];

const SURROUNDING = new Set(['`', "'", '"', '(', ')', ',', '.', ';', ':']);

/** `token` without the quotes, brackets and punctuation prose puts around a command. */
function bare(token) {
    let start = 0;
    let end = token.length;
    while (start < end && SURROUNDING.has(token[start])) start += 1;
    while (end > start && SURROUNDING.has(token[end - 1])) end -= 1;
    return token.slice(start, end);
}

function namesTheCli(token) {
    const spec = token.startsWith('--package=') ? token.slice('--package='.length) : token;
    return spec === CLI.name || spec.startsWith(`${CLI.name}@`);
}

/**
 * Each place in `text` where a fetching runner is handed the CLI's package, as
 * the runner and the package it was handed.
 *
 * Read as one stream of words rather than line by line, and a lone `\` left
 * out, so a command continued onto the next line is still one command.
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
        'npx -p @saasicat/cli saasicat schema check',
        'pnpm dlx @saasicat/cli@1.0.0 init',
        'npm exec @saasicat/cli@latest -- codemod v1',
        'npx \\\n    @saasicat/cli@latest codemod v1',
    ];
    for (const text of fetching) {
        test(`fetches: ${JSON.stringify(text)}`, () => {
            assert.equal(oneOffRunsIn(text).length, 1);
        });
    }

    const installed = [
        'pnpm exec saasicat codemod v1 --dir=.',
        'pnpm add -D @saasicat/cli@latest',
        'a one-off run through `npx` or `pnpm dlx` installs neither',
        'pnpm dlx jscpd@4',
        'npx @saasicat/climate',
    ];
    for (const text of installed) {
        test(`runs nothing fetched: ${JSON.stringify(text)}`, () => {
            assert.deepEqual(oneOffRunsIn(text), []);
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
