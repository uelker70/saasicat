// A plan change, its preview and an onboarding name the rhythm they are billed
// in, and there are two. The preview prices any other word as monthly and the
// change stores it beside a contract frozen in the rhythm it was priced in, so
// a third one is refused at the boundary, before either reads it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
    ChangePlanDto,
    CompleteOnboardingSubscriptionDto,
    PreviewPlanChangeDto,
} from '../dist/billing/index.js';

/** The properties `validate` finds fault with, for `body` sent as `Dto`. */
async function faultsOf(Dto, body) {
    const errors = await validate(plainToInstance(Dto, body), { whitelist: true });
    return errors.map((error) => error.property);
}

for (const Dto of [PreviewPlanChangeDto, ChangePlanDto, CompleteOnboardingSubscriptionDto]) {
    describe(`the rhythm ${Dto.name} names`, () => {
        for (const billingCycle of ['MONTHLY', 'YEARLY']) {
            test(`${billingCycle} is accepted`, async () => {
                assert.deepEqual(await faultsOf(Dto, { plan: 'STANDARD', billingCycle }), []);
            });
        }

        for (const [what, billingCycle] of [
            ['a third rhythm in the same spelling', 'WEEKLY'],
            ['a sold rhythm in lower case', 'monthly'],
            ['an empty one', ''],
            ['none at all', undefined],
            ['a number', 12],
        ]) {
            test(`${what} is refused`, async () => {
                assert.deepEqual(await faultsOf(Dto, { plan: 'STANDARD', billingCycle }), [
                    'billingCycle',
                ]);
            });
        }
    });
}
