"use strict";

const helpers = require("./helpers");
const tapUtil = require("@tapestry-ci/util");
const logger = tapUtil.logging.devLogger("clean");

function init(cmdr) {
  cmdr
    .command("clean")
    .description("clears out node_modules files")
    .action(options => command(logger, cmdr, options));
}

function command(cmdr, options = {}) {
  const cwd = process.cwd();
  return Promise.resolve()
    .then(() => helpers.init(cwd, options, "subpackages"))
    .then(() => logger.log(`cleaning all node_modules folders...`))
    .then(() => options.subpackages.cleanNodeModules());
}

module.exports = { init, command };
