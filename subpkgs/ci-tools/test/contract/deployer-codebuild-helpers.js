"use strict";

const tapestryCITools = require("../..@tapestry-ci/ci.js");
const test = require("ava").test; // ava is provided for you, no need to npm i it as long as you're testing through nitpicker
// const sinon = require('sinon'); // you must manually npm i --save-dev any testing things

test("tapestry-ci-tools at the very least compiles", t => {
  t.truthy(tapestryCITools);
});

test.failing("tapestry-ci-tools API contract is untested", t => {
  t.fail("Rando Christensen should be writing tests");
});
