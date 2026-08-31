// @requirement SC-MKT-022 — A catalogue offers at most one recommended plan, and the language decides which

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { keepOneRecommended } from '../dist/index.js';

const card = (planKey, highlight) => ({ planKey, highlight });
const marked = (plans) => plans.filter((plan) => plan.highlight).map((plan) => plan.planKey);

describe('keepOneRecommended', () => {
    test('one is left alone', () => {
        const plans = [card('A', true), card('B', false)];
        assert.equal(keepOneRecommended(plans, new Set())?.planKey, 'A');
        assert.deepEqual(marked(plans), ['A']);
    });

    test('none stays none, and the answer is null', () => {
        const plans = [card('A', false), card('B', false)];
        assert.equal(keepOneRecommended(plans, new Set()), null);
        assert.deepEqual(marked(plans), []);
    });

    test('a row written for the language beats one inherited from the default', () => {
        const plans = [card('A', true), card('B', true)];
        assert.equal(keepOneRecommended(plans, new Set(['B']))?.planKey, 'B');
        assert.deepEqual(marked(plans), ['B']);
    });

    test('and it wins from anywhere in the list, not only from the front', () => {
        const plans = [card('A', true), card('B', false), card('C', true)];
        assert.equal(keepOneRecommended(plans, new Set(['C']))?.planKey, 'C');
        assert.deepEqual(marked(plans), ['C']);
    });

    test('with none written for the language, the first the caller offers wins', () => {
        const plans = [card('A', true), card('B', true)];
        assert.equal(keepOneRecommended(plans, new Set())?.planKey, 'A');
        assert.deepEqual(marked(plans), ['A']);
    });

    test('with every one written for it, the first still wins', () => {
        // A caller with no fallback to model — the SuperAdmin edits one
        // language at a time — gets the same answer whichever set it passes.
        const plans = [card('A', true), card('B', true)];
        assert.equal(keepOneRecommended(plans, new Set(['A', 'B']))?.planKey, 'A');
        assert.deepEqual(marked(plans), ['A']);
    });

    test('a plan that is not recommended is never made one', () => {
        const plans = [card('A', false), card('B', true)];
        keepOneRecommended(plans, new Set(['A']));
        assert.deepEqual(marked(plans), ['B']);
    });

    test('an empty catalogue answers null rather than throwing', () => {
        assert.equal(keepOneRecommended([], new Set()), null);
    });

    test('only the mark is touched — every card stays', () => {
        const plans = [card('A', true), card('B', true), card('C', false)];
        keepOneRecommended(plans, new Set());
        assert.deepEqual(
            plans.map((plan) => plan.planKey),
            ['A', 'B', 'C'],
        );
    });
});
