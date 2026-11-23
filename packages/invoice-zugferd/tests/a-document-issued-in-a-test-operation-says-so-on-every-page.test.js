// What every renderer the package exports makes of a document issued in a
// test operation, read back the way its recipient and a tax auditor read it:
// the title says it is a test, the notice stands under the title and at the
// foot of every page, and an invoice's XML states it as its first note. A
// document issued live says none of it. The renderers are taken from what the
// package exports, so one added later fails here until its documents are.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PDFDocument } from 'pdf-lib';
import { TEST_OPERATION_NOTICE, TEST_OPERATION_TITLE } from '@saasicat/core';

import * as shipped from '../dist/index.js';
import { aContract, line, toConfirm } from './support/contracts.js';
import { embeddedXml } from './support/embedded-xml.js';
import { SAMPLES } from './support/invoices.js';
import { pageRuns } from './support/page-text.js';

/** A text as the documents set it: German, then English. */
const both = (text) => `${text.de} / ${text.en}`;

/** The foot of a page: its number, the notice and the footer lines, set at 7 points in its lower half. */
const A4_HEIGHT = 841.89;
const inFoot = (run) => run.size === 7 && run.y < A4_HEIGHT / 2;

/** Every wording a document of a test operation carries, in either language. */
const EVERY_MARK = [
    ...Object.values(TEST_OPERATION_TITLE),
    ...Object.values(TEST_OPERATION_NOTICE),
].flatMap((text) => [text.de, text.en]);

/** The renderer classes the package exports, found by their `render`. */
const exportedRenderers = Object.entries(shipped)
    .filter(([, value]) => typeof value?.prototype?.render === 'function')
    .map(([name]) => name);

/** A contract running on over more lines than one page holds. */
const LONG_CONTRACT = aContract({
    lineItems: Array.from({ length: 60 }, (_, index) => line(`Zusatzmodul ${index + 1}`, 1)),
});

/**
 * Every document each renderer is held to, live and in a test operation: what
 * it is rendered from, what it is called in a test operation, its number, the
 * notice it then carries, and whether it carries an XML.
 */
const DOCUMENTS = {
    ZugferdInvoiceRenderer: SAMPLES.map(({ name, invoice }) => ({
        name,
        input: invoice,
        testOperation: invoice.testOperation,
        title:
            invoice.correction?.kind === 'cancellation'
                ? TEST_OPERATION_TITLE.cancellation
                : TEST_OPERATION_TITLE.invoice,
        number: invoice.number,
        notice: TEST_OPERATION_NOTICE.invoice,
        carriesXml: true,
    })),
    PdfContractConfirmationRenderer: [
        ['one-page', aContract()],
        ['without-terms', aContract({ termsVersion: null })],
        ['many-lines', LONG_CONTRACT],
    ].flatMap(([name, contract]) =>
        [false, true].map((testOperation) => ({
            name: testOperation ? `${name}-test` : name,
            input: toConfirm(contract, { testOperation }),
            testOperation,
            title: TEST_OPERATION_TITLE.confirmation,
            number: contract.id,
            notice: TEST_OPERATION_NOTICE.confirmation,
            carriesXml: false,
        })),
    ),
};

/** The runs after `index` joined as they read, up to the length of `text`. */
function readOn(runs, index, text) {
    let said = '';
    for (const run of runs.slice(index + 1)) {
        said = said === '' ? run.text : `${said} ${run.text}`;
        if (said.length >= text.length) break;
    }
    return said;
}

/** The text of the first note of an XML's document header; `null` where it has none. */
function firstNoteOf(xml) {
    const open = '<ram:IncludedNote><ram:Content>';
    const at = xml.indexOf(open);
    if (at === -1 || at > xml.indexOf('</rsm:ExchangedDocument>')) return null;
    const from = at + open.length;
    return xml.slice(from, xml.indexOf('</ram:Content>', from));
}

test('every renderer the package exports is held to what a test operation marks', () => {
    assert.deepEqual(exportedRenderers.sort(), Object.keys(DOCUMENTS).sort());
});

for (const [renderer, documents] of Object.entries(DOCUMENTS)) {
    const render = (input) => new shipped[renderer]().render(input);

    describe(`${renderer}, for a document issued in a test operation`, () => {
        for (const { name, input, title, number, notice, carriesXml } of documents.filter(
            (each) => each.testOperation,
        )) {
            test(`(${name}) says so in its title and in the notice under it, at the foot of every page, in its metadata${carriesXml ? ' and first in its XML' : ''}`, async () => {
                const { content } = await render(input);
                const pages = await pageRuns(content);
                const heading = `${both(title)} ${number}`;

                pages.forEach((runs, index) => {
                    const texts = runs.map((run) => run.text);
                    assert.ok(
                        texts.includes(heading),
                        `page ${index + 1} is not headed ${heading}`,
                    );
                    const foot = runs
                        .filter(inFoot)
                        .map((run) => run.text)
                        .join(' ');
                    assert.ok(foot.includes(both(notice)), `page ${index + 1}'s foot: ${foot}`);
                });
                const first = pages[0];
                const titled = first.findIndex((run) => run.text === heading);
                assert.equal(readOn(first, titled, both(notice)), both(notice), 'under the title');
                const pdf = await PDFDocument.load(content, { updateMetadata: false });
                assert.equal(pdf.getTitle(), `${title.de} ${number}`);
                if (carriesXml) assert.equal(firstNoteOf(await embeddedXml(content)), both(notice));
            });

            test(`(${name}) renders into the same bytes every time`, async () => {
                const first = await render(input);
                const again = await render(input);

                assert.deepEqual(again.content, first.content);
            });
        }

        test('is rendered over more than one page at least once, so that every page is read', async () => {
            const counts = await Promise.all(
                documents
                    .filter((each) => each.testOperation)
                    .map(
                        async ({ input }) => (await pageRuns((await render(input)).content)).length,
                    ),
            );

            assert.ok(
                counts.some((count) => count > 1),
                `pages: ${counts.join(', ')}`,
            );
        });
    });

    describe(`${renderer}, for a document issued live`, () => {
        for (const { name, input, carriesXml } of documents.filter((each) => !each.testOperation)) {
            test(`(${name}) says none of it, on any page, in its metadata${carriesXml ? ' or in its XML' : ''}`, async () => {
                const { content } = await render(input);
                const said = (await pageRuns(content))
                    .flat()
                    .map((run) => run.text)
                    .join(' ');
                const pdf = await PDFDocument.load(content, { updateMetadata: false });
                const xml = carriesXml ? await embeddedXml(content) : '';

                for (const mark of EVERY_MARK) {
                    assert.ok(!said.includes(mark), `the page says "${mark}"`);
                    assert.ok(!pdf.getTitle().includes(mark), `the title says "${mark}"`);
                    assert.ok(!xml.includes(mark), `the XML says "${mark}"`);
                }
            });
        }
    });
}
