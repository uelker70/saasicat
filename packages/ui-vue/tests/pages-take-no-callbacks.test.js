/**
 * The page contract from AP3 §3.2, as a test rather than as a sentence.
 *
 * A page in `src/pages/` takes `resources`, `params` and `options` — an
 * override, what the route cannot supply, and presentation. It does not take
 * callbacks. That one rule is what makes the old idiom unrepresentable: a page
 * wired through 24 function props cannot be written at all if none of them may
 * be a function, so the only way to change what an operation does is to
 * override the resource, which composes and which the platform can keep
 * serving the other nine operations of.
 *
 * The rule lived in three documents and in the comments of the pages that
 * follow it. Nothing measured it, and Phase 4 removed 61 function props by
 * hand — a count that can silently start climbing again on the next page.
 *
 * Why the type checker and not a pattern: a prop whose type is written inline
 * is easy to see, and a prop written `onSave?: SaveHandler` is not. The alias
 * is the shape a scan cannot decide, it is the shape someone reaches for when
 * a page's props grow, and it is exactly the case
 * `injection-keys-are-global-symbols` was rewritten to answer. Both guards read
 * the sources through `support/vue-typescript-program.mjs` for that reason.
 */
// @requirement SC-UI-001 — Every standard screen is built the same way
// @requirement SC-UI-008 — Equivalent actions behave the same everywhere

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { join } from 'node:path';

import {
    PACKAGE,
    SRC,
    compilerOptions,
    filesUnder,
    inMemoryHost,
    lineAt,
    tree,
} from './support/vue-typescript-program.mjs';

/** AP3 §3.2: "Obergrenze: 5 Props je Seite." */
const MAX_PROPS = 5;

/**
 * The tag a page uses to keep a callback prop, and what it has to say.
 *
 * An exception is a declaration, not a discovery. A guard cannot work out from
 * a page's source why that page is allowed to break the rule, and guessing
 * would give the wrong answer for the one page where it matters. So the page
 * says it, in the place a reader of that prop is already looking, and the
 * reason travels with the code rather than sitting in a list in this file —
 * which would be the same defect one level up.
 */
const EXCEPTION_TAG = 'pageContractException';
const MIN_REASON = 30;

const IN_MEMORY = join(PACKAGE, 'tests', '__page-contract-checks__');

const REAL = tree(SRC, filesUnder(SRC));
const COUNTER_CHECKS = [];

/**
 * Registers a tree this guard has to fail on, and returns the units to judge.
 *
 * They join the same program as `src`, so the whole file costs one parse of
 * Vue's types and one of the standard library.
 */
function counterCheck(name, files) {
    const root = join(IN_MEMORY, name);
    const units = tree(
        root,
        Object.entries(files).map(([path, text]) => ({ path, text })),
    );
    COUNTER_CHECKS.push(...units);
    return units;
}

let program;
let checker;

function start() {
    const options = compilerOptions();
    const { host, fileNames } = inMemoryHost([...REAL, ...COUNTER_CHECKS], options);
    program = ts.createProgram(fileNames, options, host);
    checker = program.getTypeChecker();
}

/* -------------------------------------------------------------------------
 * Reading one page's props
 * ---------------------------------------------------------------------- */

/** The type argument of the `defineProps<{…}>()` call in a file, if it has one. */
function propsTypeNode(sourceFile) {
    let found;
    const visit = (node) => {
        if (
            !found &&
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'defineProps' &&
            node.typeArguments?.length
        ) {
            found = node.typeArguments[0];
        }
        if (!found) ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
    return found;
}

/** Every constituent of a union, or the type itself. */
const constituents = (type) => (type.isUnion() ? type.types : [type]);

/**
 * Whether a prop can hold something callable.
 *
 * Asked of the resolved type, so an alias, an interface with a call signature
 * and `(() => void) | undefined` all answer the same way. `undefined` and
 * `null` are skipped because every optional prop carries one and neither is
 * callable.
 */
function isCallable(type) {
    return constituents(type).some((part) => {
        if (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) return false;
        return checker.getSignaturesOfType(part, ts.SignatureKind.Call).length > 0;
    });
}

/** The reason a prop gives for keeping its callback, or `undefined`. */
function declaredException(symbol) {
    for (const declaration of symbol.getDeclarations() ?? []) {
        for (const tag of ts.getJSDocTags(declaration)) {
            if (tag.tagName.text !== EXCEPTION_TAG) continue;
            const comment = tag.comment;
            return typeof comment === 'string'
                ? comment.trim()
                : (comment ?? [])
                      .map((part) => part.text ?? '')
                      .join('')
                      .trim();
        }
    }
    return undefined;
}

/**
 * What one page declares, judged against the contract.
 *
 * `path` is the name the file has on disk, so a failure can be opened where it
 * names.
 */
function readPage(unit) {
    const sourceFile = program.getSourceFile(unit.fileName);
    assert.ok(sourceFile, `${unit.path} is not in the program`);
    const typeNode = propsTypeNode(sourceFile);
    if (!typeNode) return { path: unit.path, props: [], declaresProps: false };

    const type = checker.getTypeFromTypeNode(typeNode);
    const props = type.getProperties().map((symbol) => {
        const declaration = symbol.getDeclarations()?.[0];
        return {
            name: symbol.getName(),
            line: declaration ? lineAt(sourceFile.text, declaration.getStart(sourceFile)) : 0,
            callable: isCallable(checker.getTypeOfSymbolAtLocation(symbol, typeNode)),
            exception: declaredException(symbol),
        };
    });
    return { path: unit.path, props, declaresProps: true };
}

/** Every page under `src/pages/`, read. */
function readPages(units) {
    return units
        .filter((unit) => unit.path.endsWith('.vue') && unit.path.startsWith('pages/'))
        .map(readPage);
}

/** The contract's two rules, applied. One string per violation. */
function violations(pages) {
    const found = [];
    for (const page of pages) {
        if (page.props.length > MAX_PROPS) {
            found.push(
                `${page.path}: ${page.props.length} props, the contract allows ${MAX_PROPS}`,
            );
        }
        for (const prop of page.props) {
            if (!prop.callable) continue;
            if (prop.exception === undefined) {
                found.push(
                    `${page.path}:${prop.line}: \`${prop.name}\` is callable — a page takes no ` +
                        `callbacks (AP3 §3.2). Reach the resource registry, or say why this one ` +
                        `cannot with \`@${EXCEPTION_TAG} <reason>\`.`,
                );
            } else if (prop.exception.length < MIN_REASON) {
                found.push(
                    `${page.path}:${prop.line}: \`${prop.name}\` claims @${EXCEPTION_TAG} but ` +
                        `gives ${prop.exception.length} characters of reason; ${MIN_REASON} is ` +
                        `the floor. A tag without an argument is a silencer.`,
                );
            }
        }
    }
    return found;
}

/* -------------------------------------------------------------------------
 * The trees this guard has to fail on
 * ---------------------------------------------------------------------- */

const INLINE_CALLBACK = counterCheck('inline-callback', {
    'pages/BadPage.vue': `<script setup lang="ts">
defineProps<{ onSave?: () => void }>();
</script>
<template><div /></template>`,
});

const ALIASED_CALLBACK = counterCheck('aliased-callback', {
    'pages/handlers.ts': `export type SaveHandler = (id: string) => Promise<void>;`,
    'pages/AliasPage.vue': `<script setup lang="ts">
import type { SaveHandler } from './handlers.js';
defineProps<{ onSave?: SaveHandler }>();
</script>
<template><div /></template>`,
});

const SIX_PROPS = counterCheck('six-props', {
    'pages/WidePage.vue': `<script setup lang="ts">
defineProps<{ a?: string; b?: string; c?: string; d?: string; e?: string; f?: string }>();
</script>
<template><div /></template>`,
});

const EMPTY_REASON = counterCheck('empty-reason', {
    'pages/SilencedPage.vue': `<script setup lang="ts">
defineProps<{
    /** @${EXCEPTION_TAG} because */
    onSave?: () => void;
}>();
</script>
<template><div /></template>`,
});

const DECLARED_EXCEPTION = counterCheck('declared-exception', {
    'pages/HonestPage.vue': `<script setup lang="ts">
defineProps<{
    /**
     * @${EXCEPTION_TAG} renders when the registry's own shell failed to boot,
     * so it cannot reach the registry to find out what to do next.
     */
    onRetry?: () => void;
}>();
</script>
<template><div /></template>`,
});

start();

/* -------------------------------------------------------------------------
 * The rules
 * ---------------------------------------------------------------------- */

describe('a page takes no callbacks', () => {
    const pages = readPages(REAL);

    test('the guard reads every page in `src/pages/`', () => {
        const onDisk = filesUnder(join(SRC, 'pages')).filter((f) => f.path.endsWith('.vue'));
        assert.equal(
            pages.length,
            onDisk.length,
            'the program lost pages between the filesystem and the type checker — ' +
                'a green run below would then be a statement about nothing',
        );
        assert.ok(pages.length >= 15, `only ${pages.length} pages found`);
        assert.ok(
            pages.some((page) => page.declaresProps),
            'no page declares props at all, which cannot be right',
        );
    });

    test('no prop in `src/pages/` is callable, and none exceeds the cap', () => {
        assert.deepEqual(violations(pages), []);
    });

    test('the one exception says why, in its own source', () => {
        const exceptions = pages.flatMap((page) =>
            page.props
                .filter((prop) => prop.callable)
                .map((prop) => ({ page: page.path, prop: prop.name, reason: prop.exception })),
        );
        // Not an allow-list: whatever carries the tag is read back here, so the
        // reasons stay visible in one place without this file deciding them.
        assert.ok(exceptions.length > 0, 'expected the manifest-error page');
        for (const { page, prop, reason } of exceptions) {
            assert.ok(
                reason && reason.length >= MIN_REASON,
                `${page}:${prop} — ${reason?.length ?? 0} characters of reason`,
            );
        }
    });
});

describe('the guard fails on what it forbids', () => {
    test('an inline callback prop', () => {
        assert.match(violations(readPages(INLINE_CALLBACK)).join('\n'), /`onSave` is callable/);
    });

    test('a callback hidden behind a type alias — what a pattern cannot see', () => {
        assert.match(violations(readPages(ALIASED_CALLBACK)).join('\n'), /`onSave` is callable/);
    });

    test('a sixth prop', () => {
        assert.match(violations(readPages(SIX_PROPS)).join('\n'), /6 props, the contract allows 5/);
    });

    test('an exception tag with no real reason', () => {
        assert.match(violations(readPages(EMPTY_REASON)).join('\n'), /characters of reason/);
    });

    test('a declared exception passes', () => {
        assert.deepEqual(violations(readPages(DECLARED_EXCEPTION)), []);
    });
});
