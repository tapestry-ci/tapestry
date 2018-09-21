"use strict";

const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const path = require("path");
const logger = require("./custom-logger").logger("util:service-spec");
const queen = require("prom-queen");
const artifacts = require("./artifacts");
const tapUtil = require("@tapestry-ci/util");

const SERVICE_SPEC_ARTIFACT = ["Tapestry", "Service-Spec.json"];

function loadMeta(dir) {
  return artifacts.loadJson(...SERVICE_SPEC_ARTIFACT);
}

function compile(dir, unlessExists) {
  const outfile = artifacts.getPath(...SERVICE_SPEC_ARTIFACT);
  const outdir = path.dirname(outfile);

  if (unlessExists) {
    return Promise.resolve()
      .then(() => fs.mkdirRecursive(outdir))
      .then(() => fs.readFile(outfile, "utf8"))
      .then(() => logger.log(`${outfile} already exists!`))
      .catch(e => (e.code === "ENOENT" ? compile(dir, false) : Promise.reject(e)));
  }

  return Promise.resolve()
    .then(() => tapUtil.serviceSpec.load(dir))
    .then(data => artifacts.save(...SERVICE_SPEC_ARTIFACT, data))
    .then(() => logger.log(`creating @ ${outfile}`));
}

function deploymentsByPriority(dir, fn) {
  return loadMeta(dir)
    .then(spec => spec.deployments.sort((a, b) => b.priority - a.priority))
    .then(depls => queen.sequential(depls, fn));
}

module.exports = {
  deploymentsByPriority,
  compile,
  loadMeta,
};
