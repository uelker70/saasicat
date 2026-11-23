// Every file the platform archives and mails is made in the operation of the
// installation: no kind of file may bypass it. The kinds are read from the
// sources — every `ArchivedFileRun` the platform builds, by the job it runs
// under — and each is made here in a test and in a live installation, its
// renderer asked what operation it renders in. A kind the sources build and
// this suite does not make fails, as does one it makes and the sources no
// longer build.
//
// A renderer reaches a file only through a run: every renderer port
// `@saasicat/core` declares is injected only in a source that builds an
// `ArchivedFileRun`, so no service renders a document of its own beside the
// one way every file is made.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AT, aConfirmingInstallation } from './helpers/contract-confirmations.js';
import { marked } from './helpers/installation-marks.js';
import { aRenderer, documentOf } from './helpers/invoice-documents.js';
import { anInvoicingInstallation } from './helpers/invoice-run.js';

const NEST_SOURCES = fileURLToPath(new URL('../src', import.meta.url));
const CORE_SOURCES = fileURLToPath(new URL('../../core/src', import.meta.url));

/** How a source builds a run, its type arguments given or inferred. */
const RUN = 'new ArchivedFileRun';

/**
 * Whether `line` builds a run: `new ArchivedFileRun(`, `new ArchivedFileRun<`,
 * or the name alone at the end of the line, its arguments on the next.
 */
function buildsRun(line) {
    const at = line.trimEnd().indexOf(RUN);
    if (at < 0) return false;
    const next = line.trimEnd().charAt(at + RUN.length);
    return next === '(' || next === '<' || next === '';
}

/**
 * Each kind of file the platform makes, by its job: makes one file of the kind
 * in an installation marked as a test operation or a live one, and answers
 * the operation its renderer was asked to render in, once per rendering.
 */
const MADE = {
    'subscription-invoices': async (testOperation) => {
        const seen = [];
        const renderer = aRenderer({
            render: (invoice) => {
                seen.push(invoice.testOperation);
                return documentOf(invoice);
            },
        });
        const installation = anInvoicingInstallation({
            marks: await marked(testOperation),
            renderer,
        });
        const subscriber = await installation.aSubscriber('t1');
        installation.charge(await installation.aContract(subscriber), 'plan');
        await installation.run();
        await installation.documents.archiveDue(AT);
        return seen;
    },
    'contract-confirmations': async (testOperation) => {
        const installation = aConfirmingInstallation({ marks: await marked(testOperation) });
        await installation.aConfirmableContract('t1');
        await installation.confirmations.archiveDue(AT);
        return installation.renderer.rendered.map((confirmation) => confirmation.testOperation);
    },
};

/** Every TypeScript source under `dir`, by its path, with its text. */
function sourcesUnder(dir) {
    return readdirSync(dir, { recursive: true })
        .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts'))
        .map((path) => ({ path, text: readFileSync(join(dir, path), 'utf8') }));
}

/** The lines of `text` that are code, not comment, with their index. */
function codeLines(text) {
    return text
        .split('\n')
        .map((line, at) => ({ line, at, trimmed: line.trim() }))
        .filter(({ trimmed }) => !trimmed.startsWith('//') && !trimmed.startsWith('*'));
}

/** The string between the first two single quotes of `line`, or `null`. */
function quotedIn(line) {
    const open = line.indexOf("'");
    const close = open < 0 ? -1 : line.indexOf("'", open + 1);
    return close < 0 ? null : line.slice(open + 1, close);
}

/** The job of every `ArchivedFileRun` `sources` build: the first `job:` after each. */
function archivedFileJobs(sources) {
    const jobs = [];
    for (const { path, text } of sources) {
        const lines = text.split('\n');
        for (const { at, line } of codeLines(text)) {
            if (!buildsRun(line)) continue;
            const job = lines
                .slice(at + 1)
                .map((each) => each.trim())
                .find((each) => each.startsWith('job:'));
            const name = job === undefined ? null : quotedIn(job);
            assert.ok(name, `${path}:${at + 1} builds an ArchivedFileRun without a literal job`);
            jobs.push(name);
        }
    }
    return jobs.sort();
}

/** The kinds `sources` build that this suite does not make. */
function unmadeKinds(sources) {
    return archivedFileJobs(sources).filter((job) => !Object.hasOwn(MADE, job));
}

/** The renderer ports `@saasicat/core` declares: every exported interface named `…Renderer`. */
function rendererPorts(sources) {
    const ports = [];
    for (const { text } of sources) {
        for (const { trimmed } of codeLines(text)) {
            if (!trimmed.startsWith('export interface ')) continue;
            const [name] = trimmed.slice('export interface '.length).split(/[\s<{]/);
            if (name.endsWith('Renderer')) ports.push(name);
        }
    }
    return ports.sort();
}

/** Whether `declaration` gives a parameter the type `port`, and nothing that merely starts like it. */
function typedAs(declaration, port) {
    const at = declaration.indexOf(`: ${port}`);
    if (at < 0) return false;
    const after = declaration.charAt(at + 2 + port.length);
    return !/[\w$]/.test(after);
}

/**
 * The sources that inject `port`: a parameter of its type after `@Inject(…)`,
 * on the same line or the next one that is not a decorator.
 */
function injecting(sources, port) {
    return sources
        .filter(({ text }) => {
            const lines = codeLines(text);
            return lines.some(({ trimmed }, index) => {
                if (!trimmed.startsWith('@Inject(')) return false;
                const rest = trimmed.slice(trimmed.indexOf(')') + 1).trim();
                const declaration =
                    rest !== ''
                        ? rest
                        : lines.slice(index + 1).find((each) => !each.trimmed.startsWith('@'))
                              ?.trimmed;
                return declaration !== undefined && typedAs(declaration, port);
            });
        })
        .map(({ path }) => path);
}

/** The sources that inject `port` and build no run. */
function injectedBesideNoRun(sources, port) {
    const building = new Set(
        sources
            .filter(({ text }) => codeLines(text).some(({ line }) => buildsRun(line)))
            .map(({ path }) => path),
    );
    return injecting(sources, port).filter((path) => !building.has(path));
}

const nest = sourcesUnder(NEST_SOURCES);
const core = sourcesUnder(CORE_SOURCES);

describe('every kind of archived file is made in the operation of the installation', () => {
    test('the kinds the sources build are the kinds this suite makes', () => {
        assert.deepEqual(archivedFileJobs(nest), Object.keys(MADE).sort());
    });

    for (const job of Object.keys(MADE)) {
        for (const testOperation of [true, false]) {
            test(`${job}: rendered ${testOperation ? 'as a test' : 'live'} in a ${testOperation ? 'test' : 'live'} installation`, async () => {
                assert.deepEqual(await MADE[job](testOperation), [testOperation]);
            });
        }
    }

    test('every renderer port is injected, and only where a run is built', () => {
        const ports = rendererPorts(core);
        assert.notDeepEqual(ports, [], '@saasicat/core declares no renderer port the scan sees');
        for (const port of ports) {
            assert.notDeepEqual(injecting(nest, port), [], `${port} is injected nowhere`);
            assert.deepEqual(injectedBesideNoRun(nest, port), [], port);
        }
    });
});

describe('the scan sees what it guards against', () => {
    const THIRD_KIND = {
        path: 'billing/third/third-file.service.ts',
        text: [
            'export class ThirdFileService {',
            '    constructor(@Inject(THIRD_RENDERER_TOKEN) renderer: ThirdRenderer) {',
            `        this.run = ${RUN}<ThirdSubject>({`,
            "            job: 'third-files',",
            '            render: (subject) => renderer.render(subject),',
            '        });',
            '    }',
            '}',
        ].join('\n'),
    };
    const RENDERER_BESIDE_NO_RUN = {
        path: 'billing/invoices/invoice-preview.service.ts',
        text: [
            'export class InvoicePreviewService {',
            '    constructor(',
            '        @Optional()',
            '        @Inject(INVOICE_RENDERER_TOKEN)',
            '        private readonly renderer: InvoiceRenderer,',
            '    ) {}',
            '}',
        ].join('\n'),
    };

    test('a third kind of file the sources build is one this suite does not make', () => {
        assert.deepEqual(unmadeKinds(nest), []);
        assert.deepEqual(unmadeKinds([...nest, THIRD_KIND]), ['third-files']);
    });

    test('a renderer injected where no run is built is named', () => {
        assert.deepEqual(
            injectedBesideNoRun([...nest, RENDERER_BESIDE_NO_RUN], 'InvoiceRenderer'),
            [RENDERER_BESIDE_NO_RUN.path],
        );
        assert.deepEqual(injectedBesideNoRun([THIRD_KIND], 'ThirdRenderer'), []);
        assert.equal(typedAs('renderer: InvoiceRendererFactory,', 'InvoiceRenderer'), false);
    });
});
