"use strict";

const parseAny = require("./parse-any");
const subpackages = require("./subpackages");
// const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const path = require("path");
const allowedDeploymentTypes = ["serverless", "npm", "electron", "elasticbeanstalk"];

const logger = require("./logging").utilLogger("spec");
const debug = (...a) => logger.debug(...a);

const queen = require("prom-queen");
const envVars = require("./env-vars");

const { DEFAULT_ENV_TAGS, DEFAULT_ENV_NPM_DIST_TAGS } = require("./definitions");

const SHOULD_BE_ARRAYS = {
  files: true,
  copy: true,
};

const badType = () => {
  const types = parseAny.types.join(" ");
  return _rejecto(`no matching tapestry.service.{ext} found. supported exts: ${types}`);
};

const load = dir =>
  Promise.resolve()
    .then(() => parseAny.checkFile(dir, "tapestry.service"))
    .then(found => (found ? loadServiceSpec(found) : badType));

const loadUp = (dir, upTo = "/") =>
  Promise.resolve()
    .then(() => parseAny.checkFirstUpTree(dir, "tapestry.service", upTo))
    .then(found => (found ? loadServiceSpec(found) : badType));

function loadServiceSpec(file) {
  const dir = path.dirname(file);
  return parseAny.load(file).then(str => parse(str, dir));
}

function preprocessDef(def, key) {
  def = JSON.parse(JSON.stringify(def)); // make a copy for safety's sake
  def.name = key;
  if (def.type === "npm") def.packageJson = true;

  const reducer = (m, k) => {
    if (SHOULD_BE_ARRAYS[k]) m[k] = def[k] ? (Array.isArray(def[k]) ? def[k] : [def[k]]) : [];
    else m[k] = def[k];

    return m;
  };

  return Object.keys(def).reduce(reducer, {});
}

const INITIAL_SLASH = /^\/+/;
function postprocessDef(def, rootObj) {
  // add defaultable values
  const newDef = Object.assign(
    {
      root: "",
      priority: 0,
      environmentTags: rootObj.environmentTags,
      environmentNpmDistTags: rootObj.environmentNpmDistTags,
    },
    JSON.parse(JSON.stringify(def)) // naïve clone object
  );

  ["files", "copy"].forEach(x => (newDef[x] ? null : (newDef[x] = [])));

  if (!newDef.files.includes("**/.npmrc")) newDef.files.push("**/.npmrc");
  if (!newDef.files.includes("**/.env")) newDef.files.push("**/.env"); // these are built by tapestry

  if (INITIAL_SLASH.test(newDef.root)) newDef.root = newDef.root.replace(INITIAL_SLASH, "");

  newDef.copy = newDef.copy.map(x => {
    if (typeof x === "string") {
      const parts = x.split(" -> ", 2);
      return { source: parts[0], destination: parts[1] };
    }

    return x;
  });

  return newDef;
}

function validateDef(def, name) {
  // later this should do some real validation

  if (!def.type) throw new Error(`Deployment ${name} has no 'type' field!`);

  if (allowedDeploymentTypes.indexOf(def.type) === -1) {
    throw new Error(
      `Deployment ${name} has an unknown 'type' field: '${
        def.type
      }', available: ${allowedDeploymentTypes.join(", ")}`
    );
  }

  return def;
}

function fillInVars(tpl, def, name) {
  const replacer = ($0, $1) => {
    if (!def[$1]) {
      throw new Error(
        `Deployment ${name} uses Template ${def.$template} but does not defined variable ${$1}!`
      );
    }

    return def[$1];
  };
  const fillStr = str => str.replace(/<(\$[a-zA-Z0-9-]+)>/g, replacer);
  const reducer = (newObj, key) => {
    if (typeof tpl[key] === "string") newObj[key] = fillStr(tpl[key]);
    else if (Array.isArray(tpl[key]))
      newObj[key] = tpl[key].map(v => (typeof v === "string" ? fillStr(v) : v));
    else newObj[key] = tpl[key];

    return newObj;
  };

  return Object.keys(tpl).reduce(reducer, {});
}

function parse(obj, dir) {
  const subs = subpackages.init(dir);
  const preinstall = obj.install || {};

  const parsedObj = {
    service: obj.service,
    install: Object.assign({ apt: [], yum: [], brew: [], npm: [], custom: [] }, preinstall),
    environmentTags: obj.environmentTags || DEFAULT_ENV_TAGS,
    environmentNpmDistTags: obj.environmentNpmDistTags || DEFAULT_ENV_NPM_DIST_TAGS,
    deployments: {},
  };

  const assignFromDepls = (m, k) => {
    m[k] = obj.deployments[k];
    return m;
  };

  const isTemplate = k => k.startsWith("$");
  const templates = Object.keys(obj.deployments)
    .filter(isTemplate)
    .reduce(assignFromDepls, {});
  const defs = Object.keys(obj.deployments)
    .filter(k => !isTemplate(k))
    .reduce(assignFromDepls, {});

  Object.keys(defs).forEach(deploymentName => {
    const origDef = preprocessDef(defs[deploymentName], deploymentName);
    const newDef = {};

    if (origDef.$template) {
      if (!templates[origDef.$template]) {
        throw new Error(
          `Deployment ${deploymentName} wants non-existent Template ${origDef.$template}`
        );
      }

      const tpl = fillInVars(preprocessDef(templates[origDef.$template]), origDef, deploymentName);
      Object.assign(newDef, tpl);
    }

    Object.keys(origDef).forEach(key => {
      if (key.startsWith("$")) return;

      newDef[key] = origDef[key];
    });

    parsedObj.deployments[deploymentName] = validateDef(
      postprocessDef(newDef, parsedObj),
      deploymentName
    );
  });

  // console.log('DEFS', defs);
  // console.log('TPLS', templates);

  let pkgs, ignored;
  const _reducer = metas =>
    metas.reduce((memo, meta) => Object.assign(memo, { [meta.path]: meta }), {});
  return Promise.resolve()
    .then(() => subs.getPackages().then(p => (pkgs = _reducer(p))))
    .then(() => subs.scanIgnored().then(i => (ignored = _reducer(i))))
    .then(() => addPackageInfo(pkgs, parsedObj, ignored));
}

function addPackageInfo(pkgs, spec, ignored) {
  Object.keys(spec.deployments).forEach(name => {
    const def = spec.deployments[name];
    const pkgPath = path.join(def.root, "package.json");
    if (ignored[pkgPath]) {
      delete spec.deployments[name];
      return;
    }

    if (pkgs[pkgPath]) {
      def.packageJson = true;
      def.package = pkgs[pkgPath];
      if (!def.autoversion) {
        // if the def already explicitly sets an autoversion, do not autodetect from file
        def.autoversion = pkgs[pkgPath].json.version.split(".", 2).join(".");
      }
    } else {
      def.packageJson = false;
    }

    if (!def.autoversion) {
      const errorMessage = `Tapestry Service Spec Error: Deployment "${name}" has no 'autoversion' field set. This field will be autodetected from ${pkgPath}, if it exists, by using the major/minor semver components of the version field. Alternately this version may be set directly in the service specification file using the 'autoversion' field under the deployment definition for ${name}.`;
      throw new Error(errorMessage);
    }

    if (typeof def.autoversion === "number") {
      const autoversionStr = def.autoversion.toString();
      if (/^\d+\.\d+$/.test(autoversionStr)) {
        def.autoversion = autoversionStr;
      } else {
        throw new Error(
          `autoversion should be in the format X.Y where X/Y are strings of one or more numbers. ${JSON.stringify(
            def
          )}`
        );
      }
    }
  });

  return spec;
}

function buildEnvVars(dir, spec, envName) {
  const needsIt = Object.keys(spec.deployments)
    .map(k => spec.deployments[k])
    .filter(def => def.packageJson === false);
  if (needsIt.length === 0) return Promise.resolve();

  const worker = def => {
    debug(`Creating .env file for deployment ${def.name}`);
    return envVars.buildEnvVars(dir, def.root, envName);
  };
  return queen.sequential(needsIt, worker);
}

module.exports = {
  load, // auto-find tapestry.service.* in current dir
  loadUp, // auto-find tapestry.service.* anywhere up the tree
  loadServiceSpec, // load service spec by exact filename

  buildEnvVars,
};
