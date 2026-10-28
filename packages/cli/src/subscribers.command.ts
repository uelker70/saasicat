import { Inject, Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';

import { OperatorCommand } from './operator-command.js';
import { SubscriberJoinCliFlow, type SubscriberJoinOptions } from './subscriber-join-cli-flow.js';

// Shared `<app> subscribers …` commands. Binds `SubscriberJoinCliFlow` to the
// nest-commander CLI; register these classes in the providers of the CLI module
// of an application whose persistence keeps joins (`SubscriberJoin`), beside
// the flow.

interface JoinFlags extends SubscriberJoinOptions {
    output?: string;
}

@Injectable()
@SubCommand({
    name: 'join',
    description:
        "Join a returning customer's new subscriber into the one it had; shows first, writes with --apply",
})
export class SubscribersJoinCommand extends OperatorCommand<JoinFlags> {
    constructor(@Inject(SubscriberJoinCliFlow) private readonly flow: SubscriberJoinCliFlow) {
        super();
    }

    async run(_args: string[], flags: JoinFlags): Promise<void> {
        if (!flags.apply) {
            const decision = await this.flow.preview(flags);
            this.print(flags, decision, () => this.flow.formatPreview(decision));
            return;
        }
        const joined = await this.flow.apply(flags);
        this.print(flags, joined, () => this.flow.formatJoined(joined));
    }

    private print(flags: JoinFlags, result: unknown, table: () => string): void {
        process.stdout.write(
            (flags.output === 'json' ? JSON.stringify(result, null, 2) : table()) + '\n',
        );
    }

    @Option({
        flags: '--from <customer number>',
        description: 'the subscriber with the live tenant, which sign-up created',
    })
    parseFrom(value: string): string {
        return value;
    }
    @Option({
        flags: '--into <customer number>',
        description: 'the earlier subscriber of the same legal entity, whose tenant is gone',
    })
    parseInto(value: string): string {
        return value;
    }
    @Option({ flags: '--reason <text>', description: 'why they are joined; the record keeps it' })
    parseReason(value: string): string {
        return value;
    }
    @Option({
        flags: '--apply',
        description:
            'join them, declaring both one legal entity, with the second factor; without it nothing is written',
    })
    parseApply(): boolean {
        return true;
    }
    @Option({ flags: '-o, --output <format>', description: 'table (default) or json' })
    parseOutput(v: string): string {
        return v;
    }
}

@Injectable()
@Command({
    name: 'subscribers',
    description: 'Subscribers: join',
    subCommands: [SubscribersJoinCommand],
})
export class SubscribersCommands extends CommandRunner {
    async run(): Promise<void> {
        process.stderr.write('Specify a sub-command: join.\n');
        process.exit(2);
    }
}
