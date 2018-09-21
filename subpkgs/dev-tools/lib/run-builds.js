"use strict";

const tapUtil = require("@tapestry-ci/util");
const helpers = require("./helpers");

const logger = tapUtil.logging.devLogger("build");

function init(cmdr) {
  cmdr
    .command("run-builds")
    .alias("build")
    .option("-e, --environment <name>", "build environment. defaults to `local`", /^.+$/, "local")
    .description("Runs build steps on all subpackages")
    .action(options => command(cmdr, options));
}

function command(cmdr, options = {}) {
  const cwd = process.cwd();

  return Promise.resolve()
    .then(() => helpers.init(cwd, options, "subpackages"))
    .then(() => logger.log(`Running builds for all packages ...`))
    .then(() => options.subpackages.build(false, false, options.environment));
}

module.exports = { init, command };
