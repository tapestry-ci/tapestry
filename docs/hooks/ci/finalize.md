# finalizer before/after hooks.

**THESE HOOKS ONLY RUN UNDER CI, NEVER UNDER** `tapdev`**!**

## hooks :
* `tapestry:before:migrations`
* `tapestry:after:migrations`

These happen before/after the tapestry CI finalize step.  This step happens **ABSOLUTELY LAST**, on **ANY** CI run. These hooks share env vars with the finalizers themselves. see [docs/npm-run-scripts/finalizers](../npm-run-scripts/finalizers.md) for more info.

## env vars :

* **TAPESTRY_FINALIZE_BUILD_MODE** (alaso aliased as **TAPESTRY_HOOK_FINALIZE_BUILD_MODE**): The CI Build-mode for this CI run. Will be `full-deploy` or `test-only`.
* **TAPESTRY_FINALIZE_BUILD_INFO_JSON** (alaso aliased as **TAPESTRY_HOOK_FINALIZE_BUILD_INFO_JSON**): The CI BuildInfo object as a JSON string. This is all of the data parsed from the tapestry buildStr field and is part of the initial data passed to the CI.
* **TAPESTRY_FINALIZE_BUILD_STATUS_JSON** (alaso aliased as **TAPESTRY_HOOK_FINALIZE_BUILD_STATUS_JSON**): The CI BuildStatus object as a JSON string. This is the full internal CI status object from tapestry's internal mongodb database. This includes all of the info from above, as well as
* **TAPESTRY_FINALIZE_DEPLOY_ENV_NAME** (also aliased as **TAPESTRY_HOOK_FINALIZE_DEPLOY_ENV_NAME**): the env name deployed to. in test-only builds this will be `none` (though in the future `none` will be changed to `local`)
* **TAPESTRY_FINALIZE_DEPLOY_CREDS** (also aliased as **TAPESTRY_HOOK_FINALIZE_DEPLOY_CREDS**): json string containing {secret,access,region} keys. credentials that were used to deploy to the env.
