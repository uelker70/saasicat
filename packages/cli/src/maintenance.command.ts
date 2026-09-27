import { Inject, Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';

import {
    type AnnounceOptions,
    type LockOptions,
    MaintenanceCliFlow,
    type MaintenanceCommandOptions,
    type RescheduleOptions,
} from './maintenance-cli-flow.js';

// Shared `<app> maintenance …` commands. Binds `MaintenanceCliFlow` to the
// nest-commander CLI; register these classes in the providers of the CLI
// module of an application that turns `maintenance` on in
// `SaaSiCatModule.forRoot`, beside `MaintenanceCliFlow`.

interface StatusFlags {
    output?: string;
}

/** The options every writing sub-command shares. */
abstract class WritingCommand<T extends MaintenanceCommandOptions> extends CommandRunner {
    abstract run(args: string[], flags: T): Promise<void>;

    @Option({ flags: '--as <email>', description: 'act as this operator' })
    parseAs(v: string): string {
        return v;
    }
    @Option({ flags: '-y, --yes', description: 'confirm against production without asking' })
    parseYes(): boolean {
        return true;
    }
}

@Injectable()
@SubCommand({ name: 'status', description: 'The open maintenance window, if any' })
export class MaintenanceStatusCommand extends CommandRunner {
    constructor(@Inject(MaintenanceCliFlow) private readonly flow: MaintenanceCliFlow) {
        super();
    }
    async run(_args: string[], flags: StatusFlags): Promise<void> {
        const overview = await this.flow.status();
        process.stdout.write(
            (flags.output === 'json'
                ? JSON.stringify(overview, null, 2)
                : this.flow.formatOverview(overview)) + '\n',
        );
    }
    @Option({ flags: '-o, --output <format>', description: 'table (default) or json' })
    parseOutput(v: string): string {
        return v;
    }
}

@Injectable()
@SubCommand({ name: 'announce', description: 'Announce a maintenance window to the tenants' })
export class MaintenanceAnnounceCommand extends WritingCommand<AnnounceOptions> {
    constructor(@Inject(MaintenanceCliFlow) private readonly flow: MaintenanceCliFlow) {
        super();
    }
    async run(_args: string[], flags: AnnounceOptions): Promise<void> {
        const window = await this.flow.announce(flags);
        process.stdout.write(
            `Announced: ${window.startsAt?.toISOString()} to ${window.endsAt?.toISOString()}.\n`,
        );
    }
    @Option({ flags: '--starts <time>', description: 'start, with its zone' })
    parseStarts(v: string): string {
        return v;
    }
    @Option({ flags: '--ends <time>', description: 'expected end, with its zone' })
    parseEnds(v: string): string {
        return v;
    }
    @Option({ flags: '--message <text>', description: 'shown to the tenants as written' })
    parseMessage(v: string): string {
        return v;
    }
}

@Injectable()
@SubCommand({ name: 'reschedule', description: 'Move the open window, or change its message' })
export class MaintenanceRescheduleCommand extends WritingCommand<RescheduleOptions> {
    constructor(@Inject(MaintenanceCliFlow) private readonly flow: MaintenanceCliFlow) {
        super();
    }
    async run(_args: string[], flags: RescheduleOptions): Promise<void> {
        const window = await this.flow.reschedule(flags);
        process.stdout.write(
            `Now ${window.startsAt?.toISOString() ?? 'locked'} to ${window.endsAt?.toISOString() ?? 'no end stated'}.\n`,
        );
    }
    @Option({ flags: '--starts <time>', description: 'new start, with its zone' })
    parseStarts(v: string): string {
        return v;
    }
    @Option({ flags: '--ends <time>', description: 'new expected end, with its zone' })
    parseEnds(v: string): string {
        return v;
    }
    @Option({ flags: '--message <text>', description: 'new message' })
    parseMessage(v: string): string {
        return v;
    }
}

@Injectable()
@SubCommand({ name: 'cancel', description: 'Call off the announced window' })
export class MaintenanceCancelCommand extends WritingCommand<MaintenanceCommandOptions> {
    constructor(@Inject(MaintenanceCliFlow) private readonly flow: MaintenanceCliFlow) {
        super();
    }
    async run(_args: string[], flags: MaintenanceCommandOptions): Promise<void> {
        await this.flow.cancel(flags);
        process.stdout.write('The announced window is cancelled.\n');
    }
}

@Injectable()
@SubCommand({
    name: 'on',
    description: 'Lock tenants out; returns once every process has seen the lock',
})
export class MaintenanceOnCommand extends WritingCommand<LockOptions> {
    constructor(@Inject(MaintenanceCliFlow) private readonly flow: MaintenanceCliFlow) {
        super();
    }
    async run(_args: string[], flags: LockOptions): Promise<void> {
        const outcome = await this.flow.on(flags);
        process.stdout.write(
            (outcome.alreadyLocked ? 'Already locked' : 'Locked') +
                ` since ${outcome.window.lockedAt?.toISOString()}; ` +
                `waited ${Math.ceil(outcome.waitedMs / 1000)} s for every process to see it.\n`,
        );
    }
    @Option({ flags: '--until <time>', description: 'expected end, with its zone' })
    parseUntil(v: string): string {
        return v;
    }
    @Option({ flags: '--message <text>', description: 'shown to the tenants as written' })
    parseMessage(v: string): string {
        return v;
    }
    @Option({
        flags: '--drain <seconds>',
        description: 'grace for requests already under way (default 10)',
    })
    parseDrain(v: string): number {
        return Number(v);
    }
}

@Injectable()
@SubCommand({ name: 'off', description: 'Let tenants back in' })
export class MaintenanceOffCommand extends WritingCommand<MaintenanceCommandOptions> {
    constructor(@Inject(MaintenanceCliFlow) private readonly flow: MaintenanceCliFlow) {
        super();
    }
    async run(_args: string[], flags: MaintenanceCommandOptions): Promise<void> {
        const outcome = await this.flow.off(flags);
        process.stdout.write(
            outcome.wasLocked ? 'Unlocked; tenants are back.\n' : 'Nothing was locked.\n',
        );
    }
}

@Injectable()
@Command({
    name: 'maintenance',
    description: 'Maintenance windows: status, announce, reschedule, cancel, on, off',
    subCommands: [
        MaintenanceStatusCommand,
        MaintenanceAnnounceCommand,
        MaintenanceRescheduleCommand,
        MaintenanceCancelCommand,
        MaintenanceOnCommand,
        MaintenanceOffCommand,
    ],
})
export class MaintenanceCommands extends CommandRunner {
    async run(): Promise<void> {
        process.stderr.write(
            'Specify a sub-command: status, announce, reschedule, cancel, on, off.\n',
        );
        process.exit(2);
    }
}
