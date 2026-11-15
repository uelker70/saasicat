import { Inject, Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';

import { InstallationCliFlow, type InstallationMarkOptions } from './installation-cli-flow.js';
import { OperatorCommand } from './operator-command.js';

// Shared `<app> installation …` commands. Binds `InstallationCliFlow` to the
// nest-commander CLI; register these classes in the providers of the CLI module
// of an application that keeps the ends of subscriptions
// (`tenantBilling.subscriptionEnds`), beside the flow.

interface StatusFlags {
    output?: string;
}

@Injectable()
@SubCommand({
    name: 'status',
    description: 'Whether this database is marked as the installation of this environment',
})
export class InstallationStatusCommand extends CommandRunner {
    constructor(@Inject(InstallationCliFlow) private readonly flow: InstallationCliFlow) {
        super();
    }
    async run(_args: string[], flags: StatusFlags): Promise<void> {
        const verdict = await this.flow.status();
        process.stdout.write(
            (flags.output === 'json'
                ? JSON.stringify(verdict, null, 2)
                : this.flow.formatStatus(verdict)) + '\n',
        );
    }
    @Option({ flags: '-o, --output <format>', description: 'table (default) or json' })
    parseOutput(v: string): string {
        return v;
    }
}

@Injectable()
@SubCommand({
    name: 'mark',
    arguments: '<identifier>',
    description:
        "Mark this database as this environment's installation, with the second factor; deletions run only in a marked one",
})
export class InstallationMarkCommand extends OperatorCommand<InstallationMarkOptions> {
    constructor(@Inject(InstallationCliFlow) private readonly flow: InstallationCliFlow) {
        super();
    }
    async run(args: string[], flags: InstallationMarkOptions): Promise<void> {
        const outcome = await this.flow.mark(args[0] ?? '', flags);
        process.stdout.write(this.flow.formatOutcome(outcome) + '\n');
    }
    @Option({
        flags: '--replace',
        description:
            "replace another installation's mark, as after restoring a backup into this environment",
    })
    parseReplace(): boolean {
        return true;
    }
}

@Injectable()
@Command({
    name: 'installation',
    description: 'The installation this database belongs to: status, mark',
    subCommands: [InstallationStatusCommand, InstallationMarkCommand],
})
export class InstallationCommands extends CommandRunner {
    async run(): Promise<void> {
        process.stderr.write('Specify a sub-command: status, mark.\n');
        process.exit(2);
    }
}
