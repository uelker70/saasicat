import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreatePromoCodeDto, UpdatePromoCodeDto } from '../dist/promo/index.js';

// The columns hold two places, up to 999,999.99 for a discount and
// 99,999,999.99 for a minimum. An amount they cannot hold is refused where the
// operator enters it: rounded on its way into the table it would be a
// different discount than the one they typed, and too large it would fail
// there with a 500.

const CREATE = { code: 'SPRING-25', valueType: 'ABSOLUTE', value: 5, durationType: 'ONCE' };

async function refusedFields(Dto, body) {
    const errors = await validate(plainToInstance(Dto, body), { whitelist: true });
    return errors.map((error) => error.property).sort();
}

// @requirement SC-PROMO-026 — A discount is kept as the operator entered it, or refused
describe('an amount entered for a code', () => {
    for (const [Dto, base, name] of [
        [CreatePromoCodeDto, CREATE, 'creating'],
        [UpdatePromoCodeDto, {}, 'changing'],
    ]) {
        test(`${name}: two places are taken`, async () => {
            assert.deepEqual(
                await refusedFields(Dto, { ...base, value: 1.01, minimumPlanAmountGross: 49.9 }),
                [],
            );
        });

        test(`${name}: an amount in exponent notation is counted, not a crash`, async () => {
            // `1e-7` is valid JSON for 0.0000001. Counting places by splitting
            // the text at its decimal point finds none; class-validator's own
            // `maxDecimalPlaces` then throws, and the request gets a 500.
            for (const tiny of [1e-7, 1.5e-9]) {
                assert.deepEqual(
                    await refusedFields(Dto, {
                        ...base,
                        value: tiny,
                        minimumPlanAmountGross: tiny,
                    }),
                    ['minimumPlanAmountGross', 'value'],
                    String(tiny),
                );
            }
        });

        test(`${name}: the largest amount a column holds is taken, one cent more is refused`, async () => {
            assert.deepEqual(
                await refusedFields(Dto, {
                    ...base,
                    value: 999_999.99,
                    minimumPlanAmountGross: 99_999_999.99,
                }),
                [],
            );
            assert.deepEqual(
                await refusedFields(Dto, {
                    ...base,
                    value: 1_000_000,
                    minimumPlanAmountGross: 100_000_000,
                }),
                ['minimumPlanAmountGross', 'value'],
            );
            assert.deepEqual(
                await refusedFields(Dto, { ...base, value: 1e21, minimumPlanAmountGross: 1e21 }),
                ['minimumPlanAmountGross', 'value'],
                'a whole number too large for the column',
            );
        });

        test(`${name}: a third place is refused, on the discount and on the minimum`, async () => {
            assert.deepEqual(
                await refusedFields(Dto, {
                    ...base,
                    value: 1.005,
                    minimumPlanAmountGross: 10.005,
                }),
                ['minimumPlanAmountGross', 'value'],
            );
        });
    }
});
