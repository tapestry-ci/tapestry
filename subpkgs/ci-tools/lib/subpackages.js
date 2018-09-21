"use strict";

const tempfile = require("tempfile");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const tapUtil = require("@tapestry-ci/util");
const SP = dir => tapUtil.subpackages.init(dir);
const logger = require("./custom-logger").logger("util:subpackages");
const artifacts = require("./artifacts");

// const statusUpdate = require("./status-update");
// tapUtil.subpackages.sendEventsTo(msg => statusUpdate.sendStatus(`[subpackage] ${msg}`));

const SUBPACKAGES_ARTIFACT = ["Tapestry", "Sub-Packages.json"];

const PKGRUN_DEFAULTS = { required: false, parallel: true, hooks: undefined, hookOpts: undefined };

const getPackages = dir => SP(dir).getPackages();

const _save = (dir, id, obj = {}) =>
  Object.assign({}, obj, { saveOutput: { id, dir: artifacts.getPath("Shell-Commands") } });
const scrub = str =>
  str
    .replace(/^([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "")
    .replace(/(^-+|-+$)/g, "");
const doDevInstalls = dir => {
  const buildEnv = process.env.TAPESTRY_ENV === "none" ? "local" : process.env.TAPESTRY_ENV;
  return SP(dir).devInstall(_save(dir, "dev-install"), true, buildEnv);
};
const doProdInstalls = dir => SP(dir).prodInstall(_save(dir, "prod-install"));
const runInstrumentation = dir => SP(dir).test(false, false, _save(dir, "run-tests"));
const doBuilds = (dir, env) => SP(dir).build(false, false, env, _save(dir, "run-builds"));
const runPackageRunScript = (dir, name, opts = PKGRUN_DEFAULTS) =>
  SP(dir).executeRunScript(
    name,
    opts.required,
    opts.parallel,
    _save(dir, `run-${scrub(name)}`, { execOpts: opts.execOpts || undefined }),
    opts.hooks || undefined,
    opts.hookOpts || undefined
  );
const cleanNodeModules = dir => SP(dir).cleanNodeModules();
const buildEnvVars = (dir, env) => SP(dir).buildEnvVars(env);
const priorityWorker = (dir, worker) => SP(dir).priorityWorker(worker);
const runBeforeHook = (dir, name, opts = {}) => SP(dir).runBeforeHook(name, opts);
const runAfterHook = (dir, name, opts = {}) => SP(dir).runAfterHook(name, opts);
const runHooked = (dir, name, func, opts = {}) =>
  Promise.resolve()
    .then(() => runBeforeHook(dir, name, opts))
    .then(func)
    .then(() => runAfterHook(dir, name, opts));

const healthCheck = dir =>
  tapUtil.ciConfig().then(cfg => {
    const inf = tapUtil.buildInfo.create.fromBuildStr(process.env.TAPESTRY_BUILD_STR);
    const creds = JSON.stringify(cfg.deployCreds(inf.env));
    const env = Object.assign({}, process.env, {
      TAPESTRY_HEALTH_CHECK_DEPLOY_CREDS: creds,
      TAPESTRY_HOOK_HEALTH_CHECK_DEPLOY_CREDS: creds,
      TAPESTRY_HEALTH_CHECK_DEPLOY_ENV_NAME: inf.env,
      TAPESTRY_HOOK_HEALTH_CHECK_DEPLOY_ENV_NAME: inf.env,
    });
    const hookOpts = { env };
    const execOpts = { env };
    return SP(dir).healthCheck(execOpts, hookOpts);
  });

const publishDocs = async (dir, rec, recMd) => {
  const cfg = await tapUtil.ciConfig();
  const inf = tapUtil.buildInfo.create.fromBuildStr(process.env.TAPESTRY_BUILD_STR);
  const creds = JSON.stringify(cfg.deployCreds(inf.env));
  const brFilename = tempfile(`${process.env.TAPESTRY_BUILD_STR}-build-results.json`);
  const brmdFilename = tempfile(`${process.env.TAPESTRY_BUILD_STR}-build-results.md`);
  await fs.writeFile(brFilename, JSON.stringify(rec), "utf8");
  await fs.writeFile(brmdFilename, recMd, "utf8");

  const env = Object.assign({}, process.env, {
    TAPESTRY_PUBLISH_DOCS_DEPLOY_CREDS: creds,
    TAPESTRY_HOOK_PUBLISH_DOCS_DEPLOY_CREDS: creds,
    TAPESTRY_PUBLISH_DOCS_DEPLOY_ENV_NAME: inf.env,
    TAPESTRY_HOOK_PUBLISH_DOCS_DEPLOY_ENV_NAME: inf.env,
    TAPESTRY_PUBLISH_DOCS_BUILD_RESULTS_JSON_FILE: brFilename,
    TAPESTRY_HOOK_PUBLISH_DOCS_BUILD_RESULTS_JSON_FILE: brFilename,
    TAPESTRY_PUBLISH_DOCS_BUILD_RESULTS_MARKDOWN_FILE: brmdFilename,
    TAPESTRY_HOOK_PUBLISH_DOCS_BUILD_RESULTS_MARKDOWN_FILE: brmdFilename,
  });
  const hookOpts = { env };
  const execOpts = { env };
  return await SP(dir).publishDocs(execOpts, hookOpts);
};

const buildDocs = async (dir, rec) => {
  const inf = tapUtil.buildInfo.create.fromBuildStr(process.env.TAPESTRY_BUILD_STR);

  const env = Object.assign({}, process.env, {
    TAPESTRY_BUILD_DOCS_ENV_NAME: inf.env,
    TAPESTRY_HOOK_BUILD_DOCS_ENV_NAME: inf.env,
  });
  const hookOpts = { env };
  const execOpts = { env };
  return await SP(dir).buildDocs(execOpts, hookOpts);
};

const doMigrations = dir =>
  tapUtil.ciConfig().then(cfg => {
    const inf = tapUtil.buildInfo.create.fromBuildStr(process.env.TAPESTRY_BUILD_STR);
    const creds = JSON.stringify(cfg.deployCreds(inf.env));
    const env = Object.assign({}, process.env, {
      TAPESTRY_MIGRATIONS_DEPLOY_CREDS: creds,
      TAPESTRY_HOOK_MIGRATIONS_DEPLOY_CREDS: creds,
      TAPESTRY_MIGRATIONS_DEPLOY_ENV_NAME: inf.env,
      TAPESTRY_HOOK_MIGRATIONS_DEPLOY_ENV_NAME: inf.env,
    });
    const hookOpts = { env };
    const execOpts = { env };
    return SP(dir).doMigrations(execOpts, hookOpts);
  });

const doFinalize = (dir, rec) =>
  tapUtil.ciConfig().then(cfg => {
    const inf = tapUtil.buildInfo.create.fromBuildStr(process.env.TAPESTRY_BUILD_STR);
    const infoJson = JSON.stringify(inf);
    const statusJson = JSON.stringify(rec);

    const env = Object.assign({}, process.env, {
      TAPESTRY_FINALIZE_BUILD_MODE: inf.buildMode,
      TAPESTRY_FINALIZE_BUILD_INFO_JSON: infoJson,
      TAPESTRY_FINALIZE_BUILD_STATUS_JSON: statusJson,

      TAPESTRY_HOOK_FINALIZE_BUILD_MODE: inf.buildMode,
      TAPESTRY_HOOK_FINALIZE_BUILD_INFO_JSON: infoJson,
      TAPESTRY_HOOK_FINALIZE_BUILD_STATUS_JSON: statusJson,
    });

    if (inf.buildMode !== "test-only") {
      const creds = JSON.stringify(cfg.deployCreds(inf.env));
      env.TAPESTRY_FINALIZE_DEPLOY_CREDS = env.TAPESTRY_HOOK_FINALIZE_DEPLOY_CREDS = creds;
      env.TAPESTRY_FINALIZE_DEPLOY_ENV_NAME = env.TAPESTRY_HOOK_FINALIZE_DEPLOY_ENV_NAME = inf.env;
    }

    const hookOpts = { env };
    const execOpts = { env };
    return SP(dir).doFinalize(execOpts, hookOpts);
  });

const loadMeta = dir =>
  SP(dir)
    .getPackages()
    .then(metas => metas.reduce((memo, meta) => Object.assign(memo, { [meta.path]: meta }), {}));

const generateSubpackageMeta = (dir, unlessExists) => {
  const subprojectMetaFile = artifacts.getPath(...SUBPACKAGES_ARTIFACT);

  if (unlessExists) {
    return Promise.resolve()
      .then(() => fs.readFile(subprojectMetaFile, "utf8"))
      .then(() => logger.log(`${subprojectMetaFile} already exists!`))
      .catch(e => (e.code === "ENOENT" ? generateSubpackageMeta(dir, false) : Promise.reject(e)));
  }

  let ret = null;
  return loadMeta(dir)
    .then(data => (ret = data))
    .then(() => artifacts.save(...SUBPACKAGES_ARTIFACT, ret))
    .then(() => ret);
};

const autoLink = (dir, filterFunc) => {
  const _sp = SP(dir);
  let packages, selected;
  const filtered = (f, p) => p.filter(f).map(x => x.path);
  const getselected = filterFunc ? p => filtered(filterFunc, p) : p => "ALL";
  return Promise.resolve()
    .then(() => _sp.getPackages().then(p => (packages = p)))
    .then(() => (selected = getselected(packages)))
    .then(() => _sp.autoLink(selected));
};

module.exports = {
  getPackages,
  autoLink,
  doDevInstalls,
  doProdInstalls,
  runInstrumentation,
  doBuilds,
  runPackageRunScript,
  loadMeta,
  generateSubpackageMeta,
  buildEnvVars,
  cleanNodeModules,
  priorityWorker,
  runBeforeHook,
  runAfterHook,
  runHooked,
  doMigrations,
  healthCheck,
  buildDocs,
  publishDocs,
  doFinalize,
};
