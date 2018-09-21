"use strict";

const tapUtil = require("@tapestry-ci/util");
const path = require("path");

const logger = tapUtil.logging.devLogger("test");

function init(cmdr) {
  cmdr
    .command("run-tests")
    .alias("test")
    .description("Runs tests on all subpackages")
    .action(options => command(cmdr, options));
}

function command(cmdr, options = {}) {
  const cwd = process.cwd();
  let project;
  let subpackages;

  return Promise.resolve()
    .then(() => tapUtil.project.findProjectAndChdir(cwd).then(p => (project = p)))
    .then(() => logger.log(`Found project @ ${project.root}`))
    .then(() => (subpackages = tapUtil.subpackages.init(project.root)))
    .then(() => subpackages.paths())
    .then(ps => logger.log(`Found subpackages @ ${ps.join(", ")}`))
    .then(() => logger.log(`Running tests for all packages ...`))
    .then(() => subpackages.test(false, false));
}

module.exports = { init, command };
