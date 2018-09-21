# publish hook: when tapestry publishes an npm package

**THESE HOOKS ONLY RUN UNDER CI, NEVER UNDER** `tapdev`**!**

## hooks :
* `tapestry:before:publish`
* `tapestry:after:publish`

These hooks happen before/after tapestry publishes an npm package during the deployment phase of a CI full-deploy build.

## env vars :

* **TAPESTRY_HOOK_PUBLISH_DIST_TAG** : this is the --tag that was or will be passed to `npm publish`
* **TAPESTRY_HOOK_PUBLISH_VERSION** : this is the SemVer version number that was or will be published
