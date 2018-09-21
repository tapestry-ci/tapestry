"use strict";

const subpackages = require("../subpackages");
const logger = require("../custom-logger").logger("cmd:build");
const tapUtil = require("@tapestry-ci/util");
const serviceSpec = require("../service-spec");

function command(dir) {
  logger.log("Running any build steps");
  let env = process.env.TAPESTRY_ENV;

  // in the case of none it should run against the local-development env.
  // this is only important for tests really
  if (env === "none") env = "local";
  return subpackages.doBuilds(dir, env);
}

module.exports = { command };
