import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSeedGateFromFile } from '../dist/catalog/index.js';

// Seed-Gate-Runner (#23) — geteilte I/O-Schale: Modus-Semantik (report-only
// vs. blocking) + Snapshot-Datei-Handling. Exit wird injiziert, damit der
// Test den blocking-Pfad beobachten kann.

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
    test('report-only ohne Snapshot → null + Warnung, kein Exit', () => {
        const { lines, sink } = capture();
        const report = runSeedGateFromFile({
            snapshotPath: '/nope/missing.json',
            plans: [{ planKey: 'STARTER', features: ['A'] }],
            warn: sink,
        });
        assert.equal(report, null);
        assert.match(lines[0], /übersprungen/);
    });

    test('blocking ohne Snapshot → Exit 4', () => {
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

    test('report-only mit Verstößen → Report, Seed läuft weiter', () => {
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

    test('blocking mit Verstößen → Exit 4', () => {
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

    test('sauberer Seed → Report ok, kein Exit', () => {
        const report = runSeedGateFromFile({
            snapshotPath: snapshotFile(['A']),
            plans: [{ planKey: 'STARTER', features: ['A'] }],
            mode: 'blocking',
            log: () => {},
        });
        assert.equal(report.overall, 'ok');
    });
});
