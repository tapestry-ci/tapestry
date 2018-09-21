# Tapestry Hook System

Tapestry defines a number of hook scripts (specially named `npm run` scripts) which are run in the context of every subpackage within your monorepo at particular points during both `tapdev` and on the CI infrastructure, specifically either **before** or **after** any particular event.

Basic hooks run under both the CI and under `tapdev` (unless otherwise noted), and all take the form of either `tapestry:before:EVENT-NAME` or `tapestry:after:EVENT-NAME`. `before` and `after` run for all events. Most of these events (with exceptions listed) run individually, before and after the operation happens on each individual package (in contrast to before-all or after-all).

CI-Lifecycle hooks, on the other hand, always run for all packages at the same time, before and after each CI `phase` and `step` is applied for any/all packages (`[ALL-BEFORE-HOOKS] -> [ALL-ACTIONS] -> [ALL-AFTER-HOOKS]`). None of these will run under `tapdev` ever. In addition, while `phase` names are set by AWS's codebuild and are unchangeable, `step` names are subject to change as tapestry-ci's operation lifecycle changes. Therefore, it is recommended you use a Basic hook or a ci-phase hook rather than a ci-step hook when possible.

For all hooks, the `after` step will only fire if the corresponding action succeeded, and the corresponding action will fail to run if its `before` hook has failed. A failure during an `after` hook will cause the CI to fail at that step.

Many of these hooks provide additional information to the hook script via environment variables. See individual hook docs for these env vars.

## Basic Hooks

| event name    | runs before/after                           | docs |
| ------------- | ------------------------------------------- | ---- |
| clean-modules | `node_modules` folders were cleaned/removed | [docs/hooks/clean-modules](./hooks/clean-modules.md) |
| any-install | any `npm install` command | [docs/hooks/install](./hooks/install.md) |
| dev-install | `npm install` without --production | [docs/hooks/install](./hooks/install.md) |
| prod-install | `npm install` with --production | [docs/hooks/install](./hooks/install.md) |
| run-tests | `tapdev test` and CI's run-tests step | [docs/hooks/run-tests](./hooks/run-tests.md) |
| run-builds | `tapdev build` and CI's run-builds step | [docs/hooks/run-builds](./hooks/run-builds.md) |
| env-vars | `tapdev env-vars` and before CI's run-builds step | [docs/hooks/env-vars](./hooks/env-vars.md) |
| build-docs | `tapdev build-docs` and after | [docs/hooks/documentation](./hooks/documentation.md) |
| upload-artifacts | while uploading artifacts as the final step of each individual CI phase **CI ONLY** | [docs/hooks/ci/upload-artifacts](./hooks/ci/upload-artifacts.md) |
| publish | before any npm package is published as part of CI's deploy phase **CI ONLY** | [docs/hooks/ci/publish](./hooks/ci/publish.md) |
| deploy | before any non-npm deployment is deployed as part of CI's deploy phase **CI ONLY** | [docs/hooks/ci/deploy](./hooks/ci/deploy.md) |
| health-check | After all successful deployments, during the CI's post-deploy health-check phase **CI ONLY** | [docs/hooks/ci/health-check](./hooks/ci/health-check.md) |
| build-docs | After all successful deployments, during the CI's post-deploy publish-docs phase **CI ONLY** | [docs/hooks/documentation](./hooks/documentation.md) |


## CI-Lifecycle Hooks

### CI Phase hooks

| phase name | phase purpose | docs |
| ---------- | ------------- | ---- |
| install | ci bootstrapping; install global packages and commands needed for system | [docs/hooks/ci/phase](./hooks/ci/phase.md) |
| prebuild | `npm install` runs everywhere | [docs/hooks/ci/phase](./hooks/ci/phase.md) |
| build | run-builds and run-tests steps | [docs/hooks/ci/phase](./hooks/ci/phase.md) |
| postbuild | cleanup only when CI in test mode, deploy/publish steps when CI in deploy mode | [docs/hooks/ci/phase](./hooks/ci/phase.md) |

### CI Step hooks

| step name | corresponding phase | ci mode | docs |
| --------- | ------------------- | ------- | ---- |
| prepare-build-root | install | any | [docs/hooks/ci/step](./hooks/ci/step.md) |
| install-globals | install | any | [docs/hooks/ci/step](./hooks/ci/step.md) |
| install-dev-dependencies | prebuild | any | [docs/hooks/ci/step](./hooks/ci/step.md) |
| run-builds | build | any | [docs/hooks/ci/step](./hooks/ci/step.md) |
| run-tests  | build | any | [docs/hooks/ci/step](./hooks/ci/step.md) |
| clean-dependencies | build | any | [docs/hooks/ci/step](./hooks/ci/step.md) |
| do-deploys | postbuild | full-deploy only | [docs/hooks/ci/step](./hooks/ci/step.md) |
