// InstallationCliFlow — `<app> installation status|mark`.
//
// A tenant's deletion runs only in a database that carries the identifier of
// the environment the process runs in (`SC-PRIV-021`). Nothing writes that mark
// on its own; the operator does, from here:
//
//     <app> installation status                  # whose database this is
//     <app> installation mark prod               # mark it as this environment's
//     <app> installation mark staging --replace  # after restoring a backup here
//     <app> installation mark int --operation test  # a test operation
//
// The mark also says how the installation operates: `--operation test` makes
// it a test operation, whose documents are all marked as tests, and
// `--operation live` a live one. Without the option a new mark is live and a
// mark that stands keeps its operation, `--replace` included: the operation
// belongs to the data. Once the installation has issued a document, the
// operation is the one its documents recorded, and another is refused. Where
// the mark says another operation than they recorded, the application refuses
// to start, and the status names it and the mark that repairs it: a command
// line starts on it, for that.
//
// Marking takes the second factor and, against production, a confirmation:
// a mark releases deletions, and a replaced one moves them to another
// environment. The service refuses an identifier that is not the one this
// environment names, and records every mark in the audit log; this flow adds
// nothing there.

import { Inject, Injectable } from '@nestjs/common';
import {
    type AdminActor,
    INSTALLATION_OPERATIONS,
    type InstallationOperation,
    type InstallationStatus,
    installationOperationOf,
} from '@saasicat/core';
import { InstallationMarkService, type InstallationMarkOutcome } from '@saasicat/nest';

import { CliContextService, CliError } from './cli-context.service.js';
import { refusalsAsCliErrors } from './cli-refusals.js';
import { installationStatusText } from './installation-verdict.js';

const EXIT_USER_ERROR = 1;

export interface InstallationMarkOptions {
    as?: string;
    yes?: boolean;
    /** Replace another installation's mark; without it, one that stands is refused. */
    replace?: boolean;
    /** `test` or `live`, as typed; left out, a new mark is live and one that stands keeps its own. */
    operation?: string;
}

@Injectable()
export class InstallationCliFlow {
    constructor(
        @Inject(CliContextService) private readonly ctx: CliContextService,
        @Inject(InstallationMarkService) private readonly marks: InstallationMarkService,
    ) {}

    /** Whether the database belongs to this environment, and how it operates. Reads; asks for no identity. */
    status(): Promise<InstallationStatus> {
        return this.marks.status();
    }

    /**
     * Marks the database as this environment's installation, with the second
     * factor and, against production, a confirmation — both before anything is
     * written. Refused with exit code 6 where another installation's mark
     * stands and `replace` is not given, where the operation asked for is not
     * the one the installation's documents recorded, and where it changes while
     * they cannot be read; 1 for an identifier that is not this environment's
     * and for an operation that is neither `test` nor `live` — that one before
     * anybody is asked for.
     */
    async mark(
        identifier: string,
        options: InstallationMarkOptions,
    ): Promise<InstallationMarkOutcome> {
        const operation = operationOf(options.operation);
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
        const write = operation === undefined ? {} : { operation };
        return refusalsAsCliErrors('INSTALLATION_MARK_REFUSED', () =>
            options.replace
                ? this.marks.replace(identifier, actor, write)
                : this.marks.mark(identifier, actor, write),
        );
    }

    /** The status, for the terminal. */
    formatStatus(status: InstallationStatus): string {
        return installationStatusText(status);
    }

    /** What marking came to, for the terminal. */
    formatOutcome(outcome: InstallationMarkOutcome): string {
        const { identifier, markedAt, markedBy } = outcome.mark;
        const operation = installationOperationOf(outcome.mark);
        switch (outcome.kind) {
            case 'marked':
                return `This database is marked as installation ${identifier} now, as a ${operation} operation.`;
            case 'already-marked':
                return (
                    `This database was marked as installation ${identifier} already, as a ` +
                    `${operation} operation, on ${markedAt.toISOString()} by ${markedBy}; ` +
                    'nothing was written.'
                );
            case 'replaced':
                return (
                    `This database is marked as installation ${identifier} now, as a ` +
                    `${operation} operation, in place of the mark it carried.`
                );
            case 'operation-changed':
                return (
                    `This database, installation ${identifier}, is marked as a ${operation} ` +
                    `operation now, in place of a ${outcome.from} operation.`
                );
        }
    }
}

function operationOf(given: string | undefined): InstallationOperation | undefined {
    if (given === undefined) return undefined;
    const operation = INSTALLATION_OPERATIONS.find((each) => each === given);
    if (!operation) {
        throw new CliError(
            'INSTALLATION_OPERATION_INVALID',
            `--operation takes ${INSTALLATION_OPERATIONS.join(' or ')} — got '${given}'.`,
            EXIT_USER_ERROR,
        );
    }
    return operation;
}
