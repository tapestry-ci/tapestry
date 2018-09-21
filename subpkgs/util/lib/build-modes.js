"use strict";

const SHORT_BUILD_MODES = {
  "test-only": "T",
  "full-deploy": "F",
};
const SHORT_BUILD_MODES_REVERSE = {
  T: "test-only",
  F: "full-deploy",
};
const SHORT_DEPLOY_ENVS = {
  development: "D",
  staging: "S",
  production: "P",
  uat: "U",
  none: "0",
};
const SHORT_DEPLOY_ENVS_REVERSE = {
  D: "development",
  S: "staging",
  P: "production",
  U: "uat",
  "0": "none",
};

module.exports = {
  // informational
  buildModes: Object.keys(SHORT_BUILD_MODES),
  deployEnvs: Object.keys(SHORT_DEPLOY_ENVS),

  // maps used by ./build-info.js
  SHORT_BUILD_MODES,
  SHORT_BUILD_MODES_REVERSE,
  SHORT_DEPLOY_ENVS,
  SHORT_DEPLOY_ENVS_REVERSE,
};
