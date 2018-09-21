"use strict";

const tapUtil = require("@tapestry-ci/util");

async function exec(cmd, dir, opts = {}) {
  return await tapUtil.executor.exec(cmd, Object.assign({}, opts, { dir }));
}

module.exports = { exec };
