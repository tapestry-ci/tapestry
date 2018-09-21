"use strict";

const tapUtil = require("@tapestry-ci/util");
const chalk = require("chalk");
const helpers = require("./helpers");
const queen = require("prom-queen");
const logger = tapUtil.logging.devLogger("local");

const { command: commandInstall } = require("./install");
const { command: commandDoctor } = require("./doctor");
const { command: commandBuildDocs } = require("./build-docs");

const COMPLETE_MSG = `tapdev local completed!`;
const DOCS_NEEDED_MSG = `Documentation has not been built. Use \`tapdev local --docs\` to build during tapdev local, or \`tapdev build-docs\` to build documentation manually.`;

function init(cmdr) {
  cmdr
    .command("local")
    .option("-d, --delete-modules", "clear node_modules folders before install (slower)")
    .option("-p, --production", "install using `npm  install --production` during install step")
    .option("-e, --environment <name>", "build environment. defaults to `local`", /^.+$/, "local")
    .option(
      "--docs",
      "also run build-docs steps. You can force this on by setting the environment " +
        "variable TAPDEV_LOCAL_ALWAYS_INCLUDE_DOCS to any value"
    )
    .description(
      "sets up your local dev environment nicely (runs tapdev commands install " +
        "(with post-install builds enabled) -> (build-docs if enabled) -> doctor in that order)"
    )
    .action(options => command(cmdr, options));
}

async function command(cmdr, options = {}) {
  const cwd = process.cwd();

  const doDocs = !!(options.docs || process.env.TAPDEV_LOCAL_ALWAYS_INCLUDE_DOCS);

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
    [
      "install",
      commandInstall,
      mkOpts({
        deleteModules: !!options.deleteModules,
        production: options.production,
        environment: options.environment,
        skipBuilds: false,
      }),
    ],
    ...(doDocs
      ? [["build-docs", commandBuildDocs, mkOpts({ environment: options.environment })]]
      : []),
    ["doctor", commandDoctor, mkOpts()],
  ];

  await helpers.init(cwd, options, "*");
  await queen.sequential(commands, args => runCmd(...args));

  logger.success(COMPLETE_MSG);
  if (!doDocs) logger.warn(DOCS_NEEDED_MSG);
}

module.exports = { init, command };
