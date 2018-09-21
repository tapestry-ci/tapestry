"use strict";

const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const logger = require("./custom-logger").logger("util:ensure-project-dir");

const mkErr = str => Promise.reject(new Error(str));
const SPEC_FILES = ["hjson", "json", "yml"].map(x => `tapestry.service.${x}`);
const bad = dir =>
  mkErr(`${dir} does not have a valid Service Spec file at ${SPEC_FILES.join(" OR ")}`);

function ensureProjectDir(dir) {
  logger.log(`Checking to see if ${dir} is a valid project directory`);
  return Promise.resolve()
    .then(() => fs.readdir(dir))
    .then(files => files.filter(f => /^tapestry\.service\.(h?json|yml)$/.test(f))[0] || null)
    .then(file => file || bad(dir));
}

module.exports = { ensureProjectDir };
