# health-check hook: when tapestry runs post-deploy health checks

**THESE HOOKS ONLY RUN UNDER CI, NEVER UNDER** `tapdev`**!**

## hooks :
* `tapestry:before:health-check`
* `tapestry:after:health-check`

These hooks happen during the health-check phase, which is run **ONLY** after an otherwise fully-successful deploy process. Any failure during health-check

## env vars :

* **TAPESTRY_HOOK_HEALTH_CHECK_DEPLOY_CREDS** (also aliased as **TAPESTRY_HEALTH_CHECK_DEPLOY_CREDS**)
* **TAPESTRY_HOOK_HEALTH_CHECK_DEPLOY_ENV_NAME** (also aliased as **TAPESTRY_HEALTH_CHECK_DEPLOY_ENV_NAME**)

The credentials env vars will contain a **JSON string** which you must `JSON.parse()` yourself. It will contain `access`/`secret`/`region` keys.

The env vars for this hook have aliases without the `HOOK_` part of their name. This is so that health-check *hooks* can share code with the health-check *step* itself and not jump through extra hoops.
