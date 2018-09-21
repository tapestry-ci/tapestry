"use strict";

const serviceSpec = require("./service-spec");
const buildInfo = require("./build-info");
const subpackages = require("./subpackages");

function prepareBuildRoot(dir) {
  return Promise.all([
    serviceSpec.compile(dir, true),
    buildInfo.generateBuildInfo(dir),
    subpackages.generateSubpackageMeta(dir, true),
  ]).then(() => null); // throw away output!
}

module.exports = { prepareBuildRoot };
