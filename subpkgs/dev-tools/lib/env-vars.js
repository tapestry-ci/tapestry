"use strict";

const tapUtil = require("@tapestry-ci/util");
const helpers = require("./helpers");

const logger = tapUtil.logging.devLogger("env");

function init(cmdr) {
  cmdr
    .command("env-vars")
    .alias("env")
    .description("Runs build steps on all subpackages")
    .option("-e, --environment <name>", "use build environment", /^.+$/, "local")
    .action(options => command(cmdr, options));
}

async function command(cmdr, options = {}) {
  const cwd = process.cwd();

  await helpers.init(cwd, options, "subpackages");
  logger.log(`preparing package .env files for environment: ${options.environment}`);
  await options.subpackages.buildEnvVars(options.environment);
  logger.line("warn");
  logger.warn(
    `Env vars have been re-built separately from the build steps. This is non-standard operation as normally the two steps are linked.`
  );
  logger.warn(
    `This command has no way of knowing whether any build steps require env-vars in your project.`
  );
  logger.warn(`If so, you may need to run \`tapdev build\` to run env-vars + build together.`);
  logger.line("warn");
}

module.exports = { init, command };
