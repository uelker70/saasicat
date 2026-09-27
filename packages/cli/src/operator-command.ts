import { CommandRunner, Option } from 'nest-commander';

/**
 * The options every command that acts as an operator shares: whom it acts as,
 * and the confirmation production asks for. Kept out of the package's exports —
 * the platform's command families extend it, and an application's own commands
 * declare their options themselves.
 */
export abstract class OperatorCommand<
    T extends { as?: string; yes?: boolean },
> extends CommandRunner {
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
