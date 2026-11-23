// The default confirmation renderer: a contract as the subscriber keeps it,
// read back the way a person reads it — the parties, the contract's facts, its
// lines and what it costs, its notice period and the terms it was concluded
// under — and the same bytes every time it is rendered.

// @requirement SC-AUD-016 — Concluding or changing a contract gives the subscriber a confirmation to keep

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { contractConfirmationRenderer } from '../dist/index.js';
import { FOOTER, aContract, line, toConfirm } from './support/contracts.js';
import { pageTexts } from './support/page-text.js';

const renderer = contractConfirmationRenderer();
const confirm = (contract = aContract(), footer = FOOTER) =>
    renderer.render(toConfirm(contract, { footer }));

describe('a contract’s confirmation', () => {
    test('names the parties, the contract’s facts, its lines and what it costs, in German and English', async () => {
        const [page] = await pageTexts((await confirm()).content);

        for (const text of [
            'AutohausPro Software GmbH',
            'USt-IdNr. / VAT ID: DE123456789',
            'Autohaus Müller GmbH & Co. KG',
            'Vertragsbestätigung / Contract confirmation contract-1',
            'Vertrag / Contract',
            'Geschlossen am / Concluded on',
            '01.02.2026',
            'K-10001',
            'Abrechnung / Billing',
            'monatlich / monthly',
            'Standard, monatlich',
            '01.02.2027',
            'Willkommensrabatt 10 %',
            '-4,90',
            'Zwischensumme netto / Subtotal net',
            '64,00',
            'Summe netto / Net total',
            '59,10',
            'USt 19 % / VAT 19 %',
            '11,23',
            'Gesamtbetrag / Total (EUR)',
            '70,33',
            FOOTER[0],
        ]) {
            assert.ok(page.includes(text), `the page does not say "${text}"`);
        }
    });

    test('states the notice period and the terms it was concluded under, attached', async () => {
        const text = (await pageTexts((await confirm()).content))[0].join(' ');

        assert.ok(text.includes('Kündigungsfrist: 14 Tage / Notice period: 14 days'), text);
        assert.ok(
            text.includes('in der Fassung 2026-10; sie liegen dieser Bestätigung bei.'),
            text,
        );
        assert.ok(text.includes('of version 2026-10 apply; they are attached'), text);
    });

    test('of a contract concluded under no terms says so, rather than naming a version', async () => {
        const text = (
            await pageTexts((await confirm(aContract({ termsVersion: null }))).content)
        )[0].join(' ');

        assert.ok(text.includes('keine Allgemeinen Geschäftsbedingungen vereinbart'), text);
        assert.ok(!text.includes('Fassung'), text);
    });

    test('carries the treatment’s note where the contract’s treatment has one', async () => {
        const note = 'Steuerschuldnerschaft des Leistungsempfängers';
        const contract = aContract({
            taxTreatment: { ...aContract().taxTreatment, kind: 'reverse-charge', rate: 0, note },
        });

        const text = (await pageTexts((await confirm(contract)).content))[0].join(' ');

        assert.ok(text.includes(note), text);
    });

    test('renders into the same bytes every time, and dated when the contract was written', async () => {
        const first = await confirm();
        const second = await confirm();

        assert.deepEqual(first.content, second.content);
        assert.equal(first.mediaType, 'application/pdf');
        assert.equal(first.fileName, 'contract-confirmation-contract-1.pdf');
        const raw = Buffer.from(first.content).toString('latin1');
        assert.ok(raw.includes('/CreationDate (D:20260131233000Z)'), 'dated when it was written');
    });

    test('runs on over as many pages as its lines need, each numbered', async () => {
        const lineItems = Array.from({ length: 60 }, (_, index) =>
            line(`Zusatzmodul ${index + 1}`, 1),
        );

        const pages = await pageTexts((await confirm(aContract({ lineItems }))).content);

        assert.ok(pages.length > 1, `${pages.length} page`);
        assert.ok(
            pages
                .at(-1)
                .includes(
                    `Seite ${pages.length} von ${pages.length} / Page ${pages.length} of ${pages.length}`,
                ),
        );
        const written = pages.flat().filter((text) => text.startsWith('Zusatzmodul '));
        assert.deepEqual(
            written,
            lineItems.map((item) => item.titleSnapshot),
            'every line once, in its order',
        );
    });

    test('is refused for a contract that names no issuer', async () => {
        await assert.rejects(confirm(aContract({ issuer: null })), /names no issuer/);
    });
});
