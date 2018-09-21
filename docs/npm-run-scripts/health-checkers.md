# Tapestry npm-run-scripts for post-deploy health/sanity checks and integration testing

After every successful deploy of **ALL** packages that require deployment, tapestry allows you to run post-deploy health and sanity checks as well as end-to-end integration tests.

These checks will **NEVER** run if any package failed to deploy, or if the CI failed prior to deploy, or if any migration-runner has failed to deploy. They are also **NEVER** exposed through tapdev.

The priority order for these is:  `tapestry:health-check`, `health-check:all`, `health-check`. For each package.json in your monorepo, the first matching script from this list will be chosen.

These hooks also receive the deployment credentials used to deploy the system out, so that these credentials may be used to instantiate AWS services against that deployment env (this is because the majority of the CI's work runs under credentials that have no permission to make changes to any AWS environment, only touching the real deployment env specifically for the deploy and health-check steps). You will also receive the tapestry deployment-environment name. These fields are passed as environment variables:

* **TAPESTRY_HEALTH_CHECK_DEPLOY_CREDS** (also aliased as **TAPESTRY_HOOK_HEALTH_CHECK_DEPLOY_CREDS**)
* **TAPESTRY_HEALTH_CHECK_DEPLOY_ENV_NAME** (also aliased as **TAPESTRY_HOOK_HEALTH_CHECK_DEPLOY_ENV_NAME**)

The credentials env vars will contain a **JSON string** which you must `JSON.parse()` yourself. It will contain `access`/`secret`/`region` keys.

As a special rule for health check, these variables are provided to both the health-checker and to the before/after hooks in both `TAPESTRY_` and `TAPESTRY_HOOK_` prefixed forms. This is so that the health-check phases can share code.

Should any health-check fail, the state of the CI build will be a failure and will be reported as a build failure to tapestry's error channels.

See [docs/npm-run-scripts](../npm-run-scripts.md) for general info on run scripts.
