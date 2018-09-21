"use strict";

const { test } = require("ava");
const tapUtil = require("..@tapestry-ci/util");
const nextVersion = require("../lib/next-version");

const testData = require("./data/next-version.json");

test("nextVersion() is exported as tapUtil.nextVersion", t =>
  t.is(tapUtil.nextVersion, nextVersion));

testData.forEach(item => {
  const { versions, tests, tags } = item;
  const vstr = JSON.stringify(versions);
  tests.forEach(testspec => {
    const { target, expected } = testspec;
    tags.forEach(forTag => {
      const desc = `nextVersion(${vstr}, "${target}", "${forTag}") --> ${expected[forTag]}`;
      test(desc, t => t.is(nextVersion(versions, target, forTag), expected[forTag]));
    });
  });
});

const throwers = {
  "null forTag argument": () => nextVersion([], "1.0", null),
  "no forTag argument": () => nextVersion([], "1.0"),
  "number forTag argument": () => nextVersion([], "1.0", 34),
  "raw object forTag argument": () => nextVersion([], "1.0", {}),
  "instance forTag argument": () => nextVersion([], "1.0", new function() {}()),
};

Object.keys(throwers).forEach(desc => {
  const thrower = throwers[desc];
  test(`nextVersion() throws on ${desc}`, t => t.throws(thrower));
});
