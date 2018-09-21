#!/usr/bin/env node

"use strict";
const IS_MAIN = require.main === module;
const logger = require("../lib/custom-logger").logger("cli");

const runCmd = require("../lib/run-internal-cmd");
const chalk = require("chalk");

const _err = m => (IS_MAIN ? usage(new Error(m)) : Promise.reject(new Error(m)));
const no = (type, name) => _err(`Unknown ${type}: ${name}`);
const noAnything = (type, name) => _err(`Unknown args: ${type} ${name}`);
const tapUtil = require("@tapestry-ci/util");

const CI_NAME = require("../package.json").name;
const CI_VERSION = require("../package.json").version;

module.exports = { run, runStep, runPhase, runAllPhases, usage };

if (IS_MAIN) {
  if (process.argv.length < 4 || process.argv.filter(x => x.startsWith("-")).length) usage();

  process.on("uncaughtException", e => {
    logger.error("Uncaught Exception", e);
    process.exit(126);
  });
  process.on("unhandledRejection", e => {
    logger.error("Unhandled Rejection", e);
    process.exit(126);
  });

  run(...process.argv.slice(2));
}

function run(type, name) {
  let promise;
  logger.startup(CI_NAME, CI_VERSION);

  if (type === "phase" && name === "ALL") promise = runAllPhases();
  else if (type === "phase") promise = runPhase(name);
  else if (type === "step") promise = runStep(name);
  else promise = noAnything(type, name);

  return promise.then(runCmd.exitClean, runCmd.exitDirty);
}

function runStep(name) {
  return runCmd.run(name);
}

function runPhase(name) {
  return runCmd.runPhase(name);
}

function runAllPhases() {
  return Promise.resolve()
    .then(() => runPhase("install"))
    .then(() => runPhase("prebuild"))
    .then(() => runPhase("build"))
    .then(() => runPhase("postbuild"));
}

function usage(message) {
  if (message) {
    logger.error();
    logger.error(chalk.red.bold("stack" in message ? message.stack : message));
    logger.error();
  }
  logger.error(chalk.bold(`Usage: ${process.argv[1]} <phase|step> [phase-or-step-name]`));
  logger.error(chalk.bold(`  phases: ALL ${runCmd.PHASES.join(" ")}`));
  logger.error(chalk.bold(`  steps: ${runCmd.STEPS.join(" ")}`));
  process.exit(127);
}
