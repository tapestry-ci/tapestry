# deploy hook: when tapestry deploys any non-npm deployment

**THESE HOOKS ONLY RUN UNDER CI, NEVER UNDER** `tapdev`**!**

## hooks :
* `tapestry:before:deploy`
* `tapestry:after:deploy`

These hooks happen before/after tapestry deploys one of the deployments defined in your `tapestry.service.*` file during the deployment phase of a CI full-deploy build.

## env vars :

* **TAPESTRY_HOOK_DEPLOY_DEPLOYMENT_ID** : the tapestry deployment-id of this deployment. has the form `SERVICE-NAME:DEPLOYMENT-TYPE:DEPLOYMENT-NAME`
* **TAPESTRY_HOOK_DEPLOY_ENV_NAME** : the deployment environment this is being deployed to
* **TAPESTRY_HOOK_DEPLOY_S3_BUNDLE_PATH** : where the deployment bundle will be saved to in s3 (env var is always set, but not all deployment types upload this file)
* **TAPESTRY_HOOK_DEPLOY_S3_PLAN_PATH** : where the deployment plan JSON file gets saved. this contains all of tapestry's metadata for a deployment
* **TAPESTRY_HOOK_DEPLOY_TYPE** : the deployment type (such as `serverless`, `elasticbeanstalk`, `electron`)
* **TAPESTRY_HOOK_DEPLOY_VERSION** : the tapestry-generated version number of the package which is being deployed
* **TAPESTRY_HOOK_DEPLOY_CREDENTIALS**: json string containing {secret,access,region} keys. credentials that were used to deploy to the env.
