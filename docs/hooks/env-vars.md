# env-vars hook: when tapestry compiles env var definitions

## hooks :
* `tapestry:before:env-vars`
* `tapestry:after:env-vars`

These hooks happen before/after tapestry compiles `tapestry.env-vars.*` files down into `.env` files. These are meant to be consumed by the `dotenv` package (or anything with a compatible api).

* during the `tapdev env-vars` command, or during `tapdev local`
* during the CI run-builds step

## env vars :

* **TAPESTRY_HOOK_ENVVARS_ENV_NAME** : in the case of a full-deploy CI run, this will be the tapestry deployment environment name. It will be `local` during `tapdev` or a test-only CI run, unless the user has chosen a different name via the `-e` flag to `tapdev local` or `tapdev env-vars`
