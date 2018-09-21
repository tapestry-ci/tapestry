"use strict";

const subpackages = require("../subpackages");
const logger = require("../custom-logger").logger("cmd:test");

function command(dir) {
  logger.log("running all tests");
  return subpackages.runInstrumentation(dir);
}

module.exports = { command };
