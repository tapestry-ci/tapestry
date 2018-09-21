# Tapestry npm-run-scripts for successful ci run

After every successful CI run, whether in test-only or full-deploy mode, Tapestry allows you to define any `finalize` actions you wish. This step is entirely defined for custom usage, and has no built-in effects.

This step runs **ONLY** on successful ci run. If any part of the CI fails, finalize will not be run.

The priority order for these is:  `tapestry:finalize`, `finalize:all`, `finalize`. For each package.json in your monorepo, the first matching script from this list will be chosen.

Environment variables:

* **TAPESTRY_FINALIZE_BUILD_MODE** (alaso aliased as **TAPESTRY_HOOK_FINALIZE_BUILD_MODE**): The CI Build-mode for this CI run. Will be `full-deploy` or `test-only`.
* **TAPESTRY_FINALIZE_BUILD_INFO_JSON** (alaso aliased as **TAPESTRY_HOOK_FINALIZE_BUILD_INFO_JSON**): The CI BuildInfo object as a JSON string. This is all of the data parsed from the tapestry buildStr field and is part of the initial data passed to the CI.
* **TAPESTRY_FINALIZE_BUILD_STATUS_JSON** (alaso aliased as **TAPESTRY_HOOK_FINALIZE_BUILD_STATUS_JSON**): The CI BuildStatus object as a JSON string. This is the full internal CI status object from tapestry's internal mongodb database. This includes all of the info from above, as well as

* **TAPESTRY_FINALIZE_DEPLOY_ENV_NAME** (also aliased as **TAPESTRY_HOOK_FINALIZE_DEPLOY_ENV_NAME**): the env name deployed to. in test-only builds this will be `none` (though in the future `none` will be changed to `local`)
* **TAPESTRY_FINALIZE_DEPLOY_CREDS** (also aliased as **TAPESTRY_HOOK_FINALIZE_DEPLOY_CREDS**): json string containing {secret,access,region} keys. credentials that were used to deploy to the env.

As with migrations and health-check, these variables are provided to both the finalizer and to the before/after hooks in both `TAPESTRY_` and `TAPESTRY_HOOK_` prefixed forms. This is so that the finalizers can share code with their hooks.

Should any finalize step fail, the state of the CI build will be a failure and will be reported as a build failure to tapestry's error channels. Tapestry's finalizer phase will *NEVER* run if any other step failed.

See [docs/npm-run-scripts](../npm-run-scripts.md) for general info on run scripts.
