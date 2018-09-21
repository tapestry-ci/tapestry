"use strict";

const logger = require("../custom-logger").logger("command:do-deploys");
const deployments = require("../deployments");
const statusUpdate = require("../status-update");
const waitsecs = secs => new Promise(r => setTimeout(r, secs * 1000));

const NO_BUILDREC =
  "Can't find previous build record! Aborting deploy! something weird is happening here probably, this is not supposed to happen :(";

function command(dir) {
  logger.log("Starting Deploys");
  return waitsecs(5)
    .then(() => statusUpdate.load())
    .then(rec => {
      if (!rec) return Promise.reject(new Error(NO_BUILDREC));

      if (rec.hasErrors) {
        logger.error("BUILD HAS ERRORS! NO DEPLOYMENTS WILL BE MADE!");
        // don't want to re-reject here, the build has already failed and the only thing that
        // rejecting here would accomplish is to add an extra useless build error message
        return Promise.resolve();
      }

      return deployments.deployAll(dir);
    });
}

module.exports = { command };
