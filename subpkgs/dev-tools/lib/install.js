"use strict";

const tapUtil = require("@tapestry-ci/util");
const helpers = require("./helpers");
const logger = tapUtil.logging.devLogger("install");

function init(cmdr) {
  cmdr
    .command("install")
    .option("-e, --environment <name>", "build environment. defaults to `local`", /^.+$/, "local")
    .option("-p, --production", "install in production mode")
    .option("-D, --delete-modules", "predelete node_modules folders before installing")
    .option("-B, --skip-builds", "do not automatically run env-vars and build generation step")
    .description("prepares production dependencies (including tapestry local-dependencies)")
    .action(options => command(cmdr, options));
}

function command(cmdr, options = {}) {
  const cwd = process.cwd();
  const which = `${options.production ? "production" : "development"} dependencies`;
  const submethod = options.production ? "prodInstall" : "devInstall";

  return Promise.resolve()
    .then(() => helpers.init(cwd, options, "subpackages"))
    .then(() => {
      if (options.deleteModules) {
        logger.log(`cleaning node_modules folders ...`);
        return options.subpackages.cleanNodeModules();
      }
    })
    .then(() => logger.log(`Installing ${which} for all packages ...`))
    .then(() => options.subpackages[submethod]({}, !options.skipBuilds, options.environment))
    .then(() => logger.log(`Install complete: ${which}`));
}

module.exports = { init, command };
