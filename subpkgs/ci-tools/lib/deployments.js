"use strict";

const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const tapUtil = require("@tapestry-ci/util");
const readdir = require("readdir-enhanced");
const serviceSpec = require("./service-spec");
const subpackages = require("./subpackages");
const logger = require("./custom-logger").logger("util:deployments");
const artifacts = require("./artifacts");
const queen = require("prom-queen");
const path = require("path");
const minimatch = require("minimatch");
const crypto = require("crypto");
const shellExec = require("./shell-exec");
const JSZip = require("jszip");
const AWS = require("aws-sdk");
const monk = require("monk");
const pkgVersions = require("pkg-versions");
const tempfile = require("tempfile");
const _rejecto = m => Promise.reject(m instanceof Error ? m : new Error(m));
const statusUpdate = require("./status-update");
const stripAnsi = require("strip-ansi");
const prettyMs = require("pretty-ms");

const FILT_TAP_INTERNAL = x => !x.startsWith("Artifacts"); // maybe need to add more to this but this is good for now
const doesntContain = (p, seg) => p.split("/").indexOf(seg) === -1;
const ENOENT_TO_EMPTY = e => (e.code === "ENOENT" ? [] : Promise.reject(e));
const IS_DIR = s => s.isDirectory();
const IS_NOT_DIR = s => !s.isDirectory();
const IS_NOT_GIT_OR_NODE_MOD = s =>
  doesntContain(s.path, ".git") && doesntContain(s.path, "node_modules");
const NORMAL_FILES = { deep: IS_NOT_GIT_OR_NODE_MOD, filter: IS_NOT_DIR };
const NORMAL_DIRS = { deep: IS_NOT_GIT_OR_NODE_MOD, filter: IS_DIR };
const MODULE_FILES = { filter: IS_NOT_DIR, deep: true };
const MODULE_DIRS = { filter: IS_DIR, deep: true };

const getFileList = dir =>
  readdir(dir, NORMAL_FILES)
    .then(x => x.concat(".env"))
    .then(l => l.filter(FILT_TAP_INTERNAL));
const getDirList = dir => readdir(dir, NORMAL_DIRS).then(l => l.filter(FILT_TAP_INTERNAL));

const getNodeModules = dir => {
  const _filt = p => p.split("/").includes("node_modules");
  const _read = opts => readdir(dir, opts).catch(ENOENT_TO_EMPTY);
  const _proc = x => _read(x).then(l => l.filter(_filt).filter(FILT_TAP_INTERNAL));
  const _promises = [MODULE_FILES, MODULE_DIRS].map(_proc);
  return Promise.all(_promises).then(r => ({ files: r[0], dirs: r[1] }));
};

const runDelayed = (fn, tm) => new Promise(resolve => setTimeout(resolve, tm)).then(fn);

function deployAll(dir) {
  const state = {
    dir,
    fileLists: {},
    deploymentResults: {},
    deploymentErrors: [],
    publishResults: {},
    publishErrors: [],
  };
  let fullRes;
  return Promise.resolve()
    .then(() => tapUtil.ciConfig().then(cfg => (state.cfg = cfg)))
    .then(() => statusUpdate.sendStatus("Beginning deployment process"))
    .then(() => {
      logger.debug("connecting to ", state.cfg.deployments.mongodbOptions);
      state.monkClient = monk(state.cfg.deployments.mongodbOptions);
      // logger.debug("monk client", state.monkClient);
    })
    .then(() =>
      Promise.all([
        serviceSpec.loadMeta(dir).then(s => (state.spec = s)),
        subpackages.loadMeta(dir).then(s => (state.subs = s)),
        getFileList(dir).then(r => (state.allFiles = r)),
        getDirList(dir).then(r => (state.allDirs = r)),
      ])
    )
    .then(() => preparePathConfigs(state))
    .then(() => checkVersions(state))
    .then(() => doPackageDeploys(state))
    .then(() => doBundleDeploys(state))
    .then(
      () =>
        (fullRes = {
          buildReport: JSON.stringify({
            deploymentResults: state.deploymentResults,
            deploymentErrors: state.deploymentErrors,
            publishResults: state.publishResults,
            publishErrors: state.publishErrors,
          }),
        })
    )
    .then(() => {
      const _storeBuildResults = (x = {}) =>
        statusUpdate.sendStatus("build-results", { meta: Object.assign({}, fullRes, x) });
      if (state.deploymentErrors.length || state.publishErrors.length) {
        const errs = [...state.deploymentErrors, ...state.publishErrors];
        if (errs.length === 1) return Promise.reject(errs[0]);

        const msgs = JSON.stringify(errs.map(x => x.message));
        const fullError = new Error(`Encountered ${errs.length} During Deploy: ${msgs}`);
        const origStack = fullError.stack;
        fullError.stack = [origStack]
          .concat(errs.map((e, i) => `---------- Error #${i + 1}: ${e.stack}`))
          .join("\n");
        return _storeBuildResults({ hasDeploymentErrors: true }).then(() =>
          Promise.reject(fullError)
        );
      }

      return _storeBuildResults();
    })
    .then(() => Object.assign({ plan: state.bundlePlan }, fullRes));
}

function preparePathConfigs(state) {
  // since we don't know versions yet this is only for global fields
  const inf = tapUtil.buildInfo.create.fromBuildStr(process.env.TAPESTRY_BUILD_STR);
  const ctx = {
    project: state.spec.service.name,
    env: inf.env,
    buildMode: inf.buildMode,
    buildStr: process.env.TAPESTRY_BUILD_STR,
  };
  state.s3ctx = ctx;
  state.s3locs = {
    artifacts: state.cfg.s3Location("builds.artifacts", ctx),
    logs: state.cfg.s3Location("builds.logs", ctx),
    deployments: {},
  };
}

function checkVersions(state) {
  state.pkgVersions = {};
  Object.keys(state.subs).forEach(key => {
    const pkg = state.subs[key];
    state.pkgVersions[pkg.json.name] = pkg.json.version;
  });
  return Promise.resolve();
}

function filematches(files, dir, patterns) {
  const dirslash = dir === "" ? "" : `${dir}/`;
  const nixdirslash = z => z.replace(dirslash, "");
  const matches = f => f.startsWith(dirslash) && patterns.find(p => minimatch(nixdirslash(f), p));
  return files
    .filter(matches)
    .map(nixdirslash)
    .sort();
}

function doPackageDeploys(state) {
  const D = state.spec.deployments;
  const packageTypes = Object.keys(D)
    .filter(n => D[n].type === "npm")
    .sort();

  return Promise.resolve()
    .then(() => getPackagePlan(state, packageTypes))
    .then(() => reportPackagePlan(state))
    .then(() => publishNpmModules(state));
}

function getPackagePlan(state, deplNames) {
  const D = state.spec.deployments;
  const getPriority = name => D[name].package.priority;
  const isNpm = name => D[name].type === "npm";
  const packageTypes = Object.keys(D).filter(isNpm);
  state.packagePlan = {};

  const pkgNameToDeplName = packageTypes.reduce(
    (m, x) => Object.assign(m, { [D[x].package.name]: x }),
    {}
  );

  // @TODO there's some overlap here between packageplan/bundleplan generation that could be refactored.
  // would need to be carefully done since there's some mild differences between the two types of deployments.
  // one being that we use the tapUtil.priorityWorker to make sure dependencies get covered
  const worker = name => {
    const def = D[name];
    const pkg = def.package;

    const rootDir = path.resolve(state.dir, def.root);
    const files = filematches(state.allFiles, def.root, def.files);

    state.fileLists[name] = files;

    def.deploymentId = `${state.spec.service.name}:${def.type}:${def.name}`;
    def.env = process.env.TAPESTRY_ENV;
    def.buildStr = process.env.TAPESTRY_BUILD_STR;
    def.publishRegistry =
      def.publishRegistry ||
      state.spec.service.publishRegistry ||
      state.cfg.publishRegistry ||
      "https://registry.npmjs.org/";

    const manager = getDeploymentManager(state, def);

    const mkPlan = (shouldDeploy, version) => {
      state.packagePlan[name] = { deploymentId: def.deploymentId, version, shouldDeploy };
    };

    const create = () =>
      fetchNpmVersionList(pkg.json.name)
        .then(extra =>
          manager.createNextVersion(def.autoversion, def.env, def.buildStr, def.fingerprint, extra)
        )
        .then(v => {
          logger.log(`[${name}] created new version`, v);
          return v;
        });

    logger.log(`Checking current deployment status of ${name}`);

    // this ensures that if any package changes, any package that depends on it also gets a new publish with the new exact version.
    // note that the actual fingerprinted version of this package's own package.json is before these exact versions have been edited in
    // (ie it's fingerprinted against it's dev/repo status).

    const depHash = pkgName => {
      const deplName = pkgNameToDeplName[pkgName];
      const version = state.packagePlan[deplName].version.shortVersion;
      const sig = state.packagePlan[deplName].fingerprint;
      return `<<npm-dependency:${pkgName}@${version}:${sig}>>\n`;
    };

    const codeSigPrepends = Object.keys(pkg.locals)
      .sort()
      .reduce((m, x) => [...m, depHash(x)], []);

    const fixedDeps = Object.keys(pkg.locals).reduce((m, pkgName) => {
      const deplName = pkgNameToDeplName[pkgName];
      const depPlan = state.packagePlan[deplName];
      return Object.assign(m, {
        [deplName]: { pkgName: depPlan.package.name, version: depPlan.version.shortVersion },
      });
    }, {});

    return Promise.resolve()
      .then(() => codeSig(rootDir, files, codeSigPrepends).then(sig => (def.fingerprint = sig)))
      .then(() => manager.checkLatest(def.autoversion, def.env))
      .then(res => {
        const latest = res.latestDeployed;
        if (latest && latest.fingerprint === def.fingerprint) {
          logger.log(
            `[${name}] skip-deploy: current-source and latest-deployed fingerprints are both ${
              def.fingerprint
            }`
          );
          mkPlan(false, latest);
          return Promise.resolve();
        }
        const sigs = `${def.fingerprint}/${latest ? latest.fingerprint : "no-deployed-version"}`;
        logger.log(
          `[${name}] code fingerprints don't match (${sigs}), creating new version for environment ${
            def.env
          } in ${def.autoversion} line...`
        );
        return create().then(next => mkPlan(true, next));
      })
      .then(() => {
        const plan = state.packagePlan[name];
        plan.env = process.env.TAPESTRY_ENV;
        const _distTag = def.environmentNpmDistTags[plan.env];
        const distTag = typeof _distTag === "undefined" ? plan.env : _distTag;
        plan.npmDistTag = distTag.replace(/\W+/g, "");
        plan.dependencyVersions = fixedDeps;
        plan.priority = def.priority;
        state.packagePlan[name] = Object.assign({}, def, plan);
        // we leave the .package field in for packagePlan (in contrast to bundlePlan, which deletes the field from the plan object)
      });
  };

  return tapUtil.priorityWorker(packageTypes, worker, 4, getPriority);
}

function fetchNpmVersionList(name) {
  return (
    pkgVersions(name)
      .then(res => [...res])
      // turn error for unpublished packages into []
      .catch(e => (/doesn't exist/.test(e.message) ? [] : Promise.reject(e)))
  );
}

function reportPackagePlan(state) {
  Object.keys(state.packagePlan).forEach(name => {
    const plan = state.packagePlan[name];
    const inf = {
      version: {
        full: plan.version.fullVersion,
        short: plan.version.shortVersion,
        target: plan.version.targetVersion,
      },
      deploymentId: plan.deploymentId,
      fingerprint: plan.version.fingerprint,
      buildStr: process.env.TAPESTRY_BUILD_STR,
    };
    const msg = `NPM:${name} ${
      plan.shouldDeploy ? "WILL BE PUBLISHED" : "does not need to be published"
    }`;
    logger.log(msg, inf);
  });

  return artifacts.save("Deployments", "package-plan.json", state.packagePlan);
}

function publishNpmModules(state) {
  const P = state.packagePlan;
  const getPriority = name => P[name].priority;
  const names = Object.keys(state.packagePlan);
  let published = false;

  const copyFiles = (inDir, outDir, flist) =>
    queen.sequential(flist, file => {
      const srcPath = path.resolve(inDir, file);
      const dstPath = path.resolve(outDir, file);
      const dstDir = path.dirname(dstPath);
      let stat;
      return Promise.resolve()
        .then(() => fs.stat(srcPath).then(s => (stat = s)))
        .then(() => fs.mkdirRecursive(dstDir))
        .then(() => fs.copy(srcPath, dstPath))
        .then(() => fs.chmod(dstPath, stat.mode));
    });

  const worker = name => {
    const plan = P[name];
    if (!plan.shouldDeploy) {
      state.publishResults[name] = { status: "skipped", plan };
      logger.log(`Skipping publish of ${name} -- publish not needed!`);
      return Promise.resolve();
    }

    const srcDir = path.resolve(state.dir, plan.package.dir);
    const slug = plan.deploymentId.replace(/:/g, "___"); // colons can be weird
    const workDir = tempfile(`.${slug}`);
    const dstPkg = path.resolve(workDir, "package.json");
    const manager = getDeploymentManager(state, state.spec.deployments[name]);
    const publishArgs = `--tag ${plan.npmDistTag} --registry ${plan.publishRegistry}`;
    let finalPkgJsonContents;

    const hookOpts = {
      env: {
        TAPESTRY_HOOK_PUBLISH_VERSION: plan.version.shortVersion,
        TAPESTRY_HOOK_PUBLISH_DIST_TAG: plan.npmDistTag,
      },
    };

    return Promise.resolve()
      .then(() => statusUpdate.sendStatus(`starting npm publish of ${name} v${plan.version}`))
      .then(() => fs.mkdirRecursive(workDir))
      .then(() => copyFiles(srcDir, workDir, state.fileLists[name]))
      .then(() => fs.readFile(dstPkg, "utf8").then(JSON.parse))
      .then(json => addRealDependencyVersions(json, plan.version, plan.dependencyVersions))
      .then(json => applyExtraMetadata(json, plan, name))
      .then(json => (finalPkgJsonContents = json))
      .then(json => fs.writeFile(dstPkg, JSON.stringify(json, null, 2), "utf8"))
      .then(() => tapUtil.hooks.runBeforeHook(srcDir, "publish", hookOpts))
      .then(() => shellExec.exec(`npm publish ${workDir} ${publishArgs}`, workDir))
      .then(() => waitForNpmVersion(finalPkgJsonContents))
      .then(r => (state.publishResults[name] = { status: "published", plan }))
      .then(() => manager.recordDeploymentSuccess(plan.version))
      .then(() => (published = true))
      .then(() => tapUtil.hooks.runAfterHook(srcDir, "publish", hookOpts))
      .then(() => statusUpdate.sendStatus(`successfully published ${name} v${plan.version}`))
      .catch(e => {
        state.publishErrors.push(e);
        state.publishResults[name] = { status: "error", plan, error: e.stack };
        logger.error(`An error occurred while publishing ${name}`, e);
        return manager
          .recordDeploymentFailure(plan.version, e)
          .then(() =>
            statusUpdate.sendError(`error during npm publish of ${name} v${plan.version}`, e)
          );
      });
  };

  return tapUtil.priorityWorker(names, worker, 4, getPriority).then(results => {
    //@TODO: this shouldn't be necessary anymore thanks to waitForNpmVersion. evaluate truth of prior statement and potentially remove later.
    if (published) return new Promise(r => setTimeout(r, 30 * 1000, results));
    return results;
  });
}

function waitForNpmVersion(packageJson) {
  // checks every 10 seconds for up to 2 minutes
  const DELAY = 1000 * 10;
  const MAX_DELAY = 1000 * 60 * 4;

  const START = Date.now();
  const pkgspec = `${packageJson.name}@${packageJson.version}`;
  const pkgdesc = `[ ${packageJson.name} @ ${packageJson.version} ]`;

  const isValid = r => {
    if (!r.stdout || !r.stdout.length) return false;
    try {
      const json = JSON.parse(r.stdout);
      return json.version === packageJson.version;
    } catch (e) {
      return false;
    }
  };

  const errTooLong = t => _rejecto(`waited ${prettyMs(t)} and never saw ${pkgdesc}`);
  const checkTime = t => (t > MAX_DELAY ? errTooLong(t) : Promise.resolve());
  const fin = r => {
    const x = JSON.parse(r.stdout);
    logger.log(`found ${pkgdesc} : ${x.fullVersion} @ ${x.time[x.version]}`);
    return Promise.resolve(x);
  };

  const here = process.cwd(); // any dir is fine for this
  const go = () =>
    checkTime(Date.now() - START)
      .then(() => logger.log(`Checking to see if ${pkgdesc} is fully published`))
      .then(() => shellExec.exec(`npm view ${pkgspec} --json`, here, { quiet: true }))
      .then(r => (isValid(r) ? fin(r) : queen.delayed(DELAY).then(go)));

  return go();
}

function addRealDependencyVersions(pkgJson, myVersion, deps) {
  pkgJson.shortVersion = pkgJson.version = myVersion.shortVersion;
  pkgJson.fullVersion = myVersion.fullVersion;
  pkgJson.versionInfo = myVersion;
  Object.keys(deps).forEach(deplName => {
    const { pkgName, version } = deps[deplName];
    ["dependencies", "devDependencies", "peerDependencies"].forEach(depField => {
      if ((pkgJson[depField] || {})[pkgName]) pkgJson[depField][pkgName] = version;
    });
  });
  return pkgJson;
}

function applyExtraMetadata(pkgJson, plan, deplName) {
  const override = plan.packageJsonName;
  const curname = pkgJson.name;
  logger.log("APPLY METADATA", plan, deplName);
  if (override && curname !== override) {
    logger.log(`${deplName} : override package.json name : ${curname} -> ${override}`);
    pkgJson.name = plan.packageJsonName;
  }
  return pkgJson;
}

function doBundleDeploys(state) {
  if (state.publishErrors.length) {
    // no-op here, an error will be thrown after we execute. something went wrong during a package deploy.
    logger.log("SKIPPING BUNDLE DEPLOYS! SOMETHING WENT WRONG DURING PACKAGE DEPLOYS.");
    return Promise.resolve();
  }

  const D = state.spec.deployments;
  const plan = (state.bundlePlan = {});
  const bundleTypes = Object.keys(D).filter(n => D[n].type !== "npm");
  return (
    Promise.resolve()
      // figure out what needs to be deployed first
      .then(() => queen.parallel(bundleTypes, k => getBundlePlan(state, k, D[k])))
      .then(() => reportBundlePlan(state))
      // sequential here represents failure :( stupid cloudformation/serverless ruining everything
      .then(() => queen.sequential(bundleTypes, k => doBundleDeploy(state, k, D[k], plan[k])))
  );
}

function reportBundlePlan(state) {
  Object.keys(state.bundlePlan).forEach(name => {
    const plan = state.bundlePlan[name];
    const inf = {
      version: {
        full: plan.version.fullVersion,
        short: plan.version.shortVersion,
        target: plan.version.targetVersion,
      },
      deploymentId: plan.deploymentId,
      fingerprint: plan.version.fingerprint,
      buildStr: process.env.TAPESTRY_BUILD_STR,
    };
    const msg = `Deployment:${name} ${
      plan.shouldDeploy ? "WILL BE DEPLOYED" : "does not need to be deployed"
    }`;
    logger.log(msg, inf);
  });

  return artifacts.save("Deployments", "bundle-plan.json", state.bundlePlan);
}

function getBundlePlan(state, name, def) {
  const rootDir = path.resolve(state.dir, def.root);
  const files = filematches(state.allFiles, def.root, def.files);

  state.fileLists[name] = files;

  def.deploymentId = `${state.spec.service.name}:${def.type}:${def.name}`;
  def.env = process.env.TAPESTRY_ENV;
  def.buildStr = process.env.TAPESTRY_BUILD_STR;
  const manager = getDeploymentManager(state, def);

  const mkPlan = (deploy, vrec) => {
    state.bundlePlan[name] = {
      deploymentId: def.deploymentId,
      version: vrec,
      shouldDeploy: deploy,
    };
  };
  const create = () =>
    manager.createNextVersion(def.autoversion, def.env, def.buildStr, def.fingerprint).then(v => {
      logger.log(`[${name}] created new version`, v);
      return v;
    });

  logger.log(`Checking current deployment status of ${name}`);

  let codeSigPrepends = [];
  let fixedDeps = {};

  if (def.packageJson) {
    const pkg = def.package;
    const D = state.spec.deployments;
    const isNpm = name => D[name].type === "npm";
    const packageTypes = Object.keys(D)
      .filter(isNpm)
      .sort();
    const pkgNameToDeplName = packageTypes.reduce(
      (m, x) => Object.assign(m, { [D[x].package.name]: x }),
      {}
    );

    const depHash = pkgName => {
      const deplName = pkgNameToDeplName[pkgName];
      const version = state.packagePlan[deplName].version.shortVersion;
      const sig = state.packagePlan[deplName].fingerprint;
      return `<<npm-dependency:${pkgName}@${version}:${sig}>>\n`;
    };

    codeSigPrepends = Object.keys(pkg.locals)
      .sort()
      .reduce((m, x) => [...m, depHash(x)], []);

    fixedDeps = Object.keys(pkg.locals).reduce((m, pkgName) => {
      const deplName = pkgNameToDeplName[pkgName];
      const depPlan = state.packagePlan[deplName];
      return Object.assign(m, {
        [deplName]: { pkgName: depPlan.package.name, version: depPlan.version.shortVersion },
      });
    }, {});
  }

  return Promise.resolve()
    .then(() => codeSig(rootDir, files, codeSigPrepends).then(sig => (def.fingerprint = sig)))
    .then(() => manager.checkLatest(def.autoversion, def.env))
    .then(res => {
      const latest = res.latestDeployed;
      if (latest && latest.fingerprint === def.fingerprint) {
        logger.log(
          `[${name}] skip-deploy: current-source and latest-deployed fingerprints are both ${
            def.fingerprint
          }`
        );
        mkPlan(false, latest);
        return Promise.resolve();
      }
      const sigs = `${def.fingerprint}/${latest ? latest.fingerprint : "no-deployed-version"}`;
      logger.log(
        `[${name}] code fingerprints don't match (${sigs}), creating new version for environment ${
          def.env
        } in ${def.autoversion} line...`
      );
      return create().then(next => mkPlan(true, next));
    })
    .then(() => {
      const plan = state.bundlePlan[name];
      const defCtx = {
        deployment: name,
        fullVersion: plan.version.fullVersion,
        shortVersion: plan.version.shortVersion,
        bundleName: `${state.spec.service.name}`,
        project: state.spec.service.name,
        env: def.env,
        buildStr: process.env.TAPESTRY_BUILD_STR,
      };
      const locs = {
        bundle: state.cfg.s3Location("deployment.bundles", defCtx),
        plan: state.cfg.s3Location("deployment.plan", defCtx),
      };
      if (def.type === "electron") {
        locs.autoupdate = state.cfg.s3Location("deployment.autoupdate", defCtx); // this value is actually for electron but doesn't change per-platform
        const enabled = x => def.platforms.includes(x);
        const extForPlatform = { mac: "dmg", win: "exe", linux: "deb" }; // assuming if we ever have linux ones we'll want debian packages? might have to make this more special later. autoupdate thingy doesnt support linux yet so kinda moot
        const getPlatCtx = platform =>
          Object.assign({ platform, deploymentExtension: extForPlatform[platform] }, defCtx);
        ["mac", "win", "linux"].filter(enabled).forEach(platform => {
          const platCtx = getPlatCtx(platform);
          locs[platform] = {
            distribution: state.cfg.s3Location("deployment.electron.distribution", platCtx),
          };
        });
      }

      plan.s3locs = state.s3locs.deployments[name] = locs;
      plan.dependencyVersions = fixedDeps;

      const rgx = /\.env-[A-Za-z0-9_-]+$/;
      const isOverride = k => rgx.test(k);
      const isNormal = k => !isOverride(k);
      const skip = ["package"];

      Object.keys(def)
        .filter(k => isNormal && !skip.includes(k))
        .forEach(key => {
          if (typeof plan[key] !== "undefined") return;

          const overrideEnvKey = `${key}.env-${def.env}`;
          if (def[overrideEnvKey]) return (plan[key] = def[overrideEnvKey]);

          plan[key] = def[key];
        });

      Object.keys(def)
        .filter(isOverride)
        .forEach(k => {
          const suff = `.env-${def.env}`;
          if (!k.endsWith(suff)) return;
          const baseKey = k.slice(0, -suff.length);
          plan[baseKey] = def[k];
        });

      delete plan.package;

      logger.debug(`${def.deploymentId} plan:`, plan);
    });
}

function doBundleDeploy(state, name, def, plan) {
  if (!plan.shouldDeploy) {
    logger.log(`Skipping deploy of ${name} -- deploy not needed!`);
    state.deploymentResults[name] = { status: "skipped", plan };
    return Promise.resolve();
  }

  if (def.type === "npm") {
    logger.log(`npm deploy skipped for ${name}`);
    return Promise.resolve();
  }

  if (def.type === "serverless") return doServerlessDeploy(state, name, def, plan);

  if (def.type === "electron") return doElectronDeploy(state, name, def, plan);

  if (def.type === "elasticbeanstalk") return doElasticBeanstalkDeploy(state, name, def, plan);

  return Promise.reject(
    new Error(`bundle-deploy of type ${def.type} is unsupported: ${JSON.stringify(def)}`)
  );
}

function liveEditBundlePackage(state, name, def, plan, absroot, addDeps) {
  const pkgFile = path.resolve(absroot, "package.json");
  return Promise.resolve()
    .then(() => fs.stat(pkgFile).catch(e => (e.code === "ENOENT" ? null : Promise.reject(e))))
    .then(
      stat =>
        stat
          ? Promise.resolve()
              .then(() => fs.readFile(pkgFile, "utf8").then(JSON.parse))
              .then(
                data =>
                  addDeps
                    ? addRealDependencyVersions(data, plan.version, plan.dependencyVersions)
                    : Promise.resolve(data)
              )
              .then(data => applyExtraMetadata(data, plan, name))
              .then(data => fs.writeFile(pkgFile, JSON.stringify(data, null, 2), "utf8"))
          : null
    );
}

function bundleDeployHelper(state, name, def, plan, type, opts = { deps: true }, worker) {
  logger.log(`Beginning ${type} deploy for ${name}`);
  let zip;
  const absroot = path.resolve(state.dir, def.root);
  const manager = getDeploymentManager(state, def);

  const hookOpts = {
    env: {
      TAPESTRY_HOOK_DEPLOY_ENV_NAME: plan.env,
      TAPESTRY_HOOK_DEPLOY_DEPLOYMENT_ID: plan.deploymentId,
      TAPESTRY_HOOK_DEPLOY_VERSION: plan.version.shortVersion,
      TAPESTRY_HOOK_DEPLOY_TYPE: type,
      TAPESTRY_HOOK_DEPLOY_S3_BUNDLE_PATH: plan.s3locs.bundle,
      TAPESTRY_HOOK_DEPLOY_S3_PLAN_PATH: plan.s3locs.plan,
      TAPESTRY_HOOK_DEPLOY_CREDENTIALS: JSON.stringify(state.cfg.deployCreds(plan.env)),
    },
    saveOutput: {
      dir: artifacts.getPath("Shell-Commands"),
      id: "deploy-hooks",
    },
  };

  return Promise.resolve()
    .then(() => statusUpdate.sendStatus(`beginning ${type} deploy of ${name}`))
    .then(() => liveEditBundlePackage(state, name, def, plan, absroot, opts.deps))
    .then(() => (opts.deps ? prodInstall(state, name) : Promise.resolve()))
    .then(() => bundle(state, absroot, name, def, plan, opts)) // if opts gets more complex might need to be cleaner about this but right now it only has deps field
    .then(z => (zip = z))
    .then(() => uploadToS3(state, zip, plan.s3locs.bundle))
    .then(() => uploadPlanToS3(state, plan, plan.s3locs.plan))
    .then(() => tapUtil.hooks.runBeforeHook(absroot, "deploy", hookOpts))
    .then(() => worker(zip))
    .then(() => {
      logger.log(`${name} deployed successfully`);
      return manager
        .recordDeploymentSuccess(plan.version)
        .then(() => statusUpdate.sendStatus(`successfully deployed ${name} (${type})`))
        .then(r => (state.deploymentResults[name] = { status: "deployed", plan }));
    })
    .then(() => tapUtil.hooks.runAfterHook(absroot, "deploy", hookOpts))
    .catch(e => {
      state.deploymentErrors.push(e);
      logger.error(`An error occurred while deploying ${name}`, e);
      return manager
        .recordDeploymentFailure(plan.version, e)
        .then(() => statusUpdate.sendError(`deploy failed for ${name} (serverless)`, e))
        .then(r => (state.deploymentResults[name] = { status: "error", plan, error: e }));
    });
}

function prepServerlessRoot(state) {
  if (state.serverlessDir) return Promise.resolve();

  const slsdir = tempfile(".serverless-build");
  const slsnm = path.resolve(slsdir, "node_modules");
  const mynm = path.resolve(__dirname, "../node_modules");

  state.serverlessBin = path.resolve(mynm, "serverless", "bin", "serverless"); // doesnt like it when we call via the symlink

  return Promise.resolve()
    .then(() => fs.mkdirRecursive(slsdir))
    .then(() => fs.symlink(mynm, slsnm))
    .then(() => (state.serverlessDir = slsdir));
}

function doServerlessDeploy(state, name, def, plan) {
  const srcdir = path.resolve(state.dir, def.root);
  const manager = getDeploymentManager(state, def);
  let dstdir, pkgFile;
  const did = plan.deploymentId.replace(/:/g, "___");

  const hookOpts = {
    env: {
      TAPESTRY_HOOK_DEPLOY_ENV_NAME: plan.env,
      TAPESTRY_HOOK_DEPLOY_DEPLOYMENT_ID: plan.deploymentId,
      TAPESTRY_HOOK_DEPLOY_VERSION: plan.version.shortVersion,
      TAPESTRY_HOOK_DEPLOY_TYPE: "serverless",
      TAPESTRY_HOOK_DEPLOY_CREDENTIALS: JSON.stringify(state.cfg.deployCreds(plan.env)),
    },
    saveOutput: {
      dir: artifacts.getPath("Shell-Commands"),
      id: "deploy-hooks",
    },
  };

  return Promise.resolve() // this doesn't use the bundle deploy helper
    .then(() => statusUpdate.sendStatus(`beginning serverless deploy of ${name}`))
    .then(() => prepServerlessRoot(state))
    .then(() => (dstdir = path.resolve(state.serverlessDir, did)))
    .then(() => (pkgFile = path.resolve(dstdir, "package.json")))
    .then(() => fs.copyRecursive(srcdir, dstdir))
    .then(
      () =>
        plan.packageJson
          ? Promise.resolve()
              .then(() => fs.readFile(pkgFile, "utf8").then(JSON.parse))
              .then(data => addRealDependencyVersions(data, plan.version, plan.dependencyVersions))
              .then(data => applyExtraMetadata(data, plan, name))
              .then(data => fs.writeFile(pkgFile, JSON.stringify(data, null, 2), "utf8"))
          : Promise.resolve()
    )
    .then(() => tapUtil.hooks.runBeforeHook(srcdir, "deploy", hookOpts))
    .then(() => {
      logger.log(`Installing production dependencies for ${name}`);
      return shellExec.exec("npm install --production", dstdir);
    })
    .then(() => {
      const creds = state.cfg.deployCreds(plan.env);
      const deploymentEnvVars = {
        AWS_ACCESS_KEY_ID: creds.access,
        AWS_SECRET_ACCESS_KEY: creds.secret,
        AWS_REGION: creds.region,
        AWS_DEFAULT_REGION: creds.region,
      };

      const stageArgs = `--stage ${plan.env === "development" ? "dev" : plan.env}`;
      const cmd = `${state.serverlessBin} deploy ${stageArgs}`;
      const execOpts = {
        env: deploymentEnvVars,
        dir: dstdir,
      };

      logger.log(`Attempting serverless deploy of ${plan.deploymentId}`);
      return Promise.resolve()
        .then(() => tapUtil.executor.exec(cmd, execOpts))
        .then(() => doServerlessPrune(state, name, def, plan, stageArgs, execOpts, creds));
    })
    .then(() => {
      logger.log(`${name} deployed successfully!`);
      return manager
        .recordDeploymentSuccess(plan.version)
        .then(() => statusUpdate.sendStatus(`successfully deployed ${name} (serverless)`))
        .then(r => (state.deploymentResults[name] = { status: "deployed", plan }));
    })
    .then(() => tapUtil.hooks.runAfterHook(srcdir, "deploy", hookOpts))
    .catch(e => {
      state.deploymentErrors.push(e);
      logger.error(`An error occurred while deploying ${name}`, e);
      return manager
        .recordDeploymentFailure(plan.version, e)
        .then(() => statusUpdate.sendError(`deploy failed for ${name} (serverless)`, e))
        .then(r => (state.deploymentResults[name] = { status: "error", plan, error: e }));
    });
}

function doServerlessPrune(state, name, def, plan, stageArgs, execOpts, creds) {
  logger.log(`Pruning old lambda versions for ${name}`);
  const cmd = `${state.serverlessBin} info ${stageArgs}`;
  const bad = [];

  const region = state.cfg.region;
  const lambda = new AWS.Lambda({
    region,
    accessKeyId: creds.access,
    secretAccessKey: creds.secret,
  });

  const handleError = x => e =>
    logger.error(
      `pruning error${
        x ? ` (${JSON.stringify(x)})` : ""
      }. You may want to prune manually if the problem persists. (${
        e && "message" in e ? e.message : e
      })`,
      e
    );

  const versionsToKeep = plan.keepOldVersionsCount ? Number(plan.keepOldVersionsCount) : 0;

  const filterVersions = list =>
    list
      .filter(x => x.Version !== "$LATEST")
      .sort((b, a) => new Date(a.LastModified) - new Date(b.LastModified))
      .slice(versionsToKeep);

  const getVersionsToPrune = fn =>
    getLambdaVersions(lambda, fn)
      .then(lst => filterVersions(lst))
      .then(lst => {
        logger.log(`versions list for ${fn}`, lst.map(x => x.Version));
        return lst;
      })
      .then(lst => bad.push(...lst.map(x => ({ FunctionName: fn, Qualifier: x.Version }))))
      .catch(handleError({ function: fn }));

  const pruneVersion = params => {
    logger.log(`pruning lambda ${params.FunctionName} @ version:${params.Qualifier}`);
    return queen
      .delayed(250)
      .then(() => lambda.deleteFunction(params).promise())
      .catch(handleError(params));
  };

  return Promise.resolve()
    .then(() => tapUtil.executor.exec(cmd, execOpts))
    .then(results => stripAnsi(results.stdout))
    .then(results => {
      logger.log("serverless info output", results);
      const funcs = [];
      let sect, parts, inFuncs;
      results
        .split("\n")
        .filter(x => !!x.length)
        .forEach(line => {
          if ((sect = /^(\w+):/.exec(line))) return (inFuncs = !!(sect[1] === "functions"));
          if (inFuncs && (parts = /^\s+([^:\s]+): (.+)$/.exec(line))) funcs.push(parts[2]);
        });
      logger.log("functions to check", funcs);
      return funcs;
    })
    .then(fns => queen.sequential(fns, getVersionsToPrune))
    .then(() => queen.sequential(bad, pruneVersion))
    .catch(handleError());
}

function getLambdaVersions(lambda, name, next, list = []) {
  const params = { FunctionName: name };
  if (next) params.Marker = next;

  return queen
    .delayed(250)
    .then(() => lambda.listVersionsByFunction(params).promise())
    .then(data => {
      list.push(...data.Versions);
      if (data.NextMarker) return getVersions(name, data.NextMarker, list);
      return list;
    });
}

function doElectronDeploy(state, name, def, plan) {
  const manager = getDeploymentManager(state, def);
  const buildJob = manager.buildJobForCI(plan.version.fullVersion);
  const prefix = `[electron-deploy: ${def.deploymentId}]`;
  const sendSQS = () => {
    const sqs = new AWS.SQS({ region: state.cfg.region });
    const message = {
      deploymentId: def.deploymentId,
      fullVersion: plan.version.fullVersion,
      plan: plan.s3locs.plan,
      zip: plan.s3locs.bundle,
    };
    const params = {
      MessageBody: JSON.stringify(message),
      QueueUrl: state.cfg.deployments.electronDeploymentSQSQueue,
    };
    return sqs.sendMessage(params).promise();
  };
  const worker = localZip =>
    Promise.resolve()
      .then(() => logger.log(`${prefix} Creating remote build job for electron build`))
      .then(() => statusUpdate.sendStatus(`starting electron build-job for ${name}`))
      .then(() => buildJob.create(plan.version))
      .then(() => logger.log(`${prefix} sending build request to SQS`))
      .then(() => sendSQS())
      .then(() => logger.log(`${prefix} Waiting for remote build job to finish`))
      .then(() => buildJob.wait())
      .then(job => {
        if (job.success) {
          logger.log(`${prefix} Build Finished Successfully`, job);
          return statusUpdate.sendStatus(`successfully built / deployed ${name}`);
        }
        logger.log(`${prefix} Build Error`, job);
        const error = new Error(`${prefix} Remote build job failed with error: ${job.error}`);
        return statusUpdate
          .sendError(`deploy failed for ${name} (serverless)`, error)
          .then(() => Promise.reject(error));
      });

  const opts = { deps: false };
  return bundleDeployHelper(state, name, def, plan, "electron", opts, worker);
}

function doElasticBeanstalkDeploy(state, name, def, plan) {
  const creds = state.cfg.deployCreds(plan.env);

  const awsOpts = {
    region: creds.region,
    accessKeyId: creds.access,
    secretAccessKey: creds.secret,
  };
  const ebstalk = new AWS.ElasticBeanstalk(awsOpts);
  const vlabel = `v${plan.version.shortVersion}`;

  const opts = { deps: true };

  const { Bucket, Key } = plan.s3locs.bundle;
  const ApplicationName = plan.applicationName;
  const EnvironmentName = plan.environmentName;
  const VersionLabel = vlabel;
  const VersionLabels = [vlabel];

  const createParams = {
    ApplicationName,
    VersionLabel,
    AutoCreateApplication: false,
    Description: `${def.deploymentId} v${plan.version.fullVersion} [via tapestry]`,
    Process: true,
    SourceBundle: { S3Bucket: Bucket, S3Key: Key },
  };

  const updateParams = { EnvironmentName, ApplicationName, VersionLabel };

  const descParams = { ApplicationName, VersionLabels };

  const showRes = lbl => r => {
    logger.info(`[${def.deploymentId}] ${lbl} result`, r);
    return r;
  };

  const waiter = () => {
    const _check = () => ebstalk.describeApplicationVersions(descParams).promise();

    const _go = () =>
      _check()
        .then(r => r.ApplicationVersions[0])
        .then(vrec => {
          logger.debug("describe version result", vrec);
          const status = vrec.Status.toLowerCase();
          const vstr = JSON.stringify(vrec);
          if (status === "failed") return _rejecto(`deploy failed: ${vstr}`);
          if (status === "unprocessed") return _rejecto(`deploy unprocessed: ${vstr}`);
          if (status === "processed") return Promise.resolve();
          return runDelayed(_go, 30000);
        });

    return _go();
  };

  const worker = zip =>
    Promise.resolve()
      .then(() => logger.log(`[${def.deploymentId}] Creating application version`, createParams))
      .then(() => ebstalk.createApplicationVersion(createParams).promise())
      .then(showRes("createApplicationVersion"))
      .then(() => logger.log(`[${def.deploymentId}] waiting for new version`))
      .then(waiter)
      .then(() => logger.log("updating environment", updateParams))
      .then(() => ebstalk.updateEnvironment(updateParams).promise())
      .then(showRes("updateEnvironment"));

  return bundleDeployHelper(state, name, def, plan, "elasticbeanstalk", opts, worker);
}

function uploadToS3(state, zip, location) {
  const s3 = new AWS.S3({ region: location.region || state.cfg.region });
  const { Bucket, Key } = location;
  const Body = fs.createReadStream(zip);
  const params = { Bucket, Key, Body };
  logger.log(`uploading ${zip} to s3://${Bucket}/${Key}`);
  return s3.putObject(params).promise();
}

function uploadPlanToS3(state, plan, location) {
  const s3 = new AWS.S3({ region: location.region || state.cfg.region });
  const { Bucket, Key } = location;
  const Body = JSON.stringify(plan);
  const params = { Bucket, Key, Body };
  logger.log(`uploading deployment plan to s3://${Bucket}/${Key}`);
  return s3.putObject(params).promise();
}

function prodInstall(state, name) {
  const def = state.spec.deployments[name];
  const dir = path.resolve(state.dir, def.root);
  logger.log(`Installing production dependencies for ${name}`);
  return tapUtil.subpackages.init(dir).prodInstall(); // prod-install needs to work on any nested packages.
}

function bundle(state, dir, name, def, plan, opts = { deps: true }) {
  const dirs = {};
  const zipFile = new JSZip();
  const zipArtifact = [
    "Deployment-Bundles",
    `${def.name}-${def.env}-${plan.version.shortVersion}.zip`,
  ];

  const fperms = { unixPermissions: 0o440 };
  const dperms = { unixPermissions: 0o770 };
  const perms = s => ({ unixPermissions: s.mode });

  const tapmeta = "tapestry.meta";
  const tapmetaPlan = path.join(tapmeta, "deployment-plan.json");
  const tapmetaSpec = path.join(tapmeta, "service-spec.json");

  zipFile.folder(tapmeta, dperms);
  zipFile.file(tapmetaPlan, JSON.stringify(plan), fperms);
  zipFile.file(tapmetaSpec, JSON.stringify(state.spec), fperms);

  const worker = file => {
    let stat, data;
    const absfile = path.resolve(dir, file);
    const reldir = path.dirname(file);
    if (!dirs[reldir]) {
      zipFile.folder(reldir, dperms);
      dirs[reldir] = true;
    }
    return Promise.resolve()
      .then(() => fs.stat(absfile).then(s => (stat = s)))
      .then(() => fs.readFile(absfile).then(d => (data = d)))
      .then(() => {
        if (file === "package.json") {
          const json = JSON.parse(data.toString("utf8"));
          const edited = addRealDependencyVersions(json, plan.version, plan.dependencyVersions);
          data = Buffer.from(JSON.stringify(edited, null, 2), "utf8");
        }
      })
      .then(() => zipFile.file(file, data, perms(stat)));
  };

  logger.log(`Creating bundle from ${dir} with ${state.fileLists[name].length} files`);

  return Promise.resolve()
    .then(() => logger.log(`[bundle] [adding-files-to-zip] ${state.fileLists[name].length} files`))
    .then(() => queen.sequential(state.fileLists[name], worker))
    .then(() => {
      if (!opts.deps) return Promise.resolve();

      return getNodeModules(dir).then(res => {
        logger.log(`Adding dependencies (${res.files.length} files / ${res.dirs.length} dirs)`);
        res.dirs.forEach(dirname => {
          const _dir = dirname;
          dirs[_dir] = true;
          zipFile.folder(_dir, dperms);
        });
        return queen.sequential(res.files, worker);
      });
    })
    .then(() => logger.log(`saving ${zipArtifact.join(" / ")}`))
    .then(() => zipFile.generateAsync({ type: "nodebuffer", platform: "UNIX" }))
    .then(buf => artifacts.save(...zipArtifact, buf))
    .then(() => artifacts.getPath(...zipArtifact));
}

function getDeploymentManager(state, def) {
  logger.log("loading deployment manager for", def);
  const manager = tapUtil.deployments.manageById(
    def.deploymentId,
    state.monkClient,
    def.environmentTags
  );
  return manager;
}

function codeSig(dir, files, prepends = []) {
  const hash = crypto.createHash("sha256");
  prepends.forEach(item => hash.update(item));

  hash.update(`${JSON.stringify(files)}`);
  const worker = file => fs.readFile(path.resolve(dir, file)).then(data => hash.update(data));
  return queen.sequential(files, worker).then(() => hash.digest("hex"));
}

module.exports = { deployAll };
