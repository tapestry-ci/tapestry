"use strict";

const COMPONENTS = {
  runInClone: require("./run-in-clone"),
  clean: require("./clean"),
  doctor: require("./doctor"),
  test: require("./run-tests"),
  build: require("./run-builds"),
  buildDocs: require("./build-docs"),
  install: require("./install"),
  findPackages: require("./list-packages"),
  local: require("./local"),
  envVars: require("./env-vars"),
  precommit: require("./precommit"),
  refresh: require("./refresh"),
  startCI: require("./start-ci"),
  serviceSpec: require("./display-service-spec"),
  ciStatus: require("./ci-status"),
  news: require("./news"),
  legend: require("./legend"),
  docs: require("./docs"),
};

const priority = (x, c) => c[x].priority || 0;
const byPriority = (a, b, c) => priority(b, c) - priority(a, c);
const ordered = c =>
  Object.keys(c)
    .sort((a, b) => byPriority(a, b, c))
    .map(name => ({ name, component: c[name] }));

function init(cmdr) {
  const subinit = (p, c) => p.then(() => c.component.init(cmdr));
  return ordered(COMPONENTS).reduce(subinit, Promise.resolve());
}

module.exports = { init };
