# migrations before/after hooks.

**THESE HOOKS ONLY RUN UNDER CI, NEVER UNDER** `tapdev`**!**

## hooks :
* `tapestry:before:migrations`
* `tapestry:after:migrations`

These happen before/after the tapestry CI do-migrations step.  This step happens immediately after deploy and these hooks share env vars with the do-migrations step, see [docs/npm-run-scripts/migration-runners](../npm-run-scripts/migration-runners.md) for more info.

## env vars :

* **TAPESTRY_MIGRATIONS_DEPLOY_CREDS** (also aliased as **TAPESTRY_HOOK_MIGRATIONS_DEPLOY_CREDS**)
* **TAPESTRY_MIGRATIONS_DEPLOY_ENV_NAME** (also aliased as **TAPESTRY_HOOK_MIGRATIONS_DEPLOY_ENV_NAME**)
