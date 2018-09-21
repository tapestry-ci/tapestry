"use strict";

const resolve = (...a) => Promise.resolve(...a);
const logger = require("./logging").utilLogger("hooks");
const path = require("path");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const executor = require("./executor");
const PJ_STR = "/package.json";
const PJ_RGX = /\/package\.json$/;

const readJson = f => fs.readFile(f, "utf8").then(JSON.parse);
const fix = dir => (dir.endsWith(PJ_STR) ? dir.replace(PJ_RGX, "") : dir);
const npmRun = (dir, name, opts = {}) => {
  logger.log(`[run-hook] ${name} in ${dir}`);
  const env = Object.assign({}, process.env, opts.env || {});
  return executor.exec(`npm run ${name}`, { dir, env });
};

const runHook = (dir, name, opts = {}) => {
  const _dir = fix(dir);
  const _pkgpath = path.resolve(_dir, "package.json");
  // logger.debug(`hooks.runHook: ${dir}, ${name}: attempting to read ${_pkgpath}`); // this is too verbose even for debug=true
  return readJson(_pkgpath).then(pkgJson => {
    if ("scripts" in pkgJson && pkgJson.scripts[name]) return npmRun(fix(dir), name, opts);
    // logger.debug(`[skip-hook] no hook named ${name} in ${fix(dir)}/package.json`); // too verbose even for debug=true
    return resolve();
  });
};

const runBeforeHook = (dir, name, opts = {}) => runHook(fix(dir), `tapestry:before:${name}`, opts);

const runAfterHook = (dir, name, opts = {}) => runHook(fix(dir), `tapestry:after:${name}`, opts);

const workIt = (promise, worker) => promise.then(() => resolve(worker()));
const workAll = workers => workers.reduce(workIt, resolve());

const hooked = (func, dir, hooks, opts = {}) => {
  const realHooks = Array.isArray(hooks) ? hooks : [hooks];
  const reverseHooks = realHooks.slice().reverse();
  const descs = [
    ...realHooks.map(x => `[${x}: before]`),
    "[WORKER]",
    ...reverseHooks.map(x => `[${x}: after]`),
  ].join(" -> ");
  logger.debug(`hooks.hooked: ${dir}: ${descs}`);
  const workers = [
    ...realHooks.map(name => () => runBeforeHook(fix(dir), name), opts),
    func,
    ...reverseHooks.map(name => () => runAfterHook(fix(dir), name), opts),
  ];
  return workAll(workers);
};

module.exports = { runBeforeHook, runAfterHook, runHook, hooked };
