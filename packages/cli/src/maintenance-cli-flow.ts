// MaintenanceCliFlow — `<app> maintenance status|announce|reschedule|cancel|on|off`.
//
// The command a deploy script runs around its migrations:
//
//     <app> maintenance on --until 2026-10-02T23:00+02:00 --yes
//     <migrate>, start the new version, wait for its health check
//     <app> maintenance off --yes
//
// No second factor, unlike the administration's buttons: a deploy script has
// nobody to type a code (`SC-ADM-029`). What it does ask for is an operator's
// identity — the environment variable the application names, or `--as` — and,
// against production, the confirmation a script gives with `--yes`. The
// service records every action in the audit log; this flow adds nothing there.
//
// `on` returns only once every process of the application has had time to see
// the lock, plus a grace for requests already under way, so that the next line
// of the script — the migration — runs alone (`SC-OPS-015`).

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
    type AdminActor,
    MAINTENANCE_STATE_MAX_AGE_SECONDS,
    type MaintenanceOverview,
    type MaintenanceWindowRecord,
    parseZonedInstant,
} from '@saasicat/core';
import { MaintenanceService } from '@saasicat/nest';

import { CliContextService, CliError } from './cli-context.service.js';

/**
 * How long `on` waits, by default, for requests that passed before the lock to
 * finish. A request still writing when the migration starts is what the lock
 * exists to prevent; one that runs longer than this is the application's to
 * name with `--drain`.
 */
export const DEFAULT_DRAIN_SECONDS = 10;

/** Exit codes per `cli-conventions.md` §6. */
const EXIT_USER_ERROR = 1;
const EXIT_CONFLICT = 6;

/** What every writing command is given. */
export interface MaintenanceCommandOptions {
    as?: string;
    yes?: boolean;
}

export interface AnnounceOptions extends MaintenanceCommandOptions {
    starts?: string;
    ends?: string;
    message?: string;
}

export interface RescheduleOptions extends MaintenanceCommandOptions {
    starts?: string;
    ends?: string;
    message?: string;
}

export interface LockOptions extends MaintenanceCommandOptions {
    until?: string;
    message?: string;
    /** Seconds to wait for requests under way; `DEFAULT_DRAIN_SECONDS` when left out. */
    drain?: number;
}

@Injectable()
export class MaintenanceCliFlow {
    /** Replaced by a test; the real one waits. */
    sleep: (ms: number) => Promise<void> = (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    constructor(
        @Inject(CliContextService) private readonly ctx: CliContextService,
        @Inject(MaintenanceService) private readonly maintenance: MaintenanceService,
    ) {}

    /** What is open and what came before. Reads; asks for no identity. */
    status(): Promise<MaintenanceOverview> {
        return this.maintenance.overview();
    }

    async announce(options: AnnounceOptions): Promise<MaintenanceWindowRecord> {
        const startsAt = instantOf(options.starts, '--starts');
        const endsAt = instantOf(options.ends, '--ends');
        if (!startsAt || !endsAt) {
            throw new CliError(
                'MAINTENANCE_TIMES_REQUIRED',
                'An announcement needs --starts and --ends, each with its zone (2026-10-02T22:00+02:00).',
                EXIT_USER_ERROR,
            );
        }
        const actor = await this.operator(options);
        return refusalsAsCliErrors(() =>
            this.maintenance.announce({ startsAt, endsAt, message: options.message }, actor),
        );
    }

    async reschedule(options: RescheduleOptions): Promise<MaintenanceWindowRecord> {
        const startsAt = instantOf(options.starts, '--starts');
        const endsAt = instantOf(options.ends, '--ends');
        const actor = await this.operator(options);
        const id = await this.openWindowId();
        return refusalsAsCliErrors(() =>
            this.maintenance.reschedule(id, { startsAt, endsAt, message: options.message }, actor),
        );
    }

    async cancel(options: MaintenanceCommandOptions): Promise<MaintenanceWindowRecord> {
        const actor = await this.operator(options);
        const id = await this.openWindowId();
        return refusalsAsCliErrors(() => this.maintenance.cancel(id, actor));
    }

    /**
     * Locks, then waits until every process has had time to see the lock and
     * the requests it let through before have had time to finish.
     *
     * The wait starts when the lock call returns, the first moment this command
     * itself knows the lock can be read. `lockedAt` is earlier: it is taken
     * before the write commits, and a process reading in between still answers
     * "unlocked". A lock that already held is waited for the same way, because
     * its `lockedAt` shares that flaw and was written by another machine's
     * clock besides — a retried script pays the wait once more.
     */
    async on(
        options: LockOptions,
    ): Promise<{ window: MaintenanceWindowRecord; alreadyLocked: boolean; waitedMs: number }> {
        const endsAt = instantOf(options.until, '--until');
        const drain = options.drain ?? DEFAULT_DRAIN_SECONDS;
        if (!Number.isFinite(drain) || drain < 0) {
            throw new CliError(
                'MAINTENANCE_DRAIN_INVALID',
                '--drain takes a number of seconds, zero or more.',
                EXIT_USER_ERROR,
            );
        }
        const actor = await this.operator(options);
        const outcome = await refusalsAsCliErrors(() =>
            this.maintenance.lock({ endsAt, message: options.message }, actor),
        );
        const waitedMs = (MAINTENANCE_STATE_MAX_AGE_SECONDS + drain) * 1000;
        await this.sleep(waitedMs);
        return { ...outcome, waitedMs };
    }

    async off(
        options: MaintenanceCommandOptions,
    ): Promise<{ window: MaintenanceWindowRecord | null; wasLocked: boolean }> {
        const actor = await this.operator(options);
        return refusalsAsCliErrors(() => this.maintenance.unlock({}, actor));
    }

    /** One line or a few, for the terminal. */
    formatOverview(overview: MaintenanceOverview): string {
        const open = overview.open;
        if (!open) return 'No maintenance window is open.';
        const lines: string[] = [];
        if (open.status === 'locked') {
            lines.push(
                `LOCKED since ${open.lockedAt} by ${open.lockedBy}` +
                    (open.endsAt ? `, announced end ${open.endsAt}` : ', no end announced') +
                    (open.overrun ? ' — the announced end has passed.' : '.'),
            );
        } else {
            lines.push(
                `Announced for ${open.startsAt} to ${open.endsAt} by ${open.createdBy}` +
                    (open.lapsed ? ' — its end passed without a lock; cancel it.' : '.'),
            );
        }
        if (open.message) lines.push(`Message: ${open.message}`);
        return lines.join('\n');
    }

    /** The open window's id: the one a script means when it names none. */
    private async openWindowId(): Promise<string> {
        const { open } = await this.maintenance.overview();
        if (!open) {
            throw new CliError(
                'MAINTENANCE_WINDOW_NOT_OPEN',
                'No maintenance window is open.',
                EXIT_USER_ERROR,
            );
        }
        return open.id;
    }

    /** The operator this command acts as, after the confirmation production asks for. */
    private async operator(options: MaintenanceCommandOptions): Promise<AdminActor> {
        const identity = this.ctx.resolveIdentity(options.as);
        const user = await this.ctx.ensureSuperAdmin(identity);
        await this.ctx.ensureProductionConfirmation({ yes: options.yes });
        return { userId: user.id, email: identity.email, source: 'cli', context: identity.host };
    }
}

/** A time from the command line, with its zone, or refused naming the flag. */
function instantOf(value: string | undefined, flag: string): Date | undefined {
    if (value === undefined) return undefined;
    const moment = parseZonedInstant(value);
    if (!moment) {
        throw new CliError(
            'MAINTENANCE_TIME_INVALID',
            `${flag} takes a date and time with its zone, such as 2026-10-02T22:00+02:00 — got '${value}'.`,
            EXIT_USER_ERROR,
        );
    }
    return moment;
}

/**
 * The service refuses the way a route does, with a coded HTTP exception. Here
 * it becomes the exit code a script can branch on, with the service's sentence.
 */
async function refusalsAsCliErrors<T>(act: () => Promise<T>): Promise<T> {
    try {
        return await act();
    } catch (error) {
        const status = statusOf(error);
        if (status === null || status >= 500) throw error;
        const body = (error as { getResponse(): unknown }).getResponse() as {
            code?: string;
            message?: string;
        };
        throw new CliError(
            body.code ?? 'MAINTENANCE_REFUSED',
            body.message ?? String(error),
            status === HttpStatus.CONFLICT ? EXIT_CONFLICT : EXIT_USER_ERROR,
        );
    }
}

/**
 * The HTTP status of a Nest exception, read rather than tested with
 * `instanceof`: the service's `@nestjs/common` and this package's may be two
 * copies in an application's `node_modules`.
 */
function statusOf(error: unknown): number | null {
    const candidate = error as { getStatus?: unknown; getResponse?: unknown } | null;
    if (typeof candidate?.getStatus !== 'function' || typeof candidate.getResponse !== 'function') {
        return null;
    }
    const status: unknown = candidate.getStatus();
    return typeof status === 'number' ? status : null;
}
