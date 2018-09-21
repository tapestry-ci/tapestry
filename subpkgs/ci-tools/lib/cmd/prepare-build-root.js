"use strict";

const prepareBuildRoot = require("../prepare-build-root");
const logger = require("../custom-logger").logger("cmd:preproot");

function command(dir) {
  logger.log(`preparing <${dir}> for build`);

  return Promise.resolve()
    .then(() => prepareBuildRoot.prepareBuildRoot(dir))
    .then(() => logger.log(`ready for builds!`));
}

module.exports = { command };
