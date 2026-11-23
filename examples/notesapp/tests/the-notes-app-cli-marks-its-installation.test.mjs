// The notes app's command line: the platform's `installation status|mark` and
// `doctor`, and nothing else — enough for an operator to mark the database a
// tenant may be deleted from. DB-free — the module is compiled, which builds
// every provider and connects to nothing, and the commands are read off the
// program `nest-commander` builds from it.

// @requirement SC-COMP-014 — The example application is kept in step with the platform

import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The seeded SuperAdmin as `super_admin_users` holds it. */
const ADMIN_ROW = {
    id: 'demo-user-admin',
    email: 'admin@notesapp.example',
    passwordHash: 'scrypt$…',
    firstName: 'Demo',
    lastName: 'Admin',
    platformRole: 'SUPER_ADMIN',
    isActive: true,
    lastLoginAt: null,
    deletedAt: null,
};

describe("the notes app's command line", () => {
    const environment = {
        SECRET_SEALER_KEY: 'ZGVtby1rZXktZm9yLXRoZS1ub3Rlc2FwcC1zdGFjayE=',
        SAASICAT_INSTALLATION: 'notesapp-test',
    };
    const saved = {};

    before(() => {
        for (const [key, value] of Object.entries(environment)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
    });

    after(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    /** Compiles the CLI the way `CommandFactory.run` mounts it, and builds its program. */
    async function compileTheCli() {
        const { Test } = await import('@nestjs/testing');
        const { CliModule } = await import('../dist/cli/cli.module.js');
        // The app is compiled to CommonJS, so the runner is the class its
        // `require` loads.
        const { CommandRunnerModule, CommandRunnerService } = require('nest-commander');

        // Compiling builds every provider — the platform module with the ends
        // of subscriptions, the operator's identity and the doctor's checks —
        // and connects to nothing: the client connects when the application
        // initialises.
        const moduleRef = await Test.createTestingModule({
            imports: [CommandRunnerModule.forModule(CliModule)],
        }).compile();
        const runner = moduleRef.get(CommandRunnerService);
        // What `CommandFactory.run` does before it parses the arguments.
        await runner.onModuleInit();
        return { moduleRef, program: runner.commander };
    }

    test('offers the installation status, marking it, and the doctor — and no other command', async () => {
        const { moduleRef, program } = await compileTheCli();
        try {
            const offered = program.commands.map((command) => [
                command.name(),
                command.commands.map((sub) => sub.name()),
            ]);

            assert.deepEqual(Object.fromEntries(offered), {
                doctor: [],
                installation: ['status', 'mark'],
            });
        } finally {
            await moduleRef.close();
        }
    });

    // @requirement SC-AUD-025 — An operator's command line starts where the application refuses on its documents
    test('says it is an operator command line, which the application does not', async () => {
        const { Test } = await import('@nestjs/testing');
        const { AppModule } = await import('../dist/app.module.js');
        const { OPERATOR_COMMAND_LINE_TOKEN } = require('@saasicat/nest');
        const { moduleRef } = await compileTheCli();
        const application = await Test.createTestingModule({ imports: [AppModule] }).compile();
        try {
            // So the start leaves the check of the installation's operation to
            // the commands that name and repair a disagreement.
            assert.equal(moduleRef.get(OPERATOR_COMMAND_LINE_TOKEN, { strict: false }), true);
            assert.throws(() => application.get(OPERATOR_COMMAND_LINE_TOKEN, { strict: false }));
        } finally {
            await application.close();
            await moduleRef.close();
        }
    });

    test("runs the platform's checks in the doctor, the installation's mark among them", async () => {
        const { moduleRef } = await compileTheCli();
        try {
            const { DOCTOR_CHECKS_TOKEN } = require('@saasicat/cli');
            const checks = moduleRef.get(DOCTOR_CHECKS_TOKEN, { strict: false });

            assert.ok(
                checks.some((check) => check.id === 'platform.installation-mark'),
                checks.map((check) => check.id).join(', '),
            );
        } finally {
            await moduleRef.close();
        }
    });
});

describe("the notes app's operators", () => {
    /** The port over a `super_admin_users` table holding `rows`. */
    async function operatorsOver(rows) {
        const { NotesOperators } = await import('../dist/cli/notes-operators.js');
        const askedFor = [];
        const prisma = {
            superAdminUser: {
                findUnique: async ({ where }) => {
                    askedFor.push(where);
                    return (
                        rows.find((row) =>
                            Object.entries(where).every(([key, value]) => row[key] === value),
                        ) ?? null
                    );
                },
            },
        };
        return { operators: new NotesOperators(prisma), askedFor };
    }

    test('finds the seeded SuperAdmin by its e-mail, under the id its second factor is kept by', async () => {
        const { operators, askedFor } = await operatorsOver([ADMIN_ROW]);

        const user = await operators.findByEmail('Admin@Notesapp.Example');

        assert.deepEqual(askedFor, [{ email: 'admin@notesapp.example' }]);
        assert.deepEqual(user, {
            id: 'demo-user-admin',
            email: 'admin@notesapp.example',
            firstName: 'Demo',
            lastName: 'Admin',
            platformRole: 'SUPER_ADMIN',
            isActive: true,
            lastLoginAt: null,
            deletedAt: null,
        });
    });

    test('knows nobody under an e-mail no SuperAdmin has', async () => {
        const { operators } = await operatorsOver([ADMIN_ROW]);

        assert.equal(await operators.findByEmail('someone@notesapp.example'), null);
    });

    test('says an operator is gone, and since when, rather than leaving it out', async () => {
        const deletedAt = new Date('2026-10-01T09:00:00.000Z');
        const { operators } = await operatorsOver([
            { ...ADMIN_ROW, isActive: false, deletedAt, lastLoginAt: deletedAt },
        ]);

        const user = await operators.findById('demo-user-admin');

        assert.equal(user.isActive, false);
        assert.equal(user.deletedAt, '2026-10-01T09:00:00.000Z');
        assert.equal(user.lastLoginAt, '2026-10-01T09:00:00.000Z');
    });

    test('holds the role the row names, and no other', async () => {
        const { operators } = await operatorsOver([ADMIN_ROW]);

        assert.equal(await operators.hasRole('demo-user-admin', 'SUPER_ADMIN'), true);
        assert.equal(await operators.hasRole('demo-user-admin', 'TENANT_ADMIN'), false);
        assert.equal(await operators.hasRole('nobody', 'SUPER_ADMIN'), false);
    });

    test('refuses a row whose role is no platform role, rather than guessing one', async () => {
        const { operators } = await operatorsOver([{ ...ADMIN_ROW, platformRole: 'ROOT' }]);

        await assert.rejects(
            operators.findById('demo-user-admin'),
            /'ROOT', which is no platform role/,
        );
    });

    test("refuses a tenant's users with a sentence, since the notes CLI has no user commands", async () => {
        const { operators } = await operatorsOver([ADMIN_ROW]);

        for (const call of [
            () => operators.countActive('acme'),
            () => operators.listForTenant('acme', {}),
            () => operators.resetPassword('demo-user-admin', 'hash'),
        ]) {
            await assert.rejects(call(), /notes app's command line has no `user` command/);
        }
    });
});

describe('the seeded SuperAdmin the command line acts as', () => {
    const KEY = 'ZGVtby1rZXktZm9yLXRoZS1ub3Rlc2FwcC1zdGFjayE=';

    /** `super_admin_users` and `super_admin_mfa`, holding `factor` for the demo admin. */
    function tables(factor = null) {
        const written = { users: [], factors: [] };
        const prisma = {
            superAdminUser: {
                upsert: async (args) => {
                    written.users.push(args);
                },
            },
            superAdminMfa: {
                findUnique: async ({ where }) =>
                    factor && where.userId === factor.userId ? factor : null,
                upsert: async (args) => {
                    written.factors.push(args);
                },
            },
        };
        return { prisma, written };
    }

    async function seeding() {
        const { seedSuperAdmin } = await import('../dist/seed-super-admin.js');
        const { aesGcmSecretSealer } = require('@saasicat/nest/platform');
        return { seedSuperAdmin, sealer: aesGcmSecretSealer(KEY) };
    }

    /** The secret an otpauth URI hands to the authenticator. */
    const secretOf = (uri) => new URL(uri).searchParams.get('secret');

    test('keeps the operator and its second factor under one id, also for a row seeded under another', async () => {
        const { seedSuperAdmin, sealer } = await seeding();
        const { prisma, written } = tables();

        await seedSuperAdmin(prisma, sealer);

        const [user] = written.users;
        const [factor] = written.factors;
        assert.equal(user.create.id, 'demo-user-admin');
        assert.equal(user.update.id, 'demo-user-admin');
        assert.equal(factor.where.userId, 'demo-user-admin');
    });

    test('stores the second factor sealed with the installation key, as the platform opens it', async () => {
        const { seedSuperAdmin, sealer } = await seeding();
        const { prisma, written } = tables();

        const uri = await seedSuperAdmin(prisma, sealer);

        const stored = written.factors[0].create.secret;
        assert.notEqual(stored, secretOf(uri));
        assert.equal(await sealer.open(stored), secretOf(uri));
    });

    test('keeps a second factor the key opens, so an authenticator set up once keeps working', async () => {
        const { seedSuperAdmin, sealer } = await seeding();
        const sealed = await sealer.seal('JBSWY3DPEHPK3PXP');
        const { prisma, written } = tables({ userId: 'demo-user-admin', secret: sealed });

        assert.equal(await seedSuperAdmin(prisma, sealer), null);
        assert.deepEqual(written.factors, []);
    });

    test('replaces a second factor the key cannot open, which checks no code', async () => {
        const { seedSuperAdmin, sealer } = await seeding();
        const { prisma, written } = tables({
            userId: 'demo-user-admin',
            secret: 'JBSWY3DPEHPK3PXP',
        });

        const uri = await seedSuperAdmin(prisma, sealer);

        assert.equal(await sealer.open(written.factors[0].update.secret), secretOf(uri));
    });
});
