// Whether this process is an operator's command line rather than the
// application.
//
// Both start the same platform from the same options, and most of what a start
// refuses is refused for both alike. A disagreement in the data is different
// where its repair is a command: the application must not run on it, and the
// command line is where the operator names and repairs it. A start check whose
// remedy is a command reads this declaration and leaves the refusal to the
// documents the command line would issue.
//
// Declared, not guessed: a worker started without an HTTP server issues
// invoices as the application does, so the shape of the process says nothing.

import { Global, Module } from '@nestjs/common';

/**
 * Bound to `true` in an operator's command line, and nowhere else.
 * `CliContextModule` from `@saasicat/cli` imports the module below, so a
 * command line built from it declares itself.
 */
export const OPERATOR_COMMAND_LINE_TOKEN = Symbol.for('saasicat/nest/OperatorCommandLine');

/**
 * Declares the process an operator's command line to every module of it: global,
 * because the start checks that read the declaration live in the platform's
 * modules, which the command line's own module does not reach.
 */
@Global()
@Module({
    providers: [{ provide: OPERATOR_COMMAND_LINE_TOKEN, useValue: true }],
    exports: [OPERATOR_COMMAND_LINE_TOKEN],
})
export class OperatorCommandLineModule {}
