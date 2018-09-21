"use strict";

const logger = require("../custom-logger").logger("command:finalize");
const subpackages = require("../subpackages");
const statusUpdate = require("../status-update");
const waitsecs = secs => new Promise(r => setTimeout(r, secs * 1000));

const NO_BUILDREC = "Can't find previous build record! :(";

function command(dir) {
  logger.log("Running any finalize steps!");
  const _go = rec => subpackages.doFinalize(dir, rec);
  const _fail = () => Promise.reject(new Error(NO_BUILDREC));
  return waitsecs(5)
    .then(() => statusUpdate.load())
    .then(rec => (rec ? _go(rec) : _fail()));
}

module.exports = { command };
