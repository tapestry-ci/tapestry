#!/usr/bin/env node

"use strict";

const queen = require("prom-queen");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const del = require("del");
const path = require("path");
const tapLogger = require("./logging").utilLogger("subpkg");
const chalk = require("chalk");
const readdir = require("readdir-enhanced");
const _priorityWorker = require("./priority-worker");
const executor = require("./executor");
const envVars = require("./env-vars");
const ErrorCollector = require("./error-collector");
const hooks = require("./hooks");

const TAPSCRIPTS = {
  TEST: ["tapestry:test", "test:all", "instrument", "test"],
  BUILD: ["tapestry:build", "build:all", "build"],
  MIGRATE: ["tapestry:migrate", "migrate:all", "migrate"],
  FINALIZE: ["tapestry:finalize", "finalize:all", "finalize"],
  HEALTH: ["tapestry:health-check", "health-check:all", "health-check"],
  BUILD_DOCS: ["tapestry:build-docs", "build-docs:all", "build-docs"],
  PUBLISH_DOCS: ["tapestry:publish-docs", "publish-docs:all", "publish-docs"],
};

// let FORCE_NO_YARN = false;

const DO_INSTALLS_DEFAULTS = {
  alsoBuild: false,
  production: false,
  execOpts: null,
  maxParallel: 1,
};
const CACHE = {};

const EXTERNAL_EVENT_HANDLERS = [];

const logEvent = (msg, ...data) => tapLogger.log(msg, ...data.filter(x => !!x));
const logHelper = (pkg, msg) => `${chalk.reset.bold(msg)} ${chalk.dim(`(${pkg.dir})`)}`;
const pkgLogEvent = (pkg, msg, ...data) => logEvent(logHelper(pkg, msg), ...data);
const pkgDebugEvent = (pkg, msg, ...data) =>
  tapLogger.debug(logHelper(pkg, msg), ...data.filter(x => !!x));

const _rejecto = m => Promise.reject(new Error(m));
const _swallowENOENT = e => (e.code === "ENOENT" ? null : Promise.reject(e));
const _hasTarget = p => !!p.targetScript;
const _hasNoTarget = p => !_hasTarget(p);
const _possible = c => c.map(x => `"${x}"`).join(" or ");
const _wrongdoing = (pkg, c) => `${pkg.name} (${pkg.path}) has no script named ${_possible(c)}`;
const _enumerateWrongdoings = (p, c) =>
  p
    .filter(_hasNoTarget)
    .map(pkg => _wrongdoing(pkg, c))
    .join(". ");
const _complaint = (p, c) => _rejecto(`Run script error: ${_enumerateWrongdoings(p, c)}`);
const _complainNoExist = (packages, candies) =>
  packages.every(_hasTarget) ? packages : _complaint(packages, candies);
const _filterNoExist = packages => packages.filter(_hasTarget);

const _doExecRunScript = (pkg, execOpts, hookNames, hookOpts) =>
  hookNames
    ? pkg.execHooked(pkg.cmds.runScript(pkg.targetScript), hookNames, execOpts, hookOpts)
    : pkg.exec(pkg.cmds.runScript(pkg.targetScript), execOpts);

const ohno = e => {
  throw new Error(e);
};
const ohnoBadSelected = x =>
  ohno(
    `i dont know what a "${x}" is, but it definitely is not the name, directory name, or package.json path of a package within this project`
  );

function executeRunScript(
  dir,
  getPackages,
  candidates,
  required,
  parallel,
  execOpts,
  hookNames,
  hookOpts,
  {
    beforeEach = async pkg => null,
    afterEach = async (inpkg, outpkg) => null,
    beforeAny = async pkgs => pkgs,
    afterAll = async (inpkgs, outpkgs) => outpkgs,
  } = {}
) {
  const candies = typeof candidates === "string" ? [candidates] : candidates;
  const _queenCmd = parallel ? "parallel" : "sequential";
  const ec = new ErrorCollector();

  const getScriptName = pkg => {
    const scripts = pkg.json.scripts;
    const _firstMatch = (m, x) => (m ? m : scripts[x] ? x : null);
    const target = candies.reduce(_firstMatch, null);
    const pkg2 = Object.assign({}, pkg, { targetScript: target }); // don't modify the original
    return pkg2;
  };

  const collectError = pkg => error => {
    const pPath = path.resolve(pkg.root, pkg.dir);
    let errMsg = `run-script failure: "npm run ${pkg.targetScript}" in ${pPath} (${pkg.name})`;
    if ("signal" in error) {
      const parts = Object.keys(error)
        .filter(n => typeof error[n] === "boolean" && !!error[n])
        .concat(["code", "signal"].filter(x => !!error[x]).map(x => `${x}:${error[x]}`));
      errMsg += ` [${parts.join(", ")}]`;
    }
    tapLogger.warn(errMsg); // warn here, error will propagate
    const wrappedError = new Error(`${errMsg} -> ${error.message}`);
    const myStack = wrappedError.stack;
    const _atFound = null;
    const _chkAt = x => _atFound || /^\s+at /.test(x);
    wrappedError.stack = `${myStack}
    -- Original Stack:
${error.stack
      .split(/\n/)
      .filter(_chkAt)
      .map(x => `  ${x}`)
      .join("\n")}`;
    ec.add(wrappedError);
  };

  const getAllNames = pkgs => pkgs.map(getScriptName);
  const handleNoExist = required ? x => _complainNoExist(x, candies) : _filterNoExist;
  const runOne = async pkg => {
    await beforeEach(pkg);
    let results = null;
    if (pkg.targetScript)
      results = await _doExecRunScript(pkg, execOpts, hookNames, hookOpts).catch(collectError(pkg));
    await afterEach(pkg, results);
    return results;
  };
  const runAll = async pkgs => {
    const _pkgs = await beforeAny(pkgs);
    const results = await queen[_queenCmd](_pkgs || pkgs, runOne);
    const _results = await afterAll(_pkgs || pkgs, results);
    return _results || results;
  };

  return getPackages()
    .then(getAllNames)
    .then(handleNoExist)
    .then(runAll)
    .then(results => results.filter(x => !!x))
    .then(ec.checker)
    .catch(e => {
      console.log(JSON.stringify(e.stack));
      throw e;
    });
}

function scanSubpackage(root, pathname) {
  const pkg = {
    root,
    path: pathname,
    name: pathname, // will get overwritten later
    dir: path.dirname(pathname),
    cmds: {},
  };
  pkg.absdir = path.resolve(root, pkg.dir);
  pkg.abspath = path.resolve(root, pathname);

  pkg.logEvent = (msg, data) => pkgLogEvent(pkg, msg, data);
  pkg.debugEvent = (msg, data) => pkgDebugEvent(pkg, msg, data);

  pkg.exec = (cmd, opts = {}) => {
    const _dir = path.resolve(root, pkg.absdir);
    pkg.logEvent(`${cmd}`);
    return executor
      .exec(cmd, Object.assign({ dir: _dir }, opts))
      .then(r => sendExternalEvents(`exec ${cmd} in ${pkg.absdir}`).then(() => r));
  };
  pkg.execHooked = (cmd, hookNames, opts = {}, hookOpts = {}) => {
    pkg.debugEvent(`pkg.execHooked: ${cmd} with hooks ${JSON.stringify(hookNames)}`);
    return hooks.hooked(() => pkg.exec(cmd, opts), pkg.absdir, hookNames, hookOpts);
  };

  const fullpath = path.resolve(root, pathname);

  const _readPkg = () =>
    fs
      .readFile(fullpath, "utf8")
      .then(JSON.parse)
      .then(j => (pkg.json = j))
      .then(j => (pkg.name = j.name));

  return _readPkg().then(() => {
    pkg.cmds.runScript = scr => `npm run ${scr}`;
    pkg.cmds.devInstall = "npm install";
    pkg.cmds.prodInstall = "npm install --production";
    tapLogger.debug(`Scanned package: ${pathname}`, pkg);
    return pkg;
  });
}

function pkgSorter(a, b) {
  const pridiff = b.priority - a.priority;
  if (pridiff !== 0) return pridiff;

  const lendiff = a.path.length - b.path.length;
  return lendiff;
}

function assignPriorities(packages) {
  const names = packages.map(pkg => pkg.dir);
  // set initial priority to a reasonably/ridiculously large yet entirely
  // arbitrary number. -5372 would probably work equally reasonably?
  const arbitraryN = 10000;
  const revDeps = {};
  const pris = {};
  const idxs = {};
  packages.forEach((pkg, i) => {
    const name = pkg.dir;
    idxs[name] = i;
    pris[name] = arbitraryN;
    revDeps[pkg.dir] = revDeps[pkg.dir] || [];
    if (pkg.hasLocals) {
      Object.keys(pkg.locals).forEach(depName => {
        const _p = pkg.locals[depName].paths.project;
        revDeps[_p] = [...(revDeps[_p] || []), name];
      });
    }
  });

  const check = (lst, n) => {
    lst.forEach(name => {
      if (name === ".") return (pris[name] = arbitraryN + 1); // root folder is always the highest priority
      if (pris[name] > n) pris[name] = n;

      check(revDeps[name] || [], n - 1);
    });
  };
  check(names, arbitraryN);

  names.forEach(name => {
    const pkg = packages[idxs[name]];
    pkg.priority = pris[pkg.dir];
  });

  return packages;
}

const SCAN_READDIR_OPTS = {
  filter: "**/package.json",
  deep: stat => {
    const parts = stat.path.split("/");
    if (parts.includes("node_modules") || parts.includes(".git") || stat.isSymbolicLink())
      return false;

    return true;
  },
};

function pkgIgnorer(pkg) {
  if (pkg.json["tapestry.ignore"]) return false;
  if (typeof pkg.json.tapestry === "object" && pkg.json.tapestry.ignore) return false;
  return true;
}

function scanSubpackages(dir) {
  return Promise.resolve()
    .then(() => readdir(dir, SCAN_READDIR_OPTS))
    .then(paths => queen.parallel(paths, pathname => scanSubpackage(dir, pathname)))
    .then(packages => packages.filter(pkgIgnorer))
    .then(packages => determineLocals(dir, packages))
    .then(packages => assignPriorities(packages))
    .then(packages => packages.sort(pkgSorter));
}

function scanIgnored(dir) {
  const reverseIgnorer = x => !pkgIgnorer(x);
  return Promise.resolve()
    .then(() => readdir(dir, SCAN_READDIR_OPTS))
    .then(paths => queen.parallel(paths, pathname => scanSubpackage(dir, pathname)))
    .then(packages => packages.filter(reverseIgnorer));
}

function doInstalls(dir, getPackages, opts = DO_INSTALLS_DEFAULTS) {
  const max = opts.maxParallel || DO_INSTALLS_DEFAULTS.maxParallel;
  const whichHook = opts.production ? "prod-install" : "dev-install";
  const cmd = pkg => pkg.cmds[opts.production ? "prodInstall" : "devInstall"];

  const install = async pkg => {
    const _cmd = cmd(pkg);
    const _hooks = ["any-install", whichHook];
    pkg.debugEvent(
      `subpackages.doInstalls: executing ${_cmd} in ${pkg.absidr} with hooks ${JSON.stringify(
        _hooks
      )}`
    );

    const res = await pkg.execHooked(_cmd, _hooks, opts.execOpts);
    if (!opts.alsoBuild) return res;
    if (!opts.buildEnv) throw new Error(".buildEnv required when .alsoBuild passed!");
    if (!opts.skipEnvVars)
      await envVars.buildEnvVars(dir, path.resolve(dir, pkg.dir), opts.buildEnv);

    const scr = TAPSCRIPTS.BUILD.find(x => !!pkg.json.scripts[x]);
    if (scr) {
      pkg.debugEvent(`found run-script ${scr}, doing immediate post-install build`);
      const hookOpts = { env: { TAPESTRY_ENV: opts.buildEnv, TAPESTRY_BUILD_ENV: opts.buildEnv } };
      await await pkg.execHooked(`npm run ${scr}`, "run-build", opts.execOpts, hookOpts);
    }

    return res;
  };
  const go = packages => _priorityWorker(packages, install, max); // 2 at once is about all that this can handle w/o tanking my computer?
  return getPackages().then(go);
}

function determineLocals(dir, packages) {
  const byname = packages.reduce((m, x) => Object.assign(m, { [x.name]: x }), {});
  packages.forEach(pkg => {
    pkg.locals = {};
    const addPkg = (name, dev) => {
      if (!byname[name]) return;

      const paths = {
        root: dir,
        package: byname[name].path,
      };
      paths.project = path.dirname(paths.package);
      paths.link = `${pkg.dir}/${path.join("node_modules", name)}`; // the usage of a template string for a path join here is because path.join will turn '.' into a resolved path
      pkg.locals[name] = {
        dev,
        paths,
        version: pkg.json[dev ? "devDependencies" : "dependencies"][name],
      };
    };
    Object.keys(pkg.json.dependencies || {}).forEach(name => addPkg(name, false));
    Object.keys(pkg.json.devDependencies || {}).forEach(name => addPkg(name, false));
    pkg.hasLocals = Object.keys(pkg.locals).length;
  });
  return packages;
}

function createLocalLink(dir, wantsSymlink, willBeLinked) {
  const linkdirtmp = path.resolve(dir, wantsSymlink.dir, "node_modules"); // might not be the actual linkdir if / exists in willBeLinked.name
  const link = path.resolve(linkdirtmp, willBeLinked.name);
  const linkdir = path.dirname(link);
  const target = path.resolve(dir, willBeLinked.dir);
  tapLogger.debug(
    `[auto-link:${wantsSymlink.name}] symlinking local dependency ${willBeLinked.name}`
  );
  return Promise.resolve()
    .then(() => del([link]))
    .then(() => fs.mkdirRecursive(linkdir))
    .then(() => fs.symlink(target, link));
}

// selected === array of package.json paths or package names
function autoLink(dir, getPackages, selected) {
  let packages, byname, bypath, bydir, selectedFull, plan;
  const yay = x => Promise.resolve(x);
  const worker = pkg => {
    if (!plan[pkg.name]) {
      tapLogger.debug(`[auto-link:${pkg.name}] no local dependencies to link`);
      return yay();
    }
    tapLogger.debug(`[auto-link:${pkg.name}] linking ${plan[pkg.name].length} packages ...`);
    return queen.parallel(plan[pkg.name], name => createLocalLink(dir, pkg, byname[name]));
  };
  return (
    getPackages()
      .then(p => {
        packages = p;
        byname = packages.reduce((m, x) => Object.assign(m, { [x.name]: x }), {});
        bypath = packages.reduce((m, x) => Object.assign(m, { [x.path]: x }), {});
        bydir = packages.reduce((m, x) => Object.assign(m, { [x.dir]: x }), {});
        selectedFull =
          selected === "ALL"
            ? packages.slice(0)
            : selected.map(x => byname[x] || bypath[x] || bydir[x] || ohnoBadSelected(x));
        const num = selected === "ALL" ? packages.length : selected.length;
        tapLogger.debug(`[auto-link] found ${num} eligible packages to check`);
      })
      .then(() => determineAutoLinkPlan(packages, selectedFull))
      .then(p => (plan = p))
      // .then(() => tapLogger.log("linking plan:", plan))
      .then(() => {
        const hookedWorker = pkg => hooks.hooked(() => worker(pkg), pkg.dir, "create-links");
        return _priorityWorker(packages, hookedWorker);
      })
  );
}

function uniqPairs(list) {
  const uniqSep = " ::: "; // arbitrary. these are package names so space would probably be enough since spaces aren't allowed in published npm package names, but this feels a little safer even if i can't back it up on paper :D
  const uniqReducer = (m, n) => Object.assign(m, { [n.join(uniqSep)]: true });
  const uniqRestorer = x => x.split(uniqSep);
  const uniq = x =>
    Object.keys(x.reduce(uniqReducer, {}))
      .sort()
      .map(uniqRestorer);
  return uniq(list);
}

function determineAutoLinkPlan(list, selected) {
  const byname = list.reduce((m, x) => Object.assign(m, { [x.name]: x }), {});
  const selbyname = selected.reduce((m, x) => Object.assign(m, { [x.name]: x }), {});

  const ok = chain => {
    const head = chain[0];
    const tail = chain.slice(1);
    // console.log(head, "checking tail", tail, "against list", selected.map(x => x.name));
    if (!selbyname[head]) return false;

    if (tail.length === 0) return true;

    for (let i = 0; i < tail.length; i++) if (selbyname[tail[i]]) return true;

    return false;
  };

  let chains = [];
  list.forEach(pkg => chains.push(...getRecursiveLocals(pkg, byname)));

  // tapLogger.log(`[auto-link] found ${chains.length} dependency chains`);

  chains = chains.filter(chain => {
    const isok = ok(chain);
    return isok;
  });

  tapLogger.debug(`[auto-link] found ${chains.length} relevant local-dependency chains`);

  let bigrams = [];
  chains.forEach(chain => bigrams.push(...ngrams(chain, 2)));

  // tapLogger.log(`[auto-link] found ${bigrams.length} relevant bigrams (including duplicates)`);

  bigrams = uniqPairs(bigrams);

  tapLogger.debug(`[auto-link] found ${bigrams.length} total required symlinks`);

  const plan = {};
  bigrams.forEach(pair => {
    const [a, b] = pair;
    if (!plan[a]) plan[a] = [];

    if (!plan[a].includes(b)) plan[a].push(b);
  });

  const linkCounts = [];
  let totalCount = 0;
  list.forEach(pkg => {
    const pkgPlan = plan[pkg.name] || [];
    totalCount += pkgPlan.length;
    linkCounts.push(`${pkg.name}:${pkgPlan.length}`);
  });

  tapLogger.log(`[auto-link] will make ${totalCount} links.`);
  tapLogger.debug(`[auto-link] link counts: \n    ${linkCounts.join(",\n    ")}`);
  return plan;
}

function getRecursiveLocals(pkg, byname) {
  const chk = (p, acc) => {
    if (!p.hasLocals) return [];

    // console.log(p.name, p.hasLocals, Object.keys(p.locals), acc);
    const results = [];
    Object.keys(p.locals).forEach(locName => {
      const endpoint = [...acc, locName];
      results.push(endpoint);
      const batch = chk(byname[locName], [...acc, p.name]);
      results.push(...batch);
    });
    return results;
    // return Object.keys(p.locals).map(name => chk(byname[name], [...acc, name])).reduce((a, b) => a.concat(b));
  };
  const list = chk(pkg, [pkg.name]);
  return list;
}

function ngrams(ary, n = 2) {
  const ok = pos => pos + n <= ary.length;
  const reducer = (m, x, i) => (ok(i) ? [...m, ary.slice(i, i + n)] : m);
  return ary.reduce(reducer, []);
}

function buildEnvVars(dir, getPackages, envName = "development") {
  const pkgroot = pkg => path.resolve(dir, pkg.dir);
  const worker = pkg => {
    pkg.debugEvent(`Building env vars`);
    return envVars.buildEnvVars(dir, pkgroot(pkg), envName);
  };
  return getPackages().then(packages => queen.parallel(packages, worker));
}

const cleanNodeModules = (dir, getPackages) => {
  const _clean = pkg => {
    const modpath = path.resolve(pkg.dir, "node_modules");
    return fs
      .stat(modpath)
      .catch(_swallowENOENT)
      .then(stat => {
        if (stat && stat.isDirectory) {
          pkgDebugEvent(pkg, "wiping existing node_modules folder ...");
          return del([modpath]);
        }
      });
  };
  return getPackages().then(packages => {
    const hookedWorker = pkg => hooks.hooked(() => _clean(pkg), pkg.dir, "clean-modules");
    return queen.parallel(packages, hookedWorker);
  });
};

const test = (dir, getPackages, required, parallel, execOpts) =>
  executeRunScript(dir, getPackages, TAPSCRIPTS.TEST, required, parallel, execOpts, "run-tests");

const build = (
  dir,
  getPackages,
  required,
  parallel,
  envName = "local",
  execOpts,
  skipEnvVars = false
) =>
  executeRunScript(
    dir,
    getPackages,
    TAPSCRIPTS.BUILD,
    required,
    parallel,
    execOpts,
    "run-builds",
    { env: { TAPESTRY_ENV: envName, TAPESTRY_BUILD_ENV: envName } },
    {
      beforeEach: skipEnvVars
        ? async () => {}
        : async pkg => await envVars.buildEnvVars(dir, path.resolve(dir, pkg.dir), envName),
    }
  );

const healthCheck = (dir, getPackages, execOpts, hookOpts) =>
  executeRunScript(
    dir,
    getPackages,
    TAPSCRIPTS.HEALTH,
    false,
    false,
    execOpts,
    "health-check",
    hookOpts
  );

const buildDocs = (dir, getPackages, execOpts, hookOpts) =>
  executeRunScript(
    dir,
    getPackages,
    TAPSCRIPTS.BUILD_DOCS,
    false,
    false,
    execOpts,
    "build-docs",
    hookOpts
  );

const publishDocs = (dir, getPackages, execOpts, hookOpts) =>
  executeRunScript(
    dir,
    getPackages,
    TAPSCRIPTS.PUBLISH_DOCS,
    false,
    false,
    execOpts,
    "publish-docs",
    hookOpts
  );

const doMigrations = (dir, getPackages, execOpts, hookOpts) =>
  executeRunScript(
    dir,
    getPackages,
    TAPSCRIPTS.MIGRATE,
    false,
    false,
    execOpts,
    "migrations",
    hookOpts
  );

const doFinalize = (dir, getPackages, execOpts, hookOpts) =>
  executeRunScript(
    dir,
    getPackages,
    TAPSCRIPTS.FINALIZE,
    false,
    false,
    execOpts,
    "finalize",
    hookOpts
  );

const each = (dir, getPackages, func) =>
  getPackages().then(packages => queen.sequential(packages, func));

const exec = (dir, getPackages) =>
  getPackages().then(packages => _priorityWorker(packages, pkg => pkg.exec(cmd)));

const paths = (dir, getPackages) => getPackages().then(packages => packages.map(pkg => pkg.path));

const devInstall = (
  dir,
  getPackages,
  execOpts = {},
  alsoBuild = true,
  buildEnv = "local",
  skipEnvVars = false
) =>
  doInstalls(dir, getPackages, { alsoBuild, production: false, execOpts, buildEnv, skipEnvVars });

const prodInstall = (dir, getPackages, execOpts = {}, alsoBuild = false, buildEnv = "production") =>
  doInstalls(dir, getPackages, { alsoBuild, production: true, execOpts, buildEnv });

const priorityWorker = (dir, getPackages, worker) =>
  getPackages().then(packages => _priorityWorker(packages, worker));

const runBeforeHook = (dir, getPackages, hookName, opts = {}) =>
  getPackages().then(pkgs =>
    queen.parallel(pkgs, pkg => hooks.runBeforeHook(pkg.dir, hookName, opts))
  );

const runAfterHook = (dir, getPackages, hookName, opts = {}) =>
  getPackages().then(pkgs =>
    queen.parallel(pkgs, pkg => hooks.runAfterHook(pkg.dir, hookName, opts))
  );

const hooked = (dir, getPackages, worker, hookNames, opts = {}) =>
  getPackages().then(pkgs =>
    queen.parallel(pkgs, pkg => hooks.hooked(worker, pkg.dir, hookNames, opts))
  );

function initialize(dir, fileCache) {
  const filePromise = scanSubpackages(dir, fileCache);
  const getPackages = () => filePromise;
  const wrap = fn => (...args) => fn(dir, getPackages, ...args);
  const lib = { getPackages };
  lib.scanIgnored = wrap(scanIgnored);
  lib.hooked = wrap(hooked);
  lib.runBeforeHook = wrap(runBeforeHook);
  lib.runAfterHook = wrap(runAfterHook);
  lib.each = wrap(each);
  lib.exec = wrap(exec);
  lib.paths = wrap(paths);
  lib.test = wrap(test);
  lib.build = wrap(build);
  lib.healthCheck = wrap(healthCheck);
  lib.doMigrations = wrap(doMigrations);
  lib.doFinalize = wrap(doFinalize);
  lib.executeRunScript = wrap(executeRunScript);
  lib.devInstall = wrap(devInstall);
  lib.prodInstall = wrap(prodInstall);
  lib._doInstalls = wrap(doInstalls);
  lib.cleanNodeModules = wrap(cleanNodeModules);
  lib.priorityWorker = wrap(priorityWorker);
  lib.autoLink = wrap(autoLink);
  lib.buildEnvVars = wrap(buildEnvVars);
  lib.buildDocs = wrap(buildDocs);
  lib.publishDocs = wrap(publishDocs);
  return lib;
}

function init(dir, fileCache) {
  if (!CACHE[dir]) CACHE[dir] = initialize(path.resolve(dir), fileCache);
  return CACHE[dir];
}

function sendExternalEvents(msg) {
  return Promise.all(EXTERNAL_EVENT_HANDLERS.map(fn => Promise.resolve(fn(msg))));
}

function sendEventsTo(handler) {
  EXTERNAL_EVENT_HANDLERS.push(handler);
}

module.exports = {
  init,
  sendEventsTo,
  // forceNoYarn: () => (FORCE_NO_YARN = true),
  forceNoYarn: () => true,
  TAPSCRIPTS,
};
