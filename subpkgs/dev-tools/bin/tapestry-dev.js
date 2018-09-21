#!/usr/bin/env node

"use strict";

const PKG = require("../package.json");
const VERSION = PKG.version;
const NAME = PKG.name;

const tapUtil = require("@tapestry-ci/util");
const logger = tapUtil.logging.devLogger();
const debug = (...a) => logger.debug(...a);

const components = require("../lib/components");
const cmdr = require("commander");
const chalk = require("chalk");

const news = require("../lib/news");

process.on("unhandledRejection", exitErr);

run();

function run() {
  cmdr.option(
    "--slim",
    "provide slimmer output (for non-wide terminals). env var TAPESTRY_SLIM_OUTPUT will also set this."
  );
  cmdr.option(
    "--debug",
    "turn on more verbose output. Same as setting env vars TAPESTRY_DEBUG='*' or DEBUG='tapestry:*'"
  );
  cmdr.option("--vanilla", "simulate the stripped down output used by tapestry-ci under codebuild");

  return Promise.resolve()
    .then(() => components.init(cmdr))
    .then(() => logger.startup(NAME, VERSION))
    .then(() => {
      if (!process.env.NO_TAPESTRY_VERSION_CHECK) {
        const how2fix = " (disable with env var NO_TAPESTRY_VERSION_CHECK)";
        debug(`[init] checking remote versions ${how2fix}`);
        return tapUtil.versionCheck
          .check(NAME, VERSION, { reject: true })
          .then(ver => debug(`[init] success, ${ver} is latest!`))
          .catch(e => {
            logger.error(`version-check failure ${how2fix}`);
            process.exit(1);
          });
      }
    })
    .then(() => news.alertIfUnviewed())
    .then(() => cmdr.version(VERSION))
    .then(() => cmdr.action(opts => cmdr.help()))
    .then(() => {
      cmdr.parse(process.argv);
      if (!process.argv.slice(2).filter(x => !x.startsWith("-")).length) {
        logger.error("No command specified!");
        cmdr.help(chalk.bold.red);
      }
    })
    .catch(exitErr);
}

function exitErr(error) {
  logger.error("Uh-Oh!", error);
  logger.shutdown("error");
  process.exit(127);
}
