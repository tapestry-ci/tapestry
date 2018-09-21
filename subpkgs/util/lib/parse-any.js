"use strict";

const HJSON = require("hjson");
const yaml = require("js-yaml");
const toml = require("toml");
const json5 = require("json5");
const _rejecto = m => Promise.reject(m instanceof Error ? m : new Error(m));
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const path = require("path");
const _swallowENOENT = e => (e.code === "ENOENT" ? null : Promise.reject(e));
const mergeOptions = require("merge-options");
const findUp = require("find-up");
const queen = require("prom-queen");
const logger = require("./logging").utilLogger("parse-any");
const debug = (...a) => logger.debug(...a);

const parsers = {
  ".hjson": HJSON.parse,
  ".json": JSON.parse,
  ".toml": toml.parse,
  ".yml": yaml.parse,
  ".yaml": yaml.parse,
  ".json5": json5.parse,
};

// appender is a reducer that turns ['a','b','c','d'] into ['a', 'a/b', 'a/b/c', 'a/b/c/d']
const appender = (m, x) => (m.length ? [...m, path.join(m[m.length - 1], x)] : [x]);

function checkFile(dir, filefragment) {
  const exts = Object.keys(parsers);
  const files = exts.map(ext => path.resolve(dir, `${filefragment}${ext}`));
  return queen
    .parallel(files, file =>
      fs
        .stat(file)
        .then(() => file)
        .catch(_swallowENOENT)
    )
    .then(available => available.filter(x => !!x))
    .then(available => {
      if (available.length) {
        debug(`found: ${available.join(", ")}`);
        return available[0];
      }

      // debug(`found no ${filefragment}.* in ${dir}`);
      return available.length ? available[0] : null;
    });
}

function checkUpTree(dir, filefragment, upTo = "/") {
  if (!dir.startsWith("/")) dir = path.resolve(dir);

  const [empty, ...dirsegs] = dir.split("/");
  const dirstack = dirsegs
    .reduce(appender, [])
    .map(x => `/${x}`)
    .filter(x => `${x}/`.startsWith(upTo));

  const results = [];
  return queen
    .sequential(dirstack, dir => checkFile(dir, filefragment).then(file => results.push(file)))
    .then(() => results.filter(x => !!x));
}

function checkFirstUpTree(dir, filefragment, upTo = "/") {
  if (!dir.startsWith("/")) dir = path.resolve(dir);

  const [empty, ...dirsegs] = dir.split("/");
  const dirstack = dirsegs
    .reduce(appender, [])
    .map(x => `/${x}`)
    .filter(x => `${x}/`.startsWith(upTo));

  let result = null;
  const checker = dir =>
    result ? Promise.resolve() : checkFile(dir, filefragment).then(file => (result = file));
  return queen.sequential(dirstack, checker).then(() => result || null);
}

function load(file) {
  const ext = path.extname(file);
  const parser = parsers[ext];
  if (!parser) return _rejecto(`no parser for files of extension ${ext}`);

  debug(`loading ${file} with parser for ${ext}`);
  return fs.readFile(file, "utf8").then(str => parser(str));
}

function loadFile(dir, filefragment) {
  return checkFile(dir, filefragment).then(file => (file ? load(file) : {}));
}

function loadFirstUpTree(dir, filefragment, upTo) {
  return checkFirstUpTree(dir, filefragment, upTo).then(file => (file ? load(file) : {}));
}

function loadUpTree(dir, filefragment, upTo) {
  const worker = file => load(file).then(parsed => ({ file, parsed }));
  return checkUpTree(dir, filefragment, upTo).then(files => queen.sequential(files, worker));
}

function merged(dir, filefragment, upTo) {
  return loadUpTree(dir, filefragment, upTo)
    .then(results => results.map(x => x.parsed))
    .then(objs => Object.assign({}, ...objs));
}

function deepMerged(dir, filefragment, upTo) {
  return loadUpTree(dir, filefragment, upTo)
    .then(results => results.map(x => x.parsed))
    .then(objs => mergeOptions({}, ...objs));
}

module.exports = {
  checkFile,
  checkUpTree,
  checkFirstUpTree,
  loadFile,
  loadUpTree,
  loadFirstUpTree,
  deepMerged,
  merged,
  load,
  get types() {
    return Object.keys(parsers);
  },
};
