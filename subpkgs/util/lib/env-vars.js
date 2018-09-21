"use strict";

const path = require("path");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const hooks = require("./hooks");

const logger = require("./logging").utilLogger("envvars");
const debug = (...a) => logger.debug(...a);

const _rejecto = m => Promise.reject(m instanceof Error ? m : new Error(m));

const parseAny = require("./parse-any");

const removeNewlines = x => x.replace(/\r?\n/g, " ");
const envVal = val =>
  removeNewlines(typeof val === "string" ? val : !val ? "" : val.toString ? val.toString() : "");
const envKey = val => val.replace(/[^A-Za-z0-9_]+/g, "_");
const envEntry = (k, v) => `${envKey(k)}=${envVal(v)}\n`;

const checkEnv = envName =>
  /^.+$/.test(envName)
    ? Promise.resolve(null)
    : _rejecto(`Bad environment ${envName}, options: ${AVAILABLE_ENVS.join(", ")}`);

function buildEnvVars(rootDir, pkgDir, envName) {
  if (!pkgDir.startsWith("/")) pkgDir = path.resolve(rootDir, pkgDir);

  const outputFile = getOutputFile(rootDir, pkgDir);
  const getVars = o =>
    Object.keys(o || {}).reduce((m, x) => Object.assign(m, { [envKey(x)]: o[x] }), {});
  const mergedVars = o => Object.assign({}, getVars(o.parsed.ALL), getVars(o.parsed[envName]));
  return hooks.hooked(
    () =>
      checkEnv(envName)
        .then(() => parseAny.loadUpTree(pkgDir, "tapestry.env-vars", rootDir))
        .then(objs => Object.assign({}, ...objs.map(mergedVars)))
        .then(obj => show(rootDir, outputFile, obj))
        .then(obj => renderDotEnv(obj))
        .then(rendered => fs.writeFile(outputFile, rendered, "utf8"))
        .then(() => logger.log(`saved ${path.relative(rootDir, outputFile)} (env: ${envName})`)),
    pkgDir,
    "env-vars",
    {
      env: Object.assign({}, process.env, {
        TAPESTRY_ENV: envName,
        TAPESTRY_BUILD_ENV: envName,
        TAPESTRY_HOOK_ENVVARS_ENV_NAME: envName,
      }),
    }
  );
}

function getOutputFile(rootDir, pkgDir) {
  const targetDir = pkgDir.startsWith("/") ? pkgDir : path.resolve(rootDir, pkgDir);
  return path.resolve(targetDir, ".env");
}

function show(rootDir, outputFile, obj) {
  const relpath = path.relative(rootDir, outputFile);
  debug(
    `[${relpath}] saving with env vars ${Object.keys(obj)
      .map(envKey)
      .join(", ")}`
  );
  return obj;
}

function renderDotEnv(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((m, x) => m + envEntry(x, obj[x]), "");
}

module.exports = { buildEnvVars };
