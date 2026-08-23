# SaaSiCat documentation

Four kinds of page, because four different questions bring you here. Read the
one that matches the question you have — they are written to be entered
directly, not in order.

| You want to…                           | Go to          |
| -------------------------------------- | -------------- |
| get something running, following along | `tutorial/`    |
| solve one task in your own app         | `guides/`      |
| look up a name, an option, a code      | `reference/`   |
| understand why it is built this way    | `explanation/` |

In a hurry: the [quickstart](quickstart.md) is the shortest path from an
existing NestJS backend to a discovered, packaged and enforced feature.

## Guides

| Guide                                                                      | When                                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Wire the backend](guides/wire-the-backend.md)                             | Adding the platform modules to your NestJS app.                       |
| [Build the admin frontend](guides/build-the-admin-frontend.md)             | Adding the SuperAdmin UI, or understanding what the scaffolder wrote. |
| [Integrate into an existing app](guides/integrate-into-an-existing-app.md) | Your app already wired the fine-grained modules by hand.              |
| [Extend your CLI](guides/extend-your-cli.md)                               | Adding platform commands to your own CLI.                             |
| [Mount behind Express](guides/mount-behind-express.md)                     | Your HTTP stack is Express, with or without Nest.                     |
| [Self-registration](guides/self-registration.md)                           | Letting customers sign themselves up.                                 |
| [Verify your integration](guides/verify-your-integration.md)               | You think you are done.                                               |
| [Troubleshooting](guides/troubleshooting.md)                               | Something is wrong and the message is not obvious.                    |
| [Upgrade to 1.0](guides/upgrade-to-1.0.md)                                 | Coming from a 0.x release.                                            |

## Reference

| Page                                   | Contents                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------- |
| [Module options](reference/options.md) | Every `defineSaaSiCat` option, generated from the rules the code enforces. |

The OpenAPI contract for the SuperAdmin API is
`packages/spec/admin-api.openapi.yaml`; the JSON Schemas that govern wire
formats are next to it in `packages/spec/schemas/`. Both are normative: where
code and spec disagree, the spec is the contract and the code is the current
implementation status.

## Explanation

| Page                                                                   | Question it answers                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| [The vocabulary](explanation/concepts.md)                              | What is a capability, a feature, a quota?                  |
| [From capability to contract](explanation/capability-to-contract.md)   | How does a decorator become something a customer buys?     |
| [Architecture](explanation/architecture.md)                            | Which package does what, and in which order?               |
| [Data model](explanation/data-model.md)                                | Which tables and constraints, and who owns them?           |
| [Design guide](explanation/design-guide.md)                            | Why do the admin pages look alike?                         |
| [Test coverage](explanation/test-coverage.md)                          | What is tested, and what is not?                           |
| [Decisions (ADRs)](explanation/adr/0001-source-available-licensing.md) | Why was it built this way, and what breaks if you undo it? |

## What `status: normative` means

Most pages here are prose: they explain, and the code decides. A page whose
front matter says `status: normative` is the other way round — it is the
contract, and an implementation that disagrees with it is wrong.
[The data model](explanation/data-model.md) is one, and the spec package is the
other.
