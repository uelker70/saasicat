import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { judgeModuleResolution, readModuleResolution } from '../dist/index.js';

// The subpath imports init writes resolve under node16/nodenext/bundler and
// under nothing else. A tsconfig is read as text, not JSON — it has comments.

describe('judgeModuleResolution', () => {
    test('accepts the three settings that resolve subpath exports', () => {
        for (const v of ['node16', 'NodeNext', 'bundler', 'Bundler']) {
            assert.equal(
                judgeModuleResolution(`{ "compilerOptions": { "moduleResolution": "${v}" } }`).ok,
                true,
                v,
            );
        }
    });

    test('refuses the old setting and says which to use', () => {
        const verdict = judgeModuleResolution(
            '{ "compilerOptions": { "moduleResolution": "node" } }',
        );
        assert.equal(verdict.ok, false);
        assert.match(verdict.reason, /"node"/);
        assert.match(verdict.reason, /node16.*nodenext.*bundler/);
    });

    test('a tsconfig that says nothing is not refused', () => {
        assert.equal(
            judgeModuleResolution('{ "compilerOptions": { "module": "commonjs" } }').ok,
            true,
        );
    });
});

describe('readModuleResolution', () => {
    test('reads past comments and trailing commas', () => {
        const text = `{
  // the usual NestJS file
  "compilerOptions": {
    "module": "commonjs", /* old */
    "moduleResolution": "node",
  },
}`;
        assert.equal(readModuleResolution(text), 'node');
    });

    test('returns null when the key is absent or unfinished', () => {
        assert.equal(readModuleResolution('{}'), null);
        assert.equal(readModuleResolution('{ "moduleResolution": '), null);
    });
});
