# Tapestry npm-run-scripts for generating and publishing documentation for your projects

These scripts are for generating and publishing documentation. Tapestry itself has no internal logic
for generating documentation besides running these scripts (and their associated hooks).

Before and after hooks are defined for these steps as well, see [docs/hooks/documentation](../hooks/documentation.md) for more information.

## builders

These scripts run at the end of CI test phases, and during `tapdev build-docs` or `tapdev local --docs` during development. They should generate documentation in a suitable location such that any docs-publish steps in your project know where to find them, or in the case of local development, in a place where developers can find them.

The priority order for these is:  `tapestry:build-docs`, `build-docs:all`, `build-docs`. For each package.json in your monorepo, the first matching script from this list will be chosen.

Env vars provided:
* **TAPESTRY_BUILD_DOCS_ENV_NAME**, aliased as **TAPESTRY_HOOK_BUILD_DOCS_ENV_NAME**: The deploy environment these documents are being built for, in case this matters to you.

## publishers

These scripts run at the end of CI deploy phases, before finalization. They should publish the generated documentation in a suitable place.

The priority order for these is:  `tapestry:publish-docs`, `publish-docs:all`, `publish-docs`. For each package.json in your monorepo, the first matching script from this list will be chosen.

In most monorepos, it may make the most sense to define `publish-docs` (and potentially the `build-docs` step as well) on the top-level monorepo; in particular, the build results markdown/json files are for the entire repo, and not just this specific project.

Env vars provided:
* **TAPESTRY_PUBLISH_DOCS_DEPLOY_CREDS**, aliased as **TAPESTRY_HOOK_PUBLISH_DOCS_DEPLOY_CREDS**: The deployment credentials used during deploy for the proper env, in case these are needed for docs publishing
* **TAPESTRY_PUBLISH_DOCS_DEPLOY_ENV_NAME**, aliased as **TAPESTRY_HOOK_PUBLISH_DOCS_DEPLOY_ENV_NAME**: The tapestry deployment environment this deploy was for
* **TAPESTRY_PUBLISH_DOCS_BUILD_RESULTS_JSON_FILE**, aliased as **TAPESTRY_HOOK_PUBLISH_DOCS_BUILD_RESULTS_JSON_FILE**: The path to a JSON file holding the tapestry build results for the entire project, in case you wish to include these in the published documentation.
* **TAPESTRY_PUBLISH_DOCS_BUILD_RESULTS_MARKDOWN_FILE**, aliased as **TAPESTRY_HOOK_PUBLISH_DOCS_BUILD_RESULTS_MARKDOWN_FILE**: The path to a Markdown file holding a summary of the info in the above JSON, in case you wish to include these in the published documentation.
