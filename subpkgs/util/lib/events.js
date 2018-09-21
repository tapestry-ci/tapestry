"use strict";

const EventEmitter = require("events").EventEmitter;
const EMITTER = new EventEmitter();
const chalk = require("chalk");

const log = (msg, data) => EMITTER.emit("message", data ? { msg, data } : { msg });
const logger = name => ({
  log: (msg, ...a) => log(`${chalk.cyan(`[${name}]`)} ${msg}`, ...a),
});
const _on = (...a) => EMITTER.on(...a);
const emit = (...a) => EMITTER.emit(...a);

module.exports = { log, logger, emit, on: _on };
