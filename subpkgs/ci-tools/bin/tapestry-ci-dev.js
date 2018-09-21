#!/usr/bin/env node

"use strict";

const chalk = require("chalk");
const buildInfo = require("@tapestry-ci/util").buildInfo;
const crypto = require("crypto");

const tapCI = require(".@tapestry-ci/ci");
const runCmd = require("../lib/run-internal-cmd");
const logger = require("../lib/custom-logger").logger("dev-cli");
const randSha = () =>
  crypto
    .createHash("sha1")
    .update(Math.random().toString())
    .digest("hex");

const CI_NAME = require("../package.json").name;
const CI_VERSION = require("../package.json").version;

const [
  ,
  me,
  type = "phase",
  name = "ALL",
  mode = "test-only",
  env = "development",
  sha1 = randSha(),
  when = Date.now(),
] = process.argv;

if (!type || !name || process.argv.filter(x => x.startsWith("-")).length > 0) {
  logger.error(`Usage: ${me} <step|phase> step-or-phase-name mode env commitId date`);
  logger.error("date can be anything that will be parsed by `new Date()`");
  logger.error("Defaults: mode=test-only env=development commitId=<a random fake sha1> date=<now>");
  logger.error(`  phases: ALL ${runCmd.PHASES.join(" ")}`);
  logger.error(`  steps: ${runCmd.STEPS.join(" ")}`);

  process.exit(127);
}

const envVars = buildInfo.tapestryEnvVars(sha1, new Date(when), mode, env);
envVars.FORCE_COLOR = "1";
const len = Object.keys(envVars).sort((a, b) => b.length - a.length)[0].length;
const padded = z => new Array(len).fill(" ").reduce((m, x) => (m.length < len ? m + x : m), z);
logger.startup(CI_NAME, CI_VERSION);
Object.keys(envVars).forEach(x =>
  logger.log(`set env var ${chalk.cyan(padded(x))} = ${chalk.yellow(envVars[x])}`)
);
Object.assign(process.env, envVars);
logger.shutdown("info", "Launching tapestry-ci");

tapCI.run(type, name);
