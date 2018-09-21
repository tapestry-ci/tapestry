"use strict";

const tapUtil = require("@tapestry-ci/util");
const path = require("path");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const _rejecto = m => Promise.reject(new Error(m));
const _swallowENOENT = e => (e.code === "ENOENT" ? null : Promise.reject(e));
const logger = tapUtil.logging.devLogger("lspkg");

function init(cmdr) {
  cmdr
    .command("list-packages")
    .alias("lspkg")
    .description("shows paths of all known subpackages")
    .action(options => command(cmdr, options));
}

function command(cmdr, options = {}) {
  const cwd = process.cwd();
  let project, subpackages, paths;

  return Promise.resolve()
    .then(() => tapUtil.project.findProjectAndChdir(cwd).then(p => (project = p)))
    .then(() => logger.log(`Found project @ ${project.root}`))
    .then(() => (subpackages = tapUtil.subpackages.init(project.root)))
    .then(() => subpackages.paths().then(p => (paths = p)))
    .then(() => logger.log("PATHS: "))
    .then(() => paths.map(x => console.log(`   ${x}`)));
}

module.exports = { init, command };
