import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSeedGateFromFile } from '../dist/catalog/index.js';

// Seed-Gate runner (#23) — shared I/O shell: mode semantics (report-only
// vs. blocking) + snapshot file handling. Exit is injected so the test can
// observe the blocking path.

function snapshotFile(features = []) {
    const dir = mkdtempSync(join(tmpdir(), 'seed-gate-runner-'));
    const path = join(dir, 'discovery-snapshot.json');
    writeFileSync(
        path,
        JSON.stringify({
            schemaVersion: 1,
            scannedAt: '2026-06-10T00:00:00.000Z',
            app: { key: 'clubapp', version: '0.1.0' },
            capabilities: [],
            features: features.map((f) => ({ featureKey: f, capabilityKeys: [] })),
            quotas: [],
            hash: 'sha256-test',
        }),
    );
    return path;
}

function capture() {
    const lines = [];
    const sink = (line) => lines.push(line);
    return { lines, sink };
}

function exitRecorder() {
    const calls = [];
    return {
        calls,
        exit: (code) => {
            calls.push(code);
            throw new Error(`exit:${code}`);
        },
    };
}

describe('runSeedGateFromFile', () => {
    test('report-only without snapshot → null + warning, no exit', () => {
        const { lines, sink } = capture();
        const report = runSeedGateFromFile({
            snapshotPath: '/nope/missing.json',
            plans: [{ planKey: 'STARTER', features: ['A'] }],
            warn: sink,
        });
        assert.equal(report, null);
        assert.match(lines[0], /übersprungen/);
    });

    test('blocking without snapshot → exit 4', () => {
        const { calls, exit } = exitRecorder();
        assert.throws(
            () =>
                runSeedGateFromFile({
                    snapshotPath: '/nope/missing.json',
                    mode: 'blocking',
                    error: () => {},
                    exit,
                }),
            /exit:4/,
        );
        assert.deepEqual(calls, [4]);
    });

    test('report-only with violations → report, seed continues', () => {
        const { sink } = capture();
        const report = runSeedGateFromFile({
            snapshotPath: snapshotFile(['REAL']),
            plans: [{ planKey: 'STARTER', features: ['LUFTSCHLOSS'] }],
            log: sink,
            warn: sink,
        });
        assert.equal(report.overall, 'error');
        assert.equal(report.findings[0].warning.code, 'PLAN_FEATURE_UNKNOWN');
    });

    test('blocking with violations → exit 4', () => {
        const { calls, exit } = exitRecorder();
        assert.throws(
            () =>
                runSeedGateFromFile({
                    snapshotPath: snapshotFile(['REAL']),
                    plans: [{ planKey: 'STARTER', features: ['LUFTSCHLOSS'] }],
                    mode: 'blocking',
                    log: () => {},
                    error: () => {},
                    exit,
                }),
            /exit:4/,
        );
        assert.deepEqual(calls, [4]);
    });

    test('clean seed → report ok, no exit', () => {
        const report = runSeedGateFromFile({
            snapshotPath: snapshotFile(['A']),
            plans: [{ planKey: 'STARTER', features: ['A'] }],
            mode: 'blocking',
            log: () => {},
        });
        assert.equal(report.overall, 'ok');
    });
});
