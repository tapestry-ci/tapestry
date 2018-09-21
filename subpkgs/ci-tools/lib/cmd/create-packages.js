"use strict";

const archiver = require("../archiver");
const logger = require("../custom-logger").logger("cmd:create-packages");

function command(dir) {
  logger.log("Creating deployment packages");
  return archiver.createDeploymentBundles(dir);
}
module.exports = { command };
