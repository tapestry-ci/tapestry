"use strict";

// const helpers = require("./helpers");
const tapUtil = require("@tapestry-ci/util");
const logger = tapUtil.logging.devLogger("legend");
const levels = "success info warn error debug trace".split(" ");
const chalk = require("chalk");

function init(cmdr) {
  cmdr
    .command("legend")
    .description(
      "shows example tapestry logging output. modify with DEBUG env var and --slim options!"
    )
    .action(options => command(cmdr, options));
}

function command(cmdr, options = {}) {
  logger.info("Tapestry sample logging output:");
  const hilite = chalk.bold.green;
  const _hidbgopt1 = hilite("--debug");
  const _hidbgvar1 = hilite("DEBUG='tapestry:*'");
  const _hidbgvar2 = hilite("TAPESTRY_DEBUG='*'");
  const _hislimopt = hilite("--slim");
  const _hislimvar = hilite("TAPESTRY_SLIM_OUTPUT=1");
  const _hivanlopt = hilite("--vanilla");
  const modme = `You may pass ${_hislimopt} or ${_hidbgopt1} or ${_hivanlopt}, set the env vars ${_hislimvar} or ${_hidbgvar1} or ${_hidbgvar2} to modify this output`;
  logger.info(modme);

  logger.line("info");

  for (const level of levels)
    logger[level](`this is an example log message of log-level ${level}!`);

  logger.line("info");

  logger.info("Data inspection", {
    someDate: new Date(),
    aString: "yo im a string",
    aBoolean: false,
    aNumber: 42,
    aNull: null,
    anUndefined: undefined,
    anArray: [1, "hello", true, null, []],
    some: { nested: { objects: { here: { "!": "!" } } } },
  });

  logger.info(
    "This is a message with linefeeds\nto show you how a long message might\nbe displayed on your terminal!"
  );

  logger.line("info");
  logger.shutdown("success");
}

module.exports = { init, command };
