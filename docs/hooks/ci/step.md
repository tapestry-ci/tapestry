# CI-Lifecycle hooks: Individual Tapestry-CI Steps

**THESE HOOKS ONLY RUN UNDER CI, NEVER UNDER** `tapdev`**!**

## WARNING ABOUT `ci:step` HOOKS

**THESE HOOKS ARE SUBJECT TO CHANGE AS** `tapestry-ci`**'S INTERNALS CHANGE, WITHOUT NOTICE**. They have a 1:1 correspondence with tapestry-ci's internal build steps, and these are not considered public API. Therefore it is recommended that you should first try to solve your problem using either basic hooks or ci:phase hooks, and only use these as a last resort, and only if you're willing to randomly have to fix something after an upgrade of tapestry-ci-tools in the future.

## hooks:

#### codebuild `install` phase:
* `tapestry:before:ci:step:prepare-build-root`
* `tapestry:after:ci:step:prepare-build-root`
* `tapestry:before:ci:step:install-globals`
* `tapestry:after:ci:step:install-globals`

#### codebuild `prebuild` phase
* `tapestry:before:ci:step:install-dev-dependencies` -- note that there is no corresponding install-prod-dependencies; this is not a specific build step as it varies in behavior per deployment type
* `tapestry:after:ci:step:install-dev-dependencies`

#### codebuild `build` phase
* `tapestry:before:ci:step:run-builds`
* `tapestry:after:ci:step:run-builds`
* `tapestry:before:ci:step:run-tests`
* `tapestry:after:ci:step:run-tests`

#### codebuild `postbuild` phase
* `tapestry:before:ci:step:stash-dev-dependencies` *(never runs in test-only builds)*
* `tapestry:after:ci:step:stash-dev-dependencies` *(never runs in test-only builds)*
* `tapestry:before:ci:step:do-deploys` *(never runs in test-only builds)*
* `tapestry:after:ci:step:do-deploys` *(never runs in test-only builds)*
* `tapestry:before:ci:step:restore-dev-dependencies` *(never runs in test-only builds)*
* `tapestry:after:ci:step:restore-dev-dependencies` *(never runs in test-only builds)*
* `tapestry:before:ci:step:do-migrations` *(never runs in test-only builds)*
* `tapestry:after:ci:step:do-migrations` *(never runs in test-only builds)*
* `tapestry:before:ci:step:health-check` *(never runs in test-only builds)*
* `tapestry:after:ci:step:health-check` *(never runs in test-only builds)*
* `tapestry:before:ci:step:finalize`
* `tapestry:after:ci:step:finalize`

These run for each build step within tapestry-ci, which correspond to the individual pieces of tapestry-ci's workflow. Similarly to `ci:phase` hooks,
1. ALL before hooks for this event run for all packages.
2. ALL of the regular work involved in this event happens.
3. ALL after hooks for this event run for all packages.

This is in contrast to the "basic" hooks, which instead run `before -> work -> after` for each individual package as the work is done, regardless of the state of any other package.

## env-vars:

There are none defined specifically for hooks, but since these all run under the CI you have access to all the variables that are defined in any given tapestry build. The best reference for these is to view the output of `tapdev ci show [id]` for any recent build! It is not recommended that you use these env vars outside of ci:phase or ci:step hooks, and use them within these hooks only with caution.
