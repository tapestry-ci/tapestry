# documentation hooks -- before/after hooks for the docs build/publish steps

These are helpers for the documentation phases of tapdev and tapestry-ci. See [docs/npm-run-scripts/documentation](../npm-run-scripts/documentation.md) for more info on these steps. These hooks receive the same env vars as their respective run-scripts

## build-docs hooks

* `tapestry:before:build-docs`
* `tapestry:after:build-docs`

Env vars provided:

* **TAPESTRY_HOOK_BUILD_DOCS_ENV_NAME**, aliased as **TAPESTRY_BUILD_DOCS_ENV_NAME**: The deploy environment these documents are being built for, in case this matters to you.

## publish-docs hooks (CI Only!)

* `tapestry:before:build-docs`
* `tapestry:after:build-docs`

Env vars provided:

* **TAPESTRY_HOOK_PUBLISH_DOCS_DEPLOY_CREDS**, aliased as **TAPESTRY_PUBLISH_DOCS_DEPLOY_CREDS**: The deployment credentials used during deploy for the proper env, in case these are needed for docs publishing
* **TAPESTRY_HOOK_PUBLISH_DOCS_DEPLOY_ENV_NAME**, aliased as **TAPESTRY_PUBLISH_DOCS_DEPLOY_ENV_NAME**: The tapestry deployment environment this deploy was for
* **TAPESTRY_HOOK_PUBLISH_DOCS_BUILD_RESULTS_JSON_FILE**, aliased as **TAPESTRY_PUBLISH_DOCS_BUILD_RESULTS_JSON_FILE**: The path to a JSON file holding the tapestry build results for the entire project, in case you wish to include these in the published documentation.
* **TAPESTRY_HOOK_PUBLISH_DOCS_BUILD_RESULTS_MARKDOWN_FILE**, aliased as **TAPESTRY_PUBLISH_DOCS_BUILD_RESULTS_MARKDOWN_FILE**: The path to a Markdown file holding a summary of the info in the above JSON, in case you wish to include these in the published documentation.
