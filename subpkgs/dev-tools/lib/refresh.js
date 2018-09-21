"use strict";

const tapUtil = require("@tapestry-ci/util");
const chalk = require("chalk");
const helpers = require("./helpers");
const queen = require("prom-queen");
const logger = tapUtil.logging.devLogger("refresh");

// const { command: commandLink } = require("./link");
// const { command: commandInstall } = require("./install");
const { command: commandBuild } = require("./run-builds");
const { command: commandDoctor } = require("./doctor");

function init(cmdr) {
  cmdr
    .command("refresh")
    .option("-e, --environment <name>", "build environment. defaults to `local`", /^.+$/, "local")
    .description(
      "refreshes local dev environment (runs tapdev commands build -> doctor in that order)"
    )
    .action(options => command(cmdr, options));
}

function command(cmdr, options = {}) {
  const cwd = process.cwd();

  const mkOpts = (...a) => {
    const { spec, project, subpackages } = options;
    const obj = { spec, project, subpackages };
    return Object.assign({}, obj, ...a);
  };

  const runCmd = (humanName, func, opts) => {
    const cmdpretty = chalk.bold.cyan(`tapdev ${humanName}`);
    logger.log(`delegating to \`${cmdpretty}\``);
    return func(cmdr, opts);
  };

  const commands = [
    ["build", commandBuild, mkOpts({ environment: options.environment })],
    ["doctor", commandDoctor, mkOpts()],
  ];

  const runAll = () => queen.sequential(commands, args => runCmd(...args));

  return helpers.init(cwd, options, "*").then(runAll);
}

module.exports = { init, command };
