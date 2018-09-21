# Special `npm run` scripts used by Tapestry

In addition to the npm run scripts processed by the hooks engine (see [docs/hooks](./hooks.md)),
Tapestry defines custom run-scripts for a few of its operations.

There are currently **three** special run-script types. For each type, there are multiple candidates
for the particular run-script to use for each step. During each of these phases, every package.json will
be scanned, and **THE FIRST MATCHING RUN-SCRIPT ONLY** (in the order listed below) will be run:

| type                  | script candidates                                           | runs under | docs                                                                               |
| --------------------- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| **test-runners**      | `tapestry:test`, `test:all`, `instrument`, `test`           | tapdev, ci | [docs/npm-run-scripts/test-runners](./npm-run-scripts/test-runners.md)            |
| **docs-builders**     | `tapestry:build-docs`, `build-docs:all`, `build-docs`       | tapdev, ci | [docs/npm-run-scripts/documentation](./npm-run-scripts/documentation.md)          |
| **build-runners**     | `tapestry:build`, `build:all`, `build`                      | tapdev, ci | [docs/npm-run-scripts/build-runners](./npm-run-scripts/build-runners.md)          |
| **migration-runners** | `tapestry:migrate`, `migrate:all`, `migrate`                | ci only    | [docs/npm-run-scripts/migration-runners](./npm-run-scripts/migration-runners.md)  |
| **health-checkers**   | `tapestry:health-check`, `health-check:all`, `health-check` | ci only    | [docs/npm-run-scripts/health-checkers](./npm-run-scripts/health-checkers.md)      |
| **docs-publishers**   | `tapestry:publish-docs`, `publish-docs:all`, `publish-docs` | ci only    | [docs/npm-run-scripts/documentation](./npm-run-scripts/documentation.md)          |
| **finalizers**        | `tapestry:finalize`, `finalize:all`, `finalize`             | ci only    | [docs/npm-run-scripts/migration-runners](./npm-run-scripts/migration-runners.md)  |

## Why the priority options?

These priority lists have the following motivations:

First, this makes it easy for the "umbrella" (monorepo root) `package.json` to define `npm run test` as `tapdev test`, and have any umbrella-level tests run under `npm run tapestry:test`, allowing `npm run test` in the root of the monorepo to trigger tapestry tests across the entire repo.

Secondly, the `:all` form is meant so that a theoretical package could have something resembling `npm run build:metadata`, `npm run build:client-js`, `npm run build:client-css`, and have `npm run build:all` be a script that runs the other three. In this case, `build:all` may feel like a cleaner name than just `build` as it documents that it's a step comprised of other steps, so `build:all` is provided as an alias.

Thirdly, just plain flexibility: neither the first or second point here has any rules in tapestry specifying how they are used, so with 3+ options for each mode, you've got a lot of wiggle room to insert tapestry into a pre-existing monorepo without having to disrupt too much of your own existing workflow in ways i may not have thought of.
