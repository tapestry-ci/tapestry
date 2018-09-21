# Tapestry npm-run-scripts for compiling/transpiling/preparing code/assets

These are what happens when you run `tapdev build`, or when the CI's run-builds step executes.

In addition, the `build` step is always run **immediately after** any install which includes dev-dependencies, so that `package-B` can depend on the compiled state of `package-A` and expect it to exist in both CI and local-dev.

The priority order for these is:  `tapestry:build`, `build:all`, `build`. For each package.json in your monorepo, the first matching script from this list will be chosen.

If any build-runner fails, CI will abort and report failure. build-runners are **never** required.

See [docs/npm-run-scripts](../npm-run-scripts.md) for general info on run scripts.
