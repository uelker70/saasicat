// What a command acting as an operator is given and prints, stood in for the
// same way by every test of such a command.

import assert from 'node:assert/strict';

import { CliError } from '../../dist/index.js';

/** The CLI context, recording what each command asked of it and what it wrote to the audit log. */
export function recordingContext() {
    const asked = [];
    const logged = [];
    return {
        asked,
        logged,
        resolveIdentity(as) {
            asked.push('identity');
            const email = as ?? 'ops@example.com';
            return { email, host: 'deploy-host', actor: `cli:${email}:deploy-host` };
        },
        async ensureSuperAdmin() {
            asked.push('super-admin');
            return { id: 'user-ops' };
        },
        async ensureProductionConfirmation({ yes }) {
            asked.push(yes ? 'confirmed with --yes' : 'confirmation');
        },
        async requireMfa(userId) {
            asked.push(`second factor of ${userId}`);
        },
        async log(entry) {
            asked.push('audit');
            logged.push(entry);
        },
    };
}

/** The CliError `fn` threw. */
export async function cliErrorOf(fn) {
    try {
        await fn();
    } catch (error) {
        assert.ok(error instanceof CliError, `expected a CliError, got ${error}`);
        return error;
    }
    assert.fail('expected a CliError');
}

/** What `command.run` wrote to stdout. */
export async function printed(command, flags = {}) {
    const chunks = [];
    const write = process.stdout.write;
    process.stdout.write = (chunk) => {
        chunks.push(String(chunk));
        return true;
    };
    try {
        await command.run([], flags);
    } finally {
        process.stdout.write = write;
    }
    return chunks.join('');
}
