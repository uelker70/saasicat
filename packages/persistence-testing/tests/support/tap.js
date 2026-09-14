// Runs a test file in a node:test process of its own and reads the counts off its TAP report.

import { spawnSync } from 'node:child_process';

/**
 * `args` go before the file. `node --test` marks its children with
 * NODE_TEST_CONTEXT and they report to the parent instead of stdout; the file
 * is a run of its own, so the marker is dropped.
 */
export function runTestFile(file, { args = [], env = {} } = {}) {
    const { NODE_TEST_CONTEXT: _parentRunner, ...inherited } = process.env;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...args, file], {
        env: { ...inherited, ...env },
        encoding: 'utf8',
    });
    const lines = result.stdout.split('\n');
    const count = (name) => {
        const prefix = `# ${name} `;
        const line = lines.find((l) => l.startsWith(prefix));
        return line === undefined ? Number.NaN : Number(line.slice(prefix.length));
    };
    return {
        pass: count('pass'),
        fail: count('fail'),
        skip: count('skipped'),
        output: result.stdout,
    };
}
