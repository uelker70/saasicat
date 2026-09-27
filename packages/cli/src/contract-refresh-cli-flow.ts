// ContractRefreshCliFlow — `<app> contracts refresh`.
//
// Carries a changed feature vocabulary into contracts in force, on the
// operator's command (`SC-ENTL-023`):
//
//     <app> contracts refresh --all                  # shows what would change
//     <app> contracts refresh --all --apply --yes    # writes it
//
// Without `--apply` it writes nothing and says so: the preview is the command,
// and the write is the second one. `--full` re-freezes the contracts the way a
// plan change does, and refuses every contract whose price, tax rate or
// currency would change. Both write a successor and keep the contract they
// replace, superseded.

import { Inject, Injectable } from '@nestjs/common';
import type { AdminActor } from '@saasicat/core';
import {
    ContractRefreshService,
    type ContractRefreshMode,
    type ContractRefreshOutcome,
    type ContractRefreshPreview,
    type ContractRefreshRefusal,
    type ContractRefreshSelection,
} from '@saasicat/nest';

import { CliContextService, CliError } from './cli-context.service.js';

/** Exit codes per `cli-conventions.md` §6. */
const EXIT_USER_ERROR = 1;
const EXIT_CONFLICT = 6;

export interface RefreshOptions {
    as?: string;
    yes?: boolean;
    /** The contracts to look at, by id. */
    contract?: string[];
    /** Every contract in force. */
    all?: boolean;
    /** Re-freeze in full rather than replace the features alone. */
    full?: boolean;
    /** Write the successors; without it nothing is written. */
    apply?: boolean;
}

@Injectable()
export class ContractRefreshCliFlow {
    constructor(
        @Inject(CliContextService) private readonly ctx: CliContextService,
        @Inject(ContractRefreshService) private readonly refresh: ContractRefreshService,
    ) {}

    /**
     * What a refresh would change on each contract selected. Writes nothing;
     * asks for the operator's identity, because it reads every tenant's
     * contracts, and for no confirmation.
     */
    async preview(options: RefreshOptions): Promise<ContractRefreshPreview[]> {
        const selection = selectionOf(options);
        await this.operator(options.as);
        return this.refresh.preview(selection, modeOf(options));
    }

    /**
     * Writes a successor for each contract selected that would change and is
     * not refused. Refused with exit code 6 where any contract was refused or
     * moved in between — after the others are written, so that one contract
     * needing a decision does not hold up the rest.
     */
    async apply(options: RefreshOptions): Promise<ContractRefreshOutcome[]> {
        const selection = selectionOf(options);
        const actor = await this.operator(options.as);
        await this.ctx.ensureProductionConfirmation({ yes: options.yes });
        return this.refresh.apply(selection, modeOf(options), actor);
    }

    /** The exit code a script branches on: 6 where a contract still needs someone. */
    exitCodeOf(outcomes: readonly ContractRefreshOutcome[]): number {
        return outcomes.some((outcome) => outcome.refusal || outcome.moved) ? EXIT_CONFLICT : 0;
    }

    /** One block per contract and a closing line, for the terminal. */
    format(
        results: readonly (ContractRefreshPreview | ContractRefreshOutcome)[],
        applied: boolean,
    ): string {
        if (results.length === 0) return 'No contract is in force.';
        const blocks = results.map((result) => formatOne(result, applied));
        return [...blocks, summaryOf(results, applied)].join('\n\n');
    }

    private async operator(as: string | undefined): Promise<AdminActor> {
        const identity = this.ctx.resolveIdentity(as);
        const user = await this.ctx.ensureSuperAdmin(identity);
        return { userId: user.id, email: identity.email, source: 'cli', context: identity.host };
    }
}

function selectionOf(options: RefreshOptions): ContractRefreshSelection {
    const named = options.contract ?? [];
    if (options.all && named.length > 0) {
        throw new CliError(
            'CONTRACT_SELECTION_AMBIGUOUS',
            'Name contracts with --contract, or take every contract in force with --all — not both.',
            EXIT_USER_ERROR,
        );
    }
    if (!options.all && named.length === 0) {
        throw new CliError(
            'CONTRACT_SELECTION_REQUIRED',
            'Name the contracts with --contract <id>, or take every contract in force with --all.',
            EXIT_USER_ERROR,
        );
    }
    return options.all ? {} : { contractIds: named };
}

function modeOf(options: RefreshOptions): ContractRefreshMode {
    return options.full ? 'full' : 'features';
}

function formatOne(result: ContractRefreshPreview | ContractRefreshOutcome, applied: boolean) {
    const lines = [`Contract ${result.contractId} (tenant ${result.tenantId ?? 'unknown'})`];
    const { added, removed } = result.features;
    if (added.length > 0 || removed.length > 0) {
        lines.push(
            `  features: ${[...added.map((key) => `+${key}`), ...removed.map((key) => `-${key}`)].join(' ')}`,
        );
    }
    for (const quota of result.quotas) {
        lines.push(`  quota ${quota.key}: ${quota.before ?? 'none'} -> ${quota.after ?? 'none'}`);
    }
    for (const change of result.money) {
        lines.push(`  ${change.field}: ${change.before ?? 'none'} -> ${change.after ?? 'none'}`);
    }
    if (result.vocabulary.unknown.length > 0) {
        lines.push(
            `  keys the application no longer knows: ${result.vocabulary.unknown.join(', ')}`,
        );
    }
    if (result.vocabulary.missing.length > 0) {
        lines.push(`  granted today and missing: ${result.vocabulary.missing.join(', ')}`);
    }
    lines.push(`  ${verdictOf(result, applied)}`);
    return lines.join('\n');
}

function verdictOf(result: ContractRefreshPreview | ContractRefreshOutcome, applied: boolean) {
    if (result.refusal) return `left as it is: ${refusalText(result.refusal)}`;
    if ('moved' in result && result.moved) {
        return 'left as it is: it changed while its successor was written; run the command again';
    }
    if (!result.changes) return 'unchanged';
    if ('successorId' in result && result.successorId) {
        return `written as ${result.successorId}; the contract it replaces is kept, superseded`;
    }
    return applied ? 'not written' : 'would be written';
}

function refusalText(refusal: ContractRefreshRefusal): string {
    switch (refusal.code) {
        case 'NOT_IN_FORCE':
            return 'no such contract is in force';
        case 'NO_SUBSCRIPTION':
            return 'its tenant has no subscription to read today’s versions from';
        case 'PLAN_VERSION_NOT_RECORDED':
            return 'it does not say which plan version it was frozen from; --full re-freezes it';
        case 'PLAN_VERSION_MOVED':
            return (
                `it records plan version ${refusal.recorded}, and the subscription is bound to ` +
                `${refusal.bound}; --full re-freezes it and weighs the price`
            );
        case 'MONEY_WOULD_CHANGE':
            return 'a re-freeze would charge differently (above); decide by hand';
        case 'REFUSED':
            return refusal.reason;
    }
}

function summaryOf(
    results: readonly (ContractRefreshPreview | ContractRefreshOutcome)[],
    applied: boolean,
): string {
    const leftAlone = results.filter((r) => r.refusal || ('moved' in r && r.moved)).length;
    const changing = results.filter((r) => !r.refusal && r.changes && !('moved' in r && r.moved));
    const unchanged = results.length - leftAlone - changing.length;
    const head =
        `${results.length} contract(s): ${changing.length} ` +
        `${applied ? 'written' : 'would change'}, ${leftAlone} left as they are, ${unchanged} unchanged.`;
    return applied
        ? head
        : `${head} Nothing was written; run the same command with --apply to write them.`;
}
