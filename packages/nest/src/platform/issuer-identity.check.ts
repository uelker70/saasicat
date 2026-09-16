// Refuses a start whose `config/saas.yaml` names a legal entity other than the
// one this installation recorded.
//
// The issuer is the operator's side of every contract, and a contract copies it
// on the day it is concluded. Change the legal name or a tax identifier and the
// running contracts keep naming the entity they were concluded with, while
// everything issued from now on names another one — which is how an invoice
// ends up asking for payment on behalf of somebody the contract was never
// concluded with.
//
// Nothing here can tell a correction of the same entity from another one taking
// over: a renamed GmbH and its successor read identically in a file. So the
// operator declares which it is, under `issuer.correctionOf`, and an undeclared
// change is refused rather than guessed at. Moving a contract to another legal
// entity is a transfer, not an edit of a setting.
//
// The comparison is against the settings record and not against the contracts,
// and that is what makes a declared correction hold: the record moves with the
// correction, so the next start finds the file and the record agreeing, while
// the contracts keep the copy they were concluded with for ever. The contracts
// are read only to say which ones a refusal is about.
//
// Two classes, and the split is the point. `IssuerIdentityInspector` answers the
// question and acts on nothing, so `<app> doctor` and an application's own
// diagnostics can ask it; `IssuerIdentityCheck` is the lifecycle hook that turns
// a refusing answer into a boot that does not happen.
//
// The hook is `onModuleInit`, which Nest runs for every module before it runs a
// single `onApplicationBootstrap` — and `AppliedSettingsRecorder`, which
// replaces the record, is a bootstrap hook. That ordering is what lets this
// compare against the record of the *previous* start rather than against the one
// this start just wrote.

import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import {
    classifyIssuerChange,
    LEGAL_IDENTITY_FIELDS,
    recordedIssuerIdentity,
    type AppliedSettingsPort,
    type AppliedSettingsValues,
    type IssuerCorrectionFault,
    type IssuerIdentityChange,
    type LegalIdentity,
    type LegalIdentityField,
    type PlanCatalog,
    type RunningContractIssuer,
    type RunningContractIssuers,
    type SubscriptionContractRepository,
} from '@saasicat/core';

import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { APPLIED_SETTINGS_PORT_TOKEN, SETTINGS_SOURCE_TOKEN } from '../settings/settings.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../subscription-contract/subscription-contract.tokens.js';

/**
 * How many contracts a refusal names before it stops naming them.
 *
 * The count is always exact; this caps the list. An operator needs enough rows
 * to recognise what the change would touch, not a page of identifiers nobody
 * reads — and a refusal that scrolls is one whose last line, the way out, is
 * the part that scrolls off.
 */
const CONTRACTS_NAMED = 5;

/** Why nothing was compared, where the installation keeps no record at all. */
const NOT_RECORDED = 'this installation records no applied settings';

/** An undeclared change is the only one that refuses a start. */
type UndeclaredChange = Extract<IssuerIdentityChange, { kind: 'undeclared' }>;

/** What a start, or `<app> doctor`, finds when it compares the two. */
export type IssuerIdentityVerdict =
    /**
     * There was no previous identity to compare the file with — nothing records
     * the applied settings, or the record could not be read while the file
     * names no issuer at all. `why` says which.
     */
    | { kind: 'not-compared'; why: string }
    /** The file and the record agree, or the difference is declared. */
    | { kind: 'settled'; change: Exclude<IssuerIdentityChange, UndeclaredChange> }
    /** Another legal entity, undeclared. The start does not continue. */
    | {
          kind: 'refused';
          change: UndeclaredChange;
          /** The contracts still running, or `null` where they could not be read. */
          running: RunningContractIssuers | null;
          /** What the start dies with, and what `<app> doctor` prints. */
          refusal: string;
      };

/**
 * The comparison, and nothing else.
 *
 * Kept apart from the hook below so that asking the question costs nothing: a
 * class whose construction is also a lifecycle hook cannot be injected by
 * anything that only wants the answer.
 */
@Injectable()
export class IssuerIdentityInspector {
    private readonly logger = new Logger(IssuerIdentityInspector.name);

    /** This start's answer, settled the first time anything asks for it. */
    private verdict: Promise<IssuerIdentityVerdict> | null = null;

    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        @Inject(SETTINGS_SOURCE_TOKEN) private readonly source: string,
        @Optional()
        @Inject(APPLIED_SETTINGS_PORT_TOKEN)
        private readonly settings: AppliedSettingsPort | null = null,
        @Optional()
        @Inject(SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN)
        private readonly contracts: SubscriptionContractRepository | null = null,
    ) {}

    /**
     * What the issuer in the file is, against the identity the record holds.
     *
     * Answered once per process, and the cached answer is the point rather than
     * the saved query: `AppliedSettingsRecorder` replaces the record moments
     * later, in a bootstrap hook, so a second comparison would find the file
     * agreeing with what this very start wrote. A reader asking afterwards —
     * `<app> doctor`, a health endpoint — would then be told that nothing had
     * moved, on a start that had just carried a correction through. What this
     * start found is a fact about this start, so it is settled when the start
     * asks and does not change afterwards.
     */
    inspect(): Promise<IssuerIdentityVerdict> {
        return (this.verdict ??= this.compare());
    }

    /**
     * How many contracts are running, for a report that says what changing the
     * identity would cost. A query of its own rather than a field on the
     * verdict: a start needs this only to name the contracts in a refusal, and
     * no boot should pay for a number nobody reads. `null` where they are not
     * known.
     */
    async runningContractCount(): Promise<number | null> {
        // Nought named: the count is exact whatever the limit, and a report that
        // wants only the number should not carry a page of rows back for it.
        const running = await this.readRunning(0);
        return running.known ? running.contracts.total : null;
    }

    private async compare(): Promise<IssuerIdentityVerdict> {
        if (!this.settings) return { kind: 'not-compared', why: NOT_RECORDED };
        const recorded = await this.readRecorded();
        if (!recorded.read) return { kind: 'not-compared', why: recorded.why };
        const change = classifyIssuerChange(
            recordedIssuerIdentity(recorded.settings),
            this.catalog.issuer,
        );
        if (change.kind !== 'undeclared') return { kind: 'settled', change };
        const running = await this.readRunning();
        return {
            kind: 'refused',
            change,
            running: running.known ? running.contracts : null,
            refusal: refusalFor(change, running, this.source),
        };
    }

    /**
     * The settings of the last start, or what stopped this from reading them.
     *
     * A read that fails while the file names an issuer takes the boot down: a
     * guard that cannot see is not a guard that saw nothing, and an installation
     * that puts a legal entity on every contract it concludes should not conclude
     * one while nothing can tell whether that entity is still the recorded one.
     *
     * Where the file names no issuer, the same failure is only a warning. There
     * is then no entity to conclude a contract on behalf of, and the promise the
     * record makes — an installation whose record cannot be kept still runs the
     * right configuration — is worth more than a boot refused over a comparison
     * with nothing on one side. What that leaves uncaught is narrow and worth
     * naming: an operator who removes the issuer block while contracts run, in
     * the same start where the record cannot be read.
     */
    private async readRecorded(): Promise<
        { read: true; settings: AppliedSettingsValues | null } | { read: false; why: string }
    > {
        try {
            const record = await this.settings!.readApplied();
            return { read: true, settings: record?.settings ?? null };
        } catch (error) {
            const why = `the applied settings could not be read: ${messageOf(error)}`;
            if (this.catalog.issuer) {
                throw new Error(
                    `The issuer named in ${this.source} could not be compared with the one this ` +
                        `installation recorded, because ${why}`,
                    { cause: error },
                );
            }
            return { read: false, why };
        }
    }

    /**
     * The contracts a refusal is about. Best effort on purpose: the refusal is
     * already decided, and losing it because the list behind it could not be
     * read would replace a message an operator can act on with one they cannot.
     * Where they are not known, the message says which of the two it is —
     * "nothing here writes contracts" and "the query failed" send an operator
     * looking in different places.
     */
    private async readRunning(named: number = CONTRACTS_NAMED): Promise<KnownContracts> {
        if (!this.contracts) {
            return { known: false, why: 'This installation writes no contracts.' };
        }
        try {
            return { known: true, contracts: await this.contracts.listRunningIssuers(named) };
        } catch (error) {
            const why = `The contracts still running could not be read: ${messageOf(error)}`;
            this.logger.warn(why);
            return { known: false, why };
        }
    }

    /**
     * The line a start that continues is worth, and nothing where it is worth
     * none. Public because the hook beside this class calls it; not an offer.
     *
     * @internal
     */
    report(verdict: Exclude<IssuerIdentityVerdict, { kind: 'refused' }>): void {
        if (verdict.kind === 'not-compared') {
            // The recorder says the same thing about the record as a whole, and
            // says it once. This adds the consequence that is specific to the
            // issuer: without a previous identity, an entity swapped in the file
            // is not noticed by anything.
            this.logger.warn(
                `The issuer in the configuration is compared with nothing — ${verdict.why} — so a ` +
                    'start that names another legal entity than the last one is not refused.',
            );
            return;
        }
        const change = verdict.change;
        if (change.kind === 'first-naming') {
            this.logger.log(
                `The issuer of every contract concluded from now on is '${change.identity.legalName}'.`,
            );
            return;
        }
        if (change.kind === 'corrected') {
            this.logger.log(
                `The issuer's ${listFields(change.moved)} changed as a declared correction of the ` +
                    `same legal entity: ${change.reason}. Contracts already concluded keep the copy ` +
                    'they name; what is issued from now on carries the corrected identity.',
            );
        }
    }
}

/**
 * Refuses a start whose file names another legal entity than the record does.
 *
 * A module hook, not a bootstrap one: `AppliedSettingsRecorder` replaces the
 * record in `onApplicationBootstrap`, and Nest runs every module hook before a
 * single bootstrap hook. That is what makes the comparison see the previous
 * start's values rather than this start's own.
 */
@Injectable()
export class IssuerIdentityCheck implements OnModuleInit {
    constructor(private readonly inspector: IssuerIdentityInspector) {}

    async onModuleInit(): Promise<void> {
        const verdict = await this.inspector.inspect();
        if (verdict.kind === 'refused') throw new Error(verdict.refusal);
        this.inspector.report(verdict);
    }
}

/** The contracts still running, or why this start does not know them. */
type KnownContracts =
    { known: true; contracts: RunningContractIssuers } | { known: false; why: string };

/** The sentences a refused start dies with, and `<app> doctor` prints. */
function refusalFor(change: UndeclaredChange, running: KnownContracts, source: string): string {
    return [
        `The issuer in ${source} is not the legal entity this installation recorded.`,
        `  recorded: ${describe(change.recorded)}`,
        `  in the file: ${change.current ? describe(change.current) : 'no issuer is named at all'}`,
        faultSentence(change.fault),
        contractsSentence(running),
        'Moving a contract to another legal entity is a transfer, not an edit of a setting.',
        ...wayOut(change),
    ].join('\n');
}

/**
 * What to write, for the fault that was found.
 *
 * Two ways out, because there are two things wrong. Printing the declaration at
 * a file that names no issuer would be an instruction that leads back to the
 * same message: the declaration is not read at all there, and in the shape where
 * the block is present with a blank name the operator already has exactly the
 * declaration this would print, value for value.
 */
function wayOut(change: UndeclaredChange): string[] {
    if (change.fault.kind === 'names-no-issuer') {
        return [
            'Name the issuer again, with the identity this installation recorded — and where that ' +
                'entity has since been corrected, declare the correction beside the corrected ' +
                'values. A declaration on its own cannot help here: there is nothing in the file ' +
                'for it to be about.',
            issuerBlockFor(change.recorded),
        ];
    }
    return [
        'Where this is the same entity under a new name, or with a tax identifier that was wrong ' +
            'or missing, declare it beside the values it replaces and start again:',
        declarationFor(change.recorded, change.moved),
    ];
}

/** The recorded identity, as the block that would name it again. */
function issuerBlockFor(recorded: LegalIdentity): string {
    const named = LEGAL_IDENTITY_FIELDS.filter((field) => recorded[field] !== null);
    return [
        'issuer:',
        ...named.map((field) => `    ${field}: ${JSON.stringify(recorded[field])}`),
    ].join('\n');
}

function faultSentence(fault: IssuerCorrectionFault): string {
    switch (fault.kind) {
        case 'absent':
            return '`issuer.correctionOf` declares nothing, so nothing says this is the same entity.';
        case 'names-no-issuer':
            return (
                'The file names no issuer for a declaration to be about, so there is no entity ' +
                'here for the recorded one to be the same as.'
            );
        case 'names-another-value':
            return (
                `\`issuer.correctionOf.${fault.field}\` names ${quote(fault.declared)}, which is not ` +
                `what the record holds (${quote(fault.recorded)}). A declaration names the values it ` +
                'replaces, so one left over from a correction already applied does not cover this one.'
            );
        case 'leaves-a-field-out':
            return (
                `\`issuer.correctionOf\` says nothing about \`${fault.field}\`, which the file moves ` +
                `away from ${quote(fault.recorded)}. Every identity field that moves is named, or ` +
                'the declaration covers only half the change.'
            );
    }
}

function contractsSentence(running: KnownContracts): string {
    if (!running.known) return running.why;
    const { total, contracts } = running.contracts;
    // Not "under the recorded identity": the query asks which contracts are
    // running, not which issuer each names, and a message that claimed the
    // narrower thing would be read as one.
    if (total === 0) return 'No contract is running.';
    const rest = total - contracts.length;
    return [
        `${total} contract(s) are still running:`,
        ...contracts.map(describeContract),
        ...(rest > 0 ? [`  … and ${rest} more.`] : []),
    ].join('\n');
}

function describeContract(contract: RunningContractIssuer): string {
    const under = contract.issuerLegalName
        ? `concluded under ${quote(contract.issuerLegalName)}`
        : 'names no issuer';
    return `  ${contract.id} (tenant ${contract.tenantId}, from ${contract.effectiveFrom.toISOString().slice(0, 10)}, ${under})`;
}

/**
 * The block to paste, carrying the values the record holds for what moved.
 *
 * Every value is quoted, and by `JSON.stringify` rather than by hand: a legal
 * name holding `: ` or `#` is ordinary, and unquoted it would make the one block
 * in this message that has to parse the one that does not. YAML reads a
 * JSON-quoted scalar, escapes and all.
 */
function declarationFor(recorded: LegalIdentity, moved: readonly LegalIdentityField[]): string {
    const lines = moved.map(
        (field) =>
            `        ${field}: ${recorded[field] === null ? 'null' : JSON.stringify(recorded[field])}`,
    );
    return [
        'issuer:',
        '    correctionOf:',
        ...lines,
        '        reason: <why the same entity now reads differently>',
    ].join('\n');
}

function describe(identity: LegalIdentity): string {
    return (
        `${quote(identity.legalName)} (VAT id ${quote(identity.vatId)}, ` +
        `tax number ${quote(identity.taxNumber)})`
    );
}

function listFields(fields: readonly LegalIdentityField[]): string {
    return fields.map((field) => `\`${field}\``).join(', ');
}

function quote(value: string | null): string {
    return value === null ? 'none' : `'${value}'`;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
