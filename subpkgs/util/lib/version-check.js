"use strict";

const latestVersion = require("latest-version");
const chalk = require("chalk");
const semver = require("semver");
const logger = require("./logging").utilLogger();

const BANNER = chalk.bold.red(
  `
██╗    ██╗ █████╗ ██████╗ ███╗   ██╗██╗███╗   ██╗ ██████╗
██║    ██║██╔══██╗██╔══██╗████╗  ██║██║████╗  ██║██╔════╝ ██╗
██║ █╗ ██║███████║██████╔╝██╔██╗ ██║██║██╔██╗ ██║██║  ███╗╚═╝
██║███╗██║██╔══██║██╔══██╗██║╚██╗██║██║██║╚██╗██║██║   ██║██╗
╚███╔███╔╝██║  ██║██║  ██║██║ ╚████║██║██║ ╚████║╚██████╔╝╚═╝
 ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝  ╚═══╝ ╚═════╝
`
);
const message = (name, cur, latest) =>
  chalk.bold.yellow(
    `
  👶
  👶  ${name} is out of date!! 😭  😭  😭
  👶
  👶    Latest Version: ${latest}
  👶    Current Version: ${cur}
  👶
  👶  You should run the following command:
  👶    ${chalk.bold.white(`npm install --global ${name}@${latest}`)}
  👶
`
  );

function cry(name, cur, latest, opts) {
  console.error(BANNER);
  console.error(message(name, cur, latest));
  if (opts.reject)
    return Promise.reject(new Error(`Error: ${name} out of date! cur:${cur} latest:${latest}`));

  if (opts.force) {
    console.error(chalk.bold.red("☠️ Cannot proceed without update. ☠️ EXITING ☠️"));
    process.exit();
  }
}

function check(name, cur, opts = {}) {
  logger.debug(`checking ${name} against current ${cur} (opts: ${JSON.stringify(opts)})`);
  return latestVersion(name).then(latest => {
    logger.debug(`latest version of ${name} is ${latest} (cur: ${cur})`);
    return semver.lt(cur, latest) ? cry(name, cur, latest, opts) : latest;
  });
}

module.exports = { check };
