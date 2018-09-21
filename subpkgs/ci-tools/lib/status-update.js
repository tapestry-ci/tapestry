"use strict";

const logger = require("./custom-logger").logger("util:status-update");
const tapUtil = require("@tapestry-ci/util");
const _buildInfo = tapUtil.buildInfo;
const monk = require("monk");
const GithubApi = require("github");
const artifacts = require("./artifacts");
const esprintf = require("esprintf");

const { StatusManager } = tapUtil.buildStatusUpdates;
const INIT = _getInit();

function _getInit() {
  let _promise;

  const loadGithubApi = token => {
    const api = new GithubApi();
    api.authenticate({ type: "token", token });
    return api;
  };

  const _getArtifactsHook = () => {
    let artcount = 0;
    const scrub = x => x.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/(^_+)|(_+$)/g, "");
    const artfile = info =>
      esprintf(
        "%08d-%s-%04d-%s.json",
        process.pid,
        process.argv.slice(2, 4).join("_"),
        ++artcount,
        scrub(info.message)
      );
    const hook = (info, opts) => artifacts.save("Status-Updates", artfile(info), { info, opts });
    return hook;
  };

  const _init = () => {
    if (!_promise) {
      logger.debug("Initializing StatusManager artifact-save hook");
      StatusManager.register(_getArtifactsHook());

      logger.log("Initializing StatusManager");
      _promise = tapUtil
        .ciConfig()
        .then(config => {
          const { TAPESTRY_GITHUB_PROJECT: project, TAPESTRY_BUILD_STR: buildStr } = process.env;
          if (!project)
            return Promise.reject(new Error("env var TAPESTRY_GITHUB_PROJECT **MUST** be set"));

          const db = monk(config.deployments.mongodbOptions);
          const api = loadGithubApi(config.github.accessToken);
          const manager = new StatusManager(project, buildStr, db, api, config);
          const res = Object.assign(
            { config, project, buildStr, db, api, manager },
            _buildInfo.create.fromBuildStr(buildStr)
          );
          _promise = Promise.resolve(res); // overwrite us with a no-op
          logger.log("StatusManager Ready!");
          return res;
        })
        .catch(e => {
          console.error(
            "FATAL ERROR: Tapestry could not initialize status updates engine",
            e.stack
          );
          process.exit(127);
        });
    }

    return _promise;
  };

  return _init;
}

const _buildExp = (_exports, method) =>
  Object.assign(_exports, {
    [method]: (...a) => INIT().then(({ manager }) => manager[method](...a)),
  });

const renderMarkdown = rec => StatusManager.markdownSummary(rec);

module.exports = "sendStarted sendFinished sendFailed sendStatus sendError load"
  .split(/\s+/)
  .reduce(_buildExp, {});
module.exports.renderMarkdown = renderMarkdown;

// module.exports = {
//   sendStarted: (...args) => INIT().then(({ manager }) => manager.sendStarted(...args)),
//   sendFinished: (...args) => INIT().then(({ manager }) => manager.sendFinished(...args)),
//   sendFailed: (...args) => INIT().then(({ manager }) => manager.sendFailed(...args)),
//   sendStatus: (...args) => INIT().then(({ manager }) => manager.sendStatus(...args)),
//   sendError: (...args) => INIT().then(({ manager }) => manager.sendError(...args)),
// };
