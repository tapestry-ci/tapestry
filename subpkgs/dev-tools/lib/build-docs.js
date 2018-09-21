"use strict";

const tapUtil = require("@tapestry-ci/util");

const logger = tapUtil.logging.devLogger("test");

function init(cmdr) {
  cmdr
    .command("build-docs")
    .option("-e, --environment <name>", "build environment. defaults to `local`", /^.+$/, "local")
    .description("Runs tapestry build-docs steps on all packages")
    .action(options => command(cmdr, options));
}

async function command(cmdr, options = {}) {
  const cwd = process.cwd();

  const env = Object.assign({}, process.env, {
    TAPESTRY_BUILD_DOCS_ENV_NAME: options.env,
    TAPESTRY_HOOK_BUILD_DOCS_ENV_NAME: options.env,
  });

  const hookOpts = { env };
  const execOpts = { env };

  const project = await tapUtil.project.findProjectAndChdir(cwd);
  logger.log(`Found project @ ${project.root}`);
  const subpackages = tapUtil.subpackages.init(project.root);

  logger.log(`Running build-docs steps ...`);
  return await subpackages.buildDocs(hookOpts, execOpts);
}

module.exports = { init, command };
