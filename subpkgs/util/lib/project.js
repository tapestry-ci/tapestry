"use strict";

const AVAILABLE = "json hjson yml".split(" ").map(ext => `tapestry.service.${ext}`);
const AVAIL_STR = AVAILABLE.map(x => `'${x}'`).join(" or ");

const path = require("path");
const findUp = require("find-up");
const _rejecto = msg => Promise.reject(new Error(msg));
const uhoh = cwd => _rejecto(`can't find ${AVAIL_STR} in ${cwd}`);
const checkResult = (r, cwd) => (r ? r : uhoh(cwd));
const findProjectConfig = (cwd = process.cwd()) =>
  findUp(AVAILABLE, { cwd }).then(r => checkResult(r, cwd));
const findProjectRoot = cwd => findProjectConfig(cwd).then(z => path.dirname(z));
const findProject = cwd =>
  findProjectConfig(cwd).then(config => ({
    config,
    root: path.dirname(config),
  }));
const findProjectAndChdir = cwd =>
  findProject(cwd).then(project => {
    process.chdir(project.root);
    return project;
  });

module.exports = {
  findProjectConfig,
  findProjectRoot,
  findProject,
  findProjectAndChdir,
};
