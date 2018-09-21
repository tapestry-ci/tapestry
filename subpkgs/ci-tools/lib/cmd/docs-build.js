"use strict";

const subpackages = require("../subpackages");
const logger = require("../custom-logger").logger("cmd:docs-build");

async function command(dir) {
  logger.log("Building Documentation");
  return await subpackages.buildDocs(dir);
}

module.exports = { command };
