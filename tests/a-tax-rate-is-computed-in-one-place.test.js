// @requirement SC-CFG-035 — Every tax rate is a percentage, wherever it is stated

// Guard: arithmetic on a tax rate lives in one file.
//
// Every tax rate is a percentage, and `packages/nest/src/promo/math.ts` holds
// the only code that turns one into a factor: `grossFromNet`, `netFromGross`,
// `computeIncludedVat`, and `isTaxRatePercent`, which refuses anything else. A
// second place writing `1 + vatRate` is where a second unit can come in
// unnoticed: nothing tells a fraction written there from the percentage the
// rest of the system states.
//
// Read as text: a line of shipped source that names a rate and also carries a
// factor marker — `1 +`, `100 +`, `100 -`, `/ 100` or `* 100` — is arithmetic on the rate. A
// comment line is prose about it and is not counted. What this does not see is
// a rate copied into a variable with another name first and multiplied there;
// that stays a review question.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The one file allowed to compute with a rate. */
const THE_PLACE = 'packages/nest/src/promo/math.ts';

const RATE_NAMES = ['vatRate', 'taxRate', 'vatPercent'];
const FACTOR_MARKERS = [
    '1 +',
    '1+',
    '100 +',
    '100+',
    '100 -',
    '100-',
    '/ 100',
    '/100',
    '* 100',
    '*100',
];

/** Whether a line of source computes with a tax rate. */
function computesWithRate(line) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return false;
    }
    return (
        RATE_NAMES.some((name) => line.includes(name)) &&
        FACTOR_MARKERS.some((marker) => line.includes(marker))
    );
}

const sources = execFileSync('git', ['ls-files', 'packages', 'examples'], {
    cwd: ROOT,
    encoding: 'utf8',
})
    .split('\n')
    .filter((path) => path.includes('/src/') && (path.endsWith('.ts') || path.endsWith('.vue')))
    .filter((path) => !path.endsWith('.d.ts') && !path.includes('/generated/'));

describe('arithmetic on a tax rate', () => {
    test('the scan has sources to read, and the one place is among them', () => {
        assert.ok(sources.length > 100, `only ${sources.length} source files found`);
        assert.ok(sources.includes(THE_PLACE), `${THE_PLACE} is not tracked`);
        const place = readFileSync(join(ROOT, THE_PLACE), 'utf8').split('\n');
        assert.ok(
            place.some(computesWithRate),
            'the one place computes nothing, so the scan sees nothing',
        );
    });

    test('happens nowhere else', () => {
        const found = [];
        for (const path of sources) {
            if (path === THE_PLACE) continue;
            readFileSync(join(ROOT, path), 'utf8')
                .split('\n')
                .forEach((line, index) => {
                    if (computesWithRate(line)) found.push(`${path}:${index + 1}: ${line.trim()}`);
                });
        }
        assert.deepEqual(found, [], 'compute through grossFromNet or netFromGross instead');
    });

    test('the scan sees the shapes it names, and not prose or other names', () => {
        assert.equal(computesWithRate('    return round2(net * (1 + vatRate / 100));'), true);
        assert.equal(
            computesWithRate('const gross = net * (1 + offer.priceBreakdown.vatRate);'),
            true,
        );
        assert.equal(computesWithRate('    taxRate: round2(rate * 100),'), true);
        assert.equal(computesWithRate('const net = gross / (100 + vatRate);'), true);
        assert.equal(computesWithRate(' * Gross = net * (1 + vatRate/100).'), false);
        assert.equal(computesWithRate('// net * (1 + vatRate)'), false);
        assert.equal(computesWithRate('const total = net * (1 + surcharge / 100);'), false);
        assert.equal(computesWithRate('    vatRate: catalog.vatRate,'), false);
    });
});
