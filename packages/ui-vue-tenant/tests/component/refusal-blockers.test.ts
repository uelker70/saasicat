// The reasons a refusal lists beside its own sentence, read off what the
// server answered: each entry that names a code and says something, with the
// values it can be worded with, and nothing of what cannot be read.

import { describe, expect, test } from 'vitest';

import { refusalBlockersOf } from '../../src/refusal-of.js';

const refused = (body: unknown) => Object.assign(new Error('400'), { body });

describe('the reasons a refusal lists', () => {
    test('are its blockers, each with its code, its message and its values', () => {
        expect(
            refusalBlockersOf(
                refused({
                    code: 'PLAN_CHANGE_BLOCKED',
                    blockers: [
                        { code: 'A', message: 'First.', params: { used: 6, quotaKey: 'vehicles' } },
                        { code: 'B', message: 'Second.' },
                    ],
                }),
            ),
        ).toEqual([
            { code: 'A', message: 'First.', params: { used: 6, quotaKey: 'vehicles' } },
            { code: 'B', message: 'Second.', params: {} },
        ]);
    });

    test('keep only the values a sentence can name', () => {
        const [reason] = refusalBlockersOf(
            refused({
                blockers: [
                    { code: 'A', message: 'First.', params: { used: 6, at: { day: 1 }, ok: true } },
                ],
            }),
        );
        expect(reason?.params).toEqual({ used: 6 });
    });

    for (const [why, body] of [
        ['a refusal without blockers', { code: 'PLAN_CHANGE_BLOCKED' }],
        ['blockers that are no list', { blockers: 'over the limit' }],
        ['no body at all', undefined],
    ] as const) {
        test(`are none for ${why}`, () => {
            expect(refusalBlockersOf(refused(body))).toEqual([]);
        });
    }

    test('leave out an entry without a code or a message, and one that is no entry', () => {
        expect(
            refusalBlockersOf(
                refused({
                    blockers: [
                        { message: 'No code.' },
                        { code: 'A' },
                        'over the limit',
                        null,
                        { code: 'B', message: 'Readable.' },
                    ],
                }),
            ),
        ).toEqual([{ code: 'B', message: 'Readable.', params: {} }]);
    });
});
