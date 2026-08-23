import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CODE_MAX_LENGTH, CODE_MIN_LENGTH, CODE_PATTERN } from '../dist/promo/index.js';

// The promo-code pattern is a literal with the bounds written into it, because
// a pattern assembled from the constants is what the regex lint refuses. This
// is what keeps the two from drifting: change one, and this says so.
test('the code pattern carries exactly the declared bounds', () => {
    assert.equal(CODE_PATTERN.test('A'.repeat(CODE_MIN_LENGTH)), true);
    assert.equal(CODE_PATTERN.test('A'.repeat(CODE_MIN_LENGTH - 1)), false);
    assert.equal(CODE_PATTERN.test('A'.repeat(CODE_MAX_LENGTH)), true);
    assert.equal(CODE_PATTERN.test('A'.repeat(CODE_MAX_LENGTH + 1)), false);
    assert.match(CODE_PATTERN.source, new RegExp(`\\{${CODE_MIN_LENGTH},${CODE_MAX_LENGTH}\\}`)); // eslint-disable-line no-restricted-syntax -- two integers, no metacharacters to escape
});
