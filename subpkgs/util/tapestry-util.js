"use strict";

const packageJson = require("./package.json");

module.exports = {
  name: packageJson.name,
  version: packageJson.version,

  archives: require("./lib/archives"),
  buildInfo: require("./lib/build-info"),
  buildStatusUpdates: require("./lib/build-status-updates"),
  ciConfig: require("./lib/ci-config"),
  ciStatus: require("./lib/ci-status"),
  deployments: require("./lib/deployments"),
  envVars: require("./lib/env-vars"),
  events: require("./lib/events"),
  executor: require("./lib/executor"),
  hooks: require("./lib/hooks"),
  logging: require("./lib/logging"),
  nextVersion: require("./lib/next-version"),
  parseAny: require("./lib/parse-any"),
  priorityWorker: require("./lib/priority-worker"),
  project: require("./lib/project"),
  serviceSpec: require("./lib/service-spec"),
  startCI: require("./lib/start-ci"),
  subpackages: require("./lib/subpackages"),
  versionCheck: require("./lib/version-check"),
};
