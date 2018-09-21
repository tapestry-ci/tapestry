"use strict";

const chalk = require("chalk");
const tapUtil = require("@tapestry-ci/util");
const logger = tapUtil.logging.devLogger("helpers");

const homerel = p => (p.startsWith(`${process.env.HOME}/`) ? p.replace(process.env.HOME, "~") : "");

const INIT_ITEMS = ["project", "subpackages", "spec"];
// const INIT_ALWAYS = ["project"];
const INIT_LOADERS = {
  project: (dir, options) =>
    Promise.resolve()
      .then(() => tapUtil.project.findProjectAndChdir(dir).then(p => (options.project = p)))
      .then(() => logger.log(`project root: ${chalk.bold.green(homerel(options.project.root))}`)),

  subpackages: (dir, options) =>
    Promise.resolve()
      .then(() => (options.subpackages = tapUtil.subpackages.init(options.project.root)))
      .then(() => options.subpackages.paths())
      .then(ps => logger.debug(`Found subpackages @ ${ps.join(", ")}`)),

  spec: (dir, options) =>
    Promise.resolve()
      .then(() => logger.debug(`loading tapestry service spec`))
      .then(() => tapUtil.serviceSpec.load(options.project.root).then(s => (options.spec = s))),
};

function init(dir, options, ...needs) {
  const _needs = name => name === "project" || needs.includes("*") || needs.includes(name);
  const load = name => () => (options[name] ? Promise.resolve() : INIT_LOADERS[name](dir, options));
  const reducer = (promise, name) => promise.then(load(name));
  const promise = INIT_ITEMS.filter(_needs).reduce(reducer, Promise.resolve());
  return promise;
}

module.exports = { init };
