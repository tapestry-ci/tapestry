"use strict";

const shellExec = require("../shell-exec");
const logger = require("../custom-logger").logger("cmd:globals");
const serviceSpec = require("../service-spec");
const _sublogger = label => m => logger.log(`[${label}] ${m}`);
const queen = require("prom-queen");

function _nope(_log) {
  _log(`nothing to do`);
  return Promise.resolve();
}

function _run(cmd, dir, _log) {
  _log(`[exec] ${cmd} @ ${dir}`);
  return shellExec.exec(cmd, dir, { quiet: true });
}

function _helper(things, worker, _log) {
  return things.length ? worker() : _nope(_log);
}

function _quotelist(lst) {
  return lst.map(x => `"${x.replace(/"/g, '\\"')}"`).join(" ");
}

function command(dir) {
  let spec = null;
  return Promise.resolve()
    .then(() => serviceSpec.loadMeta(dir).then(s => (spec = s)))
    .then(() => doDefaultInstalls(dir))
    .then(() => doNpmInstalls(dir, spec))
    .then(() => doSystemInstalls(dir, spec))
    .then(() => doCustomInstalls(dir, spec));
}

function doDefaultInstalls(dir) {
  const _log = _sublogger("tapestry-requirements");
  return _run("npm install -g npm", dir, _log);
}

function doCustomInstalls(dir, spec) {
  const _log = _sublogger("custom-install-commands");
  const commands = spec.install.custom;
  const go = cmd => _run(cmd, dir, _log);
  return _helper(commands, () => queen.sequential(commands, go), _log);
}

// FUTURE @TODO : eventually this should look for `apt`/`yum`/`brew` commands,
// and use spec.install< .apt | .yum | .brew >
function doSystemInstalls(dir, spec) {
  const _log = _sublogger("install-apt-packages");
  const packages = spec.install.apt;
  const go = () => _run(`apt-get install -y -qq ${_quotelist(packages)}`, dir, _log);
  return _helper(packages, go, _log);
}

function doNpmInstalls(dir, spec) {
  const _log = _sublogger("install-npm-globals");
  const packages = spec.install.npm;
  const go = () => _run(`npm install --global ${_quotelist(packages)}`, dir, _log);
  return _helper(packages, go, _log);
}

module.exports = { command };
