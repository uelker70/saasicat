# saasicat

## What this is

**SaaSiCat** connects code-declared capabilities to discovery, commercial
packages, customer contracts and runtime enforcement in NestJS applications.
It also includes the SuperAdmin, audit, MFA and billing lifecycle building
blocks needed to operate that flow.

This package is a **pointer** — it reserves the unscoped name and contains no
code. The framework lives in the `@saasicat` scope. You probably want one of:

| You want to…                         | Install                                                               |
| ------------------------------------ | --------------------------------------------------------------------- |
| Add the platform to a NestJS backend | `npm install @saasicat/nest`                                          |
| Scaffold a SuperAdmin app            | `npm create saasicat-admin`                                           |
| Use the SuperAdmin Vue 3 components  | `npm install @saasicat/ui-vue`                                        |
| Use the CLI                          | `npm install -D @saasicat/cli`                                        |
| Persist with Prisma / Drizzle        | `npm install @saasicat/adapter-prisma` or `@saasicat/adapter-drizzle` |
| Types and JSON Schemas only          | `npm install @saasicat/core` / `@saasicat/spec`                       |

Documentation and source: <https://github.com/uelker70/saasicat>

## What this is not

Not the framework. This package contains no code at all — it reserves the
unscoped name so that `npm install saasicat` lands somewhere that can tell you
what you actually want.

Not deprecated either: the table below stays current, and the packages it
points at are released in lockstep with it.

## Next

- [Quickstart](https://github.com/uelker70/saasicat/blob/main/docs/quickstart.md)
- [Documentation](https://github.com/uelker70/saasicat/blob/main/docs/README.md)
