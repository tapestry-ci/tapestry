"use strict";

const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const logger = require("./custom-logger").logger("util:build-info");
const tapestryUtil = require("@tapestry-ci/util");
const artifacts = require("./artifacts");

const BUILD_INFO_ARTIFACT = ["Tapestry", "Build-Info.json"];
let cached = null;
let eventsWaiting = [];

function generateBuildInfoUnlessExists(dir) {
  return Promise.resolve()
    .then(() => artifacts.loadJson(...BUILD_INFO_ARTIFACT))
    .catch(e => (e.code === "ENOENT" ? generateBuildInfo(dir) : Promise.reject(e)));
}

function generateBuildInfo(dir) {
  const buildInfoFile = artifacts.getPath(...BUILD_INFO_ARTIFACT);
  const buildInfo = {
    envVars: process.env,
  };

  buildInfo.buildId = process.env.TAPESTRY_BUILD_ID;
  buildInfo.buildStr = process.env.TAPESTRY_BUILD_STR;
  Object.assign(
    buildInfo,
    tapestryUtil.buildInfo.create.fromBuildStr(process.env.TAPESTRY_BUILD_STR)
  );
  buildInfo.buildTime = new Date(process.env.TAPESTRY_DATE_ISO);
  buildInfo.events = eventsWaiting.concat([{ name: "initialized", date: new Date() }]);
  eventsWaiting = [];
  return Promise.resolve()
    .then(() => artifacts.save(...BUILD_INFO_ARTIFACT, buildInfo))
    .then(() => logger.log(`creating @ ${buildInfoFile}`));
}

function addBuildEvent(dir, name, fields) {
  const buildInfoFile = artifacts.getPath(...BUILD_INFO_ARTIFACT);
  const date = new Date();
  const event = Object.assign({ name, date }, fields || {});

  return Promise.resolve(cached)
    .then(
      data =>
        data ||
        fs
          .readFile(buildInfoFile, "utf8")
          .then(JSON.parse)
          .then(d => (cached = d))
    )
    .then(() => cached.events.push(event))
    .then(() => fs.writeFile(buildInfoFile, JSON.stringify(cached, null, 2), "utf8"))
    .catch(e => {
      if (e.code === "ENOENT") eventsWaiting.push(event);
      else return Promise.reject(e);
    });
}

function loadMeta(dir) {
  return cached
    ? Promise.resolve(cached)
    : artifacts.loadJson(...BUILD_INFO_ARTIFACT).then(d => (cached = d));
}

module.exports = {
  addBuildEvent,
  generateBuildInfo,
  generateBuildInfoUnlessExists,
  loadMeta,
};
