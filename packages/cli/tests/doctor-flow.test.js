import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DoctorFlow } from '../dist/index.js';

function buildCheck(id, label, result) {
    return {
        id,
        label,
        run: async () => result,
    };
}

function buildThrowingCheck(id, label, errorMessage) {
    return {
        id,
        label,
        run: async () => {
            throw new Error(errorMessage);
        },
    };
}

describe('DoctorFlow.run', () => {
    test('all checks ok → overall=ok, exitCode=0', async () => {
        const checks = [
            buildCheck('c1', 'Check 1', { severity: 'ok', message: 'fine' }),
            buildCheck('c2', 'Check 2', { severity: 'ok', message: 'fine' }),
        ];
        const flow = new DoctorFlow(checks);
        const report = await flow.run();
        assert.equal(report.overall, 'ok');
        assert.equal(report.checks.length, 2);
        assert.equal(flow.exitCodeFor(report), 0);
    });

    test('one warning + ok → overall=warning, exitCode=0', async () => {
        const checks = [
            buildCheck('c1', 'Check 1', { severity: 'ok', message: 'fine' }),
            buildCheck('c2', 'Check 2', { severity: 'warning', message: 'meh' }),
        ];
        const flow = new DoctorFlow(checks);
        const report = await flow.run();
        assert.equal(report.overall, 'warning');
        assert.equal(flow.exitCodeFor(report), 0);
    });

    test('one error → overall=error, exitCode=4', async () => {
        const checks = [
            buildCheck('c1', 'Check 1', { severity: 'ok', message: 'fine' }),
            buildCheck('c2', 'Check 2', { severity: 'error', message: 'broken' }),
            buildCheck('c3', 'Check 3', { severity: 'warning', message: 'meh' }),
        ];
        const flow = new DoctorFlow(checks);
        const report = await flow.run();
        assert.equal(report.overall, 'error');
        assert.equal(flow.exitCodeFor(report), 4);
    });

    test('exception in check → severity=error with exception message', async () => {
        const checks = [
            buildCheck('c1', 'Check 1', { severity: 'ok', message: 'fine' }),
            buildThrowingCheck('c2', 'Crashy', 'kaputt'),
        ];
        const flow = new DoctorFlow(checks);
        const report = await flow.run();
        assert.equal(report.overall, 'error');
        assert.equal(report.checks[1].severity, 'error');
        assert.match(report.checks[1].message, /kaputt/);
    });

    test('empty check list → overall=ok', async () => {
        const flow = new DoctorFlow([]);
        const report = await flow.run();
        assert.equal(report.overall, 'ok');
        assert.equal(report.checks.length, 0);
    });
});

describe('DoctorFlow.formatReport', () => {
    test('shows icons per severity', async () => {
        const flow = new DoctorFlow([]);
        const report = {
            overall: 'warning',
            checks: [
                { id: 'a', label: 'A', severity: 'ok', message: 'fine' },
                { id: 'b', label: 'B', severity: 'warning', message: 'meh' },
                { id: 'c', label: 'C', severity: 'error', message: 'broken' },
            ],
        };
        const out = flow.formatReport(report);
        assert.match(out, /WARNING/);
        assert.match(out, /✓ {2}A/);
        assert.match(out, /⚠ {2}B/);
        assert.match(out, /✗ {2}C/);
    });
});
