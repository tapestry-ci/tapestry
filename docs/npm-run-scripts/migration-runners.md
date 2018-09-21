# Tapestry npm-run-scripts for post-deploy db migrations

After every successful deploy of **ALL** packages that require deployment, before the health-check phase, tapestry provides a specific place to add automatic db migrations.

Tapestry does no internal monitoring of your db or migrations, providing only this specific step between *deploy* and *health-check* which you can use to run migrations.

These checks will **NEVER** run if any package failed to deploy, or if the CI failed prior to deploy. They are also **NEVER** exposed through tapdev.

The priority order for these is:  `tapestry:migrate`, `migrate:all`, `migrate`. For each package.json in your monorepo, the first matching script from this list will be chosen.

These hooks also receive the deployment credentials used to deploy the system out, so that these credentials may be used to instantiate AWS services against that deployment env (this is because the majority of the CI's work runs under credentials that have no permission to make changes to any AWS environment, only touching the real deployment env specifically for the deploy and health-check steps). You will also receive the tapestry deployment-environment name. These fields are passed as environment variables:

* **TAPESTRY_MIGRATIONS_DEPLOY_CREDS** (also aliased as **TAPESTRY_HOOK_MIGRATIONS_DEPLOY_CREDS**)
* **TAPESTRY_MIGRATIONS_DEPLOY_ENV_NAME** (also aliased as **TAPESTRY_HOOK_MIGRATIONS_DEPLOY_ENV_NAME**)

The credentials env vars will contain a **JSON string** which you must `JSON.parse()` yourself. It will contain `access`/`secret`/`region` keys.

As with health-checks and finalize steps, these variables are provided to both the migration runner and to the before/after hooks in both `TAPESTRY_` and `TAPESTRY_HOOK_` prefixed forms. This is so that the migration phases can share code with their hooks.

Should any migration fail, the state of the CI build will be a failure and will be reported as a build failure to tapestry's error channels. Tapestry's health-check phase will *NOT* be run if db migrations failed.

See [docs/npm-run-scripts](../npm-run-scripts.md) for general info on run scripts.
