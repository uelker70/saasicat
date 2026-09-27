import { Inject, Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';

import { ContractRefreshCliFlow, type RefreshOptions } from './contract-refresh-cli-flow.js';
import { OperatorCommand } from './operator-command.js';

// Shared `<app> contracts …` commands. Binds `ContractRefreshCliFlow` to the
// nest-commander CLI; register these classes in the providers of the CLI
// module of an application that freezes contracts (`contractFreeze` in its
// tenant billing), beside `ContractRefreshCliFlow`.

interface RefreshFlags extends RefreshOptions {
    output?: string;
}

@Injectable()
@SubCommand({
    name: 'refresh',
    description:
        'Carry a changed feature vocabulary into contracts in force; shows first, writes with --apply',
})
export class ContractsRefreshCommand extends OperatorCommand<RefreshFlags> {
    constructor(@Inject(ContractRefreshCliFlow) private readonly flow: ContractRefreshCliFlow) {
        super();
    }

    async run(_args: string[], flags: RefreshFlags): Promise<void> {
        if (!flags.apply) {
            this.print(flags, await this.flow.preview(flags), false);
            return;
        }
        const outcomes = await this.flow.apply(flags);
        this.print(flags, outcomes, true);
        process.exitCode = this.flow.exitCodeOf(outcomes);
    }

    private print(
        flags: RefreshFlags,
        results: Parameters<ContractRefreshCliFlow['format']>[0],
        applied: boolean,
    ): void {
        process.stdout.write(
            (flags.output === 'json'
                ? JSON.stringify(results, null, 2)
                : this.flow.format(results, applied)) + '\n',
        );
    }

    @Option({
        flags: '--contract <id>',
        description: 'a contract to look at; repeat for several',
    })
    parseContract(value: string, previous: string[] = []): string[] {
        return [...previous, value];
    }
    @Option({ flags: '--all', description: 'every contract in force' })
    parseAll(): boolean {
        return true;
    }
    @Option({
        flags: '--full',
        description: 're-freeze as a plan change would; refuses where the money would change',
    })
    parseFull(): boolean {
        return true;
    }
    @Option({
        flags: '--apply',
        description: 'write the successors; without it nothing is written',
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
    name: 'contracts',
    description: 'Contracts in force: refresh',
    subCommands: [ContractsRefreshCommand],
})
export class ContractsCommands extends CommandRunner {
    async run(): Promise<void> {
        process.stderr.write('Specify a sub-command: refresh.\n');
        process.exit(2);
    }
}
