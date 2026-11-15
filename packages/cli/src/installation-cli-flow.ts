// InstallationCliFlow — `<app> installation status|mark`.
//
// A tenant's deletion runs only in a database that carries the identifier of
// the environment the process runs in (`SC-PRIV-021`). Nothing writes that mark
// on its own; the operator does, from here:
//
//     <app> installation status                  # whose database this is
//     <app> installation mark prod               # mark it as this environment's
//     <app> installation mark staging --replace  # after restoring a backup here
//
// Marking takes the second factor and, against production, a confirmation:
// a mark releases deletions, and a replaced one moves them to another
// environment. The service refuses an identifier that is not the one this
// environment names, and records every mark in the audit log; this flow adds
// nothing there.

import { Inject, Injectable } from '@nestjs/common';
import type { AdminActor, InstallationMarkVerdict } from '@saasicat/core';
import { InstallationMarkService, type InstallationMarkOutcome } from '@saasicat/nest';

import { CliContextService } from './cli-context.service.js';
import { refusalsAsCliErrors } from './cli-refusals.js';
import { installationVerdictText } from './installation-verdict.js';

export interface InstallationMarkOptions {
    as?: string;
    yes?: boolean;
    /** Replace another installation's mark; without it, one that stands is refused. */
    replace?: boolean;
}

@Injectable()
export class InstallationCliFlow {
    constructor(
        @Inject(CliContextService) private readonly ctx: CliContextService,
        @Inject(InstallationMarkService) private readonly marks: InstallationMarkService,
    ) {}

    /** Whether the database belongs to this environment. Reads; asks for no identity. */
    status(): Promise<InstallationMarkVerdict> {
        return this.marks.verdict();
    }

    /**
     * Marks the database as this environment's installation, with the second
     * factor and, against production, a confirmation — both before anything is
     * written. Refused with exit code 6 where another installation's mark
     * stands and `replace` is not given, 1 for an identifier that is not this
     * environment's.
     */
    async mark(
        identifier: string,
        options: InstallationMarkOptions,
    ): Promise<InstallationMarkOutcome> {
        const identity = this.ctx.resolveIdentity(options.as);
        const user = await this.ctx.ensureSuperAdmin(identity);
        await this.ctx.requireMfa(user.id);
        await this.ctx.ensureProductionConfirmation({ yes: options.yes });
        const actor: AdminActor = {
            userId: user.id,
            email: identity.email,
            source: 'cli',
            context: identity.host,
        };
        return refusalsAsCliErrors('INSTALLATION_MARK_REFUSED', () =>
            options.replace
                ? this.marks.replace(identifier, actor)
                : this.marks.mark(identifier, actor),
        );
    }

    /** The verdict, for the terminal. */
    formatStatus(verdict: InstallationMarkVerdict): string {
        return installationVerdictText(verdict);
    }

    /** What marking came to, for the terminal. */
    formatOutcome(outcome: InstallationMarkOutcome): string {
        const { identifier, markedAt, markedBy } = outcome.mark;
        switch (outcome.kind) {
            case 'marked':
                return `This database is marked as installation ${identifier} now.`;
            case 'already-marked':
                return (
                    `This database was marked as installation ${identifier} already, on ` +
                    `${markedAt.toISOString()} by ${markedBy}; nothing was written.`
                );
            case 'replaced':
                return `This database is marked as installation ${identifier} now, in place of the mark it carried.`;
        }
    }
}
