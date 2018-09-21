"use strict";

const tapUtil = require("@tapestry-ci/util");
const chalk = require("chalk");
const helpers = require("./helpers");
const queen = require("prom-queen");
const logger = tapUtil.logging.devLogger("precommit");

const { command: commandInstall } = require("./install");
const { command: commandDoctor } = require("./doctor");
const { command: commandTest } = require("./run-tests");
const { command: commandBuildDocs } = require("./build-docs");

function init(cmdr) {
  cmdr
    .command("precommit")
    .alias("run-full-test")
    .option("-I, --skip-install", "skip install phase")
    .option("-d, --delete-modules", "clear node_modules folders before install (slower)")
    .option(
      "-e, --environment <name>",
      "use build environment during env-vars step",
      /^.+$/,
      "local"
    )
    .description(
      "Run a full install + test cycle on the project, useful before a commit (runs tapdev commands install (with builds enabled) -> build-docs -> doctor -> test in that order)"
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

  const plainOpts = mkOpts();
  const envOpts = mkOpts({ environment: options.environment });
  const installOpts = mkOpts({
    deleteModules: !!options.deleteModules,
    production: options.production,
    environment: options.environment,
    skipBuilds: false,
  });

  const commands = [];
  commands.push(
    options.skipInstall
      ? ["build", commandBuild, envOpts]
      : ["install", commandInstall, installOpts]
  );
  commands.push(["build-docs", commandBuildDocs, envOpts]);
  commands.push(["doctor", commandDoctor, plainOpts]);
  commands.push(["test", commandTest, plainOpts]);

  const runAll = () => queen.sequential(commands, args => runCmd(...args));

  return helpers
    .init(cwd, options, "*")
    .then(runAll)
    .then(() => logger.success("ALL PRE-COMMIT CHECKS PASSED"))
    .catch(e => {
      logger.error("ERROR IN PRE-COMMIT CHECKS", e);
      process.exit(1);
    });
}

module.exports = { init, command };
