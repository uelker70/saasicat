#!/usr/bin/env node
import 'reflect-metadata';
import { CliError } from '@saasicat/cli';
import { CommandFactory } from 'nest-commander';

import { CliModule } from './cli.module';

// `notesapp <command>` — see the CLI section of the README. The exit code is
// the one the refusal carries (`packages/spec/cli-conventions.md`, §6), and 99
// for anything that is not a refusal.
const INTERNAL_ERROR_EXIT_CODE = 99;

async function bootstrap(): Promise<void> {
    await CommandFactory.run(CliModule, {
        logger: ['error', 'warn'],
        serviceErrorHandler: (error: Error) => {
            process.stderr.write(`✖ ${error.message}\n`);
            process.exit(error instanceof CliError ? error.exitCode : INTERNAL_ERROR_EXIT_CODE);
        },
    });
}

void bootstrap();
