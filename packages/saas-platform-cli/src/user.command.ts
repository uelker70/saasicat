// Geteiltes `<app> user`-Command für Konsumenten-CLIs (AutohausPro `ahp`,
// vereinsfux `vf`, …). Mandanten-übergreifende User-Operationen:
//   create-super-admin <email>  --first --last [--password] [--yes]
//   reassign-admin     <slug>   --to=<email> --reason="…"
//   list               <slug>
//   reset-password     <email>  --reason="…"
//   deactivate         <email>  --reason="…" [--yes]
//
// Der generische Ablauf (Identity → MFA → Production-Confirm → Audit → Output)
// lebt hier; die app-spezifischen Schema-Mutationen liegen hinter dem
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
        'User-Operationen (create-super-admin, reassign-admin, list, reset-password, deactivate)',
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
                    `Unbekannter Subbefehl: user ${sub ?? '(leer)'}. Verfügbar: create-super-admin <email>, reassign-admin <slug>, list <slug>, reset-password <email>, deactivate <email>.`,
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
            throw new CliError('MISSING_ARG', 'user create-super-admin <email> erwartet eine E-Mail.', 1);
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

        console.log(`✔ SUPER_ADMIN ${created.email} angelegt (durch ${meEmail}).`);
        console.log(`  User-ID: ${created.id}`);
        if (generated) {
            console.log(`  Passwort: ${password}`);
            console.log('  → Sicher übermitteln. Beim ersten Login ändern.');
        }
        console.log(`  Nächster Schritt: admin mfa-setup für ${created.email}.`);
    }

    private async reassignAdmin(
        slug: string | undefined,
        flags: UserFlags,
        identity: CliIdentity,
        meId: string,
    ): Promise<void> {
        if (!slug) {
            throw new CliError('MISSING_ARG', 'user reassign-admin <tenant-slug> erwartet einen Slug.', 1);
        }
        if (!flags.to) throw new CliError('MISSING_FLAG', '--to=<email> ist Pflicht.', 1);
        if (!flags.reason) throw new CliError('MISSING_FLAG', '--reason="…" ist Pflicht.', 1);
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
            console.log(`✔ Notfall-Admin ${result.user.email} für ${slug} angelegt.`);
            if (result.oneTimePassword) {
                console.log(`  Initial-Passwort: ${result.oneTimePassword}`);
                console.log('  → Sicher übermitteln. Beim ersten Login ändern.');
            }
        } else {
            console.log(`✔ ${result.user.email} ist jetzt TENANT_ADMIN von ${slug}.`);
        }
    }

    private async list(slug: string | undefined): Promise<void> {
        if (!slug) {
            throw new CliError('MISSING_ARG', 'user list <tenant-slug> erwartet einen Slug.', 1);
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
            throw new CliError('MISSING_ARG', 'user reset-password <email> erwartet eine E-Mail.', 1);
        }
        if (!flags.reason) throw new CliError('MISSING_FLAG', '--reason="…" ist Pflicht.', 1);

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
            console.log(`✔ Einmal-Passwort für ${result.user.email} gesetzt.`);
            console.log(`  Passwort: ${result.oneTimePassword}`);
            console.log('  → Sicher übermitteln. Beim ersten Login ändern.');
        } else {
            console.log(`✔ Passwort-Reset für ${result.user.email} ausgelöst.`);
        }
    }

    private async deactivate(
        email: string | undefined,
        flags: UserFlags,
        identity: CliIdentity,
        meId: string,
    ): Promise<void> {
        if (!email) {
            throw new CliError('MISSING_ARG', 'user deactivate <email> erwartet eine E-Mail.', 1);
        }
        if (!flags.reason) throw new CliError('MISSING_FLAG', '--reason="…" ist Pflicht.', 1);
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

        console.log(`✔ ${user.email} deaktiviert.`);
    }

    @Option({ flags: '--as <email>', description: 'CLI-Identität (sonst <APP>_ADMIN_EMAIL)' })
    parseAs(val: string): string {
        return val;
    }
    @Option({ flags: '--to <email>', description: 'Ziel-User (reassign-admin)' })
    parseTo(val: string): string {
        return val;
    }
    @Option({ flags: '--reason <text>', description: 'Begründung (Audit)' })
    parseReason(val: string): string {
        return val;
    }
    @Option({ flags: '-y, --yes', description: 'Production-Confirmation überspringen' })
    parseYes(): boolean {
        return true;
    }
    @Option({ flags: '--first <name>', description: 'Vorname (create-super-admin)' })
    parseFirst(val: string): string {
        return val;
    }
    @Option({ flags: '--last <name>', description: 'Nachname (create-super-admin)' })
    parseLast(val: string): string {
        return val;
    }
    @Option({
        flags: '--password <pwd>',
        description: 'Passwort (create-super-admin; ohne Angabe generiert)',
    })
    parsePassword(val: string): string {
        return val;
    }
}
