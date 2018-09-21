"use strict";

const logger = require("../custom-logger").logger("command:health");
const subpackages = require("../subpackages");
const statusUpdate = require("../status-update");
const waitsecs = secs => new Promise(r => setTimeout(r, secs * 1000));

const NO_BUILDREC = "Can't find previous build record! :(";

function command(dir) {
  logger.log("Starting Health Checks");
  return waitsecs(5)
    .then(() => statusUpdate.load())
    .then(rec => {
      if (!rec) return Promise.reject(new Error(NO_BUILDREC));

      if (rec.hasErrors) {
        logger.error("BUILD HAS ERRORS! HEALTH-CHECK CAN BE SKIPPED!");
        return Promise.resolve();
      }

      return subpackages.healthCheck(dir);
    });
}

module.exports = { command };
