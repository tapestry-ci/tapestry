# Tapestry npm-run-scripts for testing your code

These are what happens when you run `tapdev test`, or when the CI's run-tests step executes.

The priority order for these is:  `tapestry:test`, `test:all`, `instrument`, `test`. For each package.json in your monorepo, the first matching script from this list will be chosen.

If any test-runner fails, CI will abort and report failure. test-runners are **never** required.

`instrument` mainly exists for historical reasons and probably should be removed at some point.

See [docs/npm-run-scripts](../npm-run-scripts.md) for general info on run scripts.
