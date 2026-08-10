// Shared `<app> user` command for consumer CLIs.
// Cross-tenant user operations:
//   create-super-admin <email>  --first --last [--password] [--yes]
//   reassign-admin     <slug>   --to=<email> --reason="…"
//   list               <slug>
//   reset-password     <email>  --reason="…"
//   deactivate         <email>  --reason="…" [--yes]
//
// The generic flow (identity → MFA → production-confirm → audit → output)
// lives here; the app-specific schema mutations sit behind the
// `UserManagementPort`. Spec: saas-platform-spec/cli-conventions.md §3.5.

import { Inject, Injectable } from '@nestjs/common';
import type { UserManagementPort } from '@saasicat/types';
import { randomBytes } from 'node:crypto';
import { Command, CommandRunner, Option } from 'nest-commander';

import { CliContextService, CliError, type CliIdentity } from './cli-context.service.js';
import { USER_MANAGEMENT_PORT_TOKEN } from './tokens.js';

interface UserFlags {
    as?: string;
    to?: string;
    reason?: string;
    yes?: boolean;
    first?: string;
    last?: string;
    password?: string;
}

const AUDIT_ENTITY = 'User';

function generatePassword(): string {
    return randomBytes(12).toString('base64url');
}

@Injectable()
@Command({
    name: 'user',
    description:
        'User operations (create-super-admin, reassign-admin, list, reset-password, deactivate)',
})
export class UserCommands extends CommandRunner {
    constructor(
        private readonly ctx: CliContextService,
        @Inject(USER_MANAGEMENT_PORT_TOKEN) private readonly users: UserManagementPort,
    ) {
        super();
    }

    async run(args: string[], flags: UserFlags): Promise<void> {
        const sub = args[0];
        const identity = this.ctx.resolveIdentity(flags.as);
        const me = await this.ctx.ensureSuperAdmin(identity);

        switch (sub) {
            case 'create-super-admin':
                return this.createSuperAdmin(args[1], flags, identity, me.id, me.email);
            case 'reassign-admin':
                return this.reassignAdmin(args[1], flags, identity, me.id);
            case 'list':
                return this.list(args[1]);
            case 'reset-password':
                return this.resetPassword(args[1], flags, identity, me.id);
            case 'deactivate':
                return this.deactivate(args[1], flags, identity, me.id);
            default:
                throw new CliError(
                    'UNKNOWN_SUBCOMMAND',
                    `Unknown sub-command: user ${sub ?? '(empty)'}. Available: create-super-admin <email>, reassign-admin <slug>, list <slug>, reset-password <email>, deactivate <email>.`,
                    1,
                );
        }
    }

    private async createSuperAdmin(
        email: string | undefined,
        flags: UserFlags,
        identity: CliIdentity,
        meId: string,
        meEmail: string,
    ): Promise<void> {
        if (!email) {
            throw new CliError(
                'MISSING_ARG',
                'user create-super-admin <email> expects an email address.',
                1,
            );
        }
        await this.ctx.requireMfa(meId);
        await this.ctx.ensureProductionConfirmation({ yes: flags.yes });

        const generated = !flags.password;
        const password = flags.password ?? generatePassword();
        const created = await this.users.createSuperAdmin({
            email: email.toLowerCase(),
            password,
            firstName: flags.first,
            lastName: flags.last,
        });

        await this.ctx.log({
            identity,
            userId: meId,
            entity: AUDIT_ENTITY,
            entityId: created.id,
            action: 'SUPER_ADMIN_CREATE',
            changes: { email: created.email, createdBy: meEmail },
        });

        console.log(`✔ SUPER_ADMIN ${created.email} created (by ${meEmail}).`);
        console.log(`  User-ID: ${created.id}`);
        if (generated) {
            console.log(`  Password: ${password}`);
            console.log('  → Share it securely. Change it on first login.');
        }
        console.log(`  Next step: admin mfa-setup for ${created.email}.`);
    }

    private async reassignAdmin(
        slug: string | undefined,
        flags: UserFlags,
        identity: CliIdentity,
        meId: string,
    ): Promise<void> {
        if (!slug) {
            throw new CliError(
                'MISSING_ARG',
                'user reassign-admin <tenant-slug> expects a slug.',
                1,
            );
        }
        if (!flags.to) throw new CliError('MISSING_FLAG', '--to=<email> is required.', 1);
        if (!flags.reason) throw new CliError('MISSING_FLAG', '--reason="…" is required.', 1);
        await this.ctx.requireMfa(meId);

        const result = await this.users.reassignTenantAdmin(slug, flags.to.toLowerCase());

        await this.ctx.log({
            identity,
            userId: meId,
            entity: AUDIT_ENTITY,
            entityId: result.user.id,
            action: result.created ? 'USER_REASSIGN_ADMIN' : 'USER_ROLE_CHANGE',
            changes: {
                tenant: slug,
                to: 'TENANT_ADMIN',
                from: result.previousRole,
                reason: flags.reason,
                emergency: true,
            },
        });

        if (result.created) {
            console.log(`✔ Emergency admin ${result.user.email} created for ${slug}.`);
            if (result.oneTimePassword) {
                console.log(`  Initial password: ${result.oneTimePassword}`);
                console.log('  → Share it securely. Change it on first login.');
            }
        } else {
            console.log(`✔ ${result.user.email} is now TENANT_ADMIN of ${slug}.`);
        }
    }

    private async list(slug: string | undefined): Promise<void> {
        if (!slug) {
            throw new CliError('MISSING_ARG', 'user list <tenant-slug> expects a slug.', 1);
        }
        const rows = await this.users.listTenantUsers(slug);
        this.ctx.table(
            rows.map((u) => ({
                email: u.email,
                role: u.role,
                status: u.status,
                lastLogin: u.lastLoginAt?.slice(0, 10) ?? '—',
            })),
        );
    }

    private async resetPassword(
        email: string | undefined,
        flags: UserFlags,
        identity: CliIdentity,
        meId: string,
    ): Promise<void> {
        if (!email) {
            throw new CliError(
                'MISSING_ARG',
                'user reset-password <email> expects an email address.',
                1,
            );
        }
        if (!flags.reason) throw new CliError('MISSING_FLAG', '--reason="…" is required.', 1);

        const result = await this.users.triggerPasswordReset(email.toLowerCase());

        await this.ctx.log({
            identity,
            userId: meId,
            entity: AUDIT_ENTITY,
            entityId: result.user.id,
            action: 'USER_PASSWORD_RESET_TRIGGERED',
            changes: { reason: flags.reason },
        });

        if (result.oneTimePassword) {
            console.log(`✔ One-time password set for ${result.user.email}.`);
            console.log(`  Password: ${result.oneTimePassword}`);
            console.log('  → Share it securely. Change it on first login.');
        } else {
            console.log(`✔ Password reset triggered for ${result.user.email}.`);
        }
    }

    private async deactivate(
        email: string | undefined,
        flags: UserFlags,
        identity: CliIdentity,
        meId: string,
    ): Promise<void> {
        if (!email) {
            throw new CliError(
                'MISSING_ARG',
                'user deactivate <email> expects an email address.',
                1,
            );
        }
        if (!flags.reason) throw new CliError('MISSING_FLAG', '--reason="…" is required.', 1);
        await this.ctx.requireMfa(meId);
        await this.ctx.ensureProductionConfirmation({ yes: flags.yes });

        const user = await this.users.deactivate(email.toLowerCase(), flags.reason);

        await this.ctx.log({
            identity,
            userId: meId,
            entity: AUDIT_ENTITY,
            entityId: user.id,
            action: 'USER_DEACTIVATED',
            changes: { reason: flags.reason, emergency: true },
        });

        console.log(`✔ ${user.email} deactivated.`);
    }

    @Option({ flags: '--as <email>', description: 'CLI identity (otherwise <APP>_ADMIN_EMAIL)' })
    parseAs(val: string): string {
        return val;
    }
    @Option({ flags: '--to <email>', description: 'Target user (reassign-admin)' })
    parseTo(val: string): string {
        return val;
    }
    @Option({ flags: '--reason <text>', description: 'Reason (audit)' })
    parseReason(val: string): string {
        return val;
    }
    @Option({ flags: '-y, --yes', description: 'Skip the production confirmation' })
    parseYes(): boolean {
        return true;
    }
    @Option({ flags: '--first <name>', description: 'First name (create-super-admin)' })
    parseFirst(val: string): string {
        return val;
    }
    @Option({ flags: '--last <name>', description: 'Last name (create-super-admin)' })
    parseLast(val: string): string {
        return val;
    }
    @Option({
        flags: '--password <pwd>',
        description: 'Password (create-super-admin; generated when omitted)',
    })
    parsePassword(val: string): string {
        return val;
    }
}
