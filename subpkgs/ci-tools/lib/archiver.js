"use strict";

const path = require("path");

const minimatch = require("minimatch");
const JSZip = require("jszip");
const queen = require("prom-queen");
const readdir = require("readdir-enhanced");

const fs = require("PLEASE-FIX-MY-FS-ACCESS");

const serviceSpec = require("./service-spec");
const buildInfo = require("./build-info");
const subpackages = require("./subpackages");
const logger = require("./custom-logger").logger("util:archiver");

const ARTIFACTS_PATH = "Artifacts";
const ARTIFACT_BUNDLES_PATH = path.join(ARTIFACTS_PATH, "deployment-bundles");

const createBundlesDir = dir => fs.mkdirRecursive(path.resolve(dir, ARTIFACT_BUNDLES_PATH));
const doesntContain = (p, seg) => p.split("/").indexOf(seg) === -1;

const getFileList = dir =>
  readdir(dir, {
    deep: s => doesntContain(s.path, ".git"),
    filter: s => !s.isDirectory(),
  });
const getDirList = dir =>
  readdir(dir, {
    deep: s => doesntContain(s.path, ".git"),
    filter: s => s.isDirectory(),
  });

const orderedKeys = obj => Object.keys(obj).sort((a, b) => a.length - b.length);

function createDeploymentBundles(dir) {
  let files = null;
  let spec = null;
  let dirs = null;
  const resultsTmp = [];
  let results = null;
  const summaryPath = path.resolve(dir, ARTIFACTS_PATH, "deployment-bundles.json");
  const setRes = (x, promise) =>
    promise.then(r => (x === "files" ? (files = r) : x === "dirs" ? (dirs = r) : (spec = r)));
  const reducer = (promise, key) =>
    promise
      .then(() => createDeploymentBundle(dir, files, dirs, spec.deployments[key], key))
      .then(res => resultsTmp.push(res));

  return Promise.resolve()
    .then(() => createBundlesDir(dir))
    .then(() =>
      Promise.all([
        setRes("files", getFileList(dir)),
        setRes("dirs", getDirList(dir)),
        setRes("spec", serviceSpec.loadMeta(dir)),
      ])
    )
    .then(() => orderedKeys(spec.deployments).reduce(reducer, Promise.resolve()))
    .then(() => collateResults(resultsTmp, dir, files))
    .then(res => (results = res))
    .then(data => fs.writeFile(summaryPath, JSON.stringify(results, null, 2), "utf8"))
    .then(() => logger.log(`saved ${summaryPath}`))
    .then(() => results);
}

function collateResults(bundleArray, dir) {
  const finalResult = {
    bundles: bundleArray.reduce((m, x) => Object.assign(m, { [x.key]: x }), {}),
  };

  return Promise.all([
    serviceSpec.loadMeta(dir),
    buildInfo.loadMeta(dir),
    subpackages.loadMeta(dir),
  ])
    .then(res => {
      finalResult.serviceSpec = res[0];
      finalResult.buildInfo = res[1];
      finalResult.subpackages = res[2];
    })
    .then(() => finalResult);
}

function createDeploymentBundle(_dir, _files, _dirs, def, key) {
  logger.log(`creating deployment bundle for ${key}`);
  const atRoot = def.root === "";
  const dir = atRoot ? _dir : path.join(_dir, def.root);

  const _fileInRoot = f => f.startsWith(`${def.root}/`);
  const _stripRoot = f => f.replace(def.root, "").replace(/^\/+/, "");
  const _matchesAnyPattern = f => !!def.files.filter(p => minimatch(f, p)).length;
  const _fileToRec = f => ({ source: path.join(dir, f), destination: f });
  const _dotToEmpty = x => (x === "." ? "" : x);
  const _addFields = rec =>
    Object.assign({}, rec, {
      destDir: _dotToEmpty(path.dirname(rec.destination)),
    });

  const files = (atRoot ? _files : _files.filter(_fileInRoot).map(_stripRoot))
    .filter(_matchesAnyPattern)
    .map(_fileToRec);

  const copies = def.copy
    .map(c => {
      if (_dirs.indexOf(c.source) > -1) {
        return _files.filter(f => f.startsWith(c.source)).map(f => ({
          source: f,
          destination: path.join(f.replace(c.destination, "").replace(/^\/+/, "")),
        }));
      } else if (_files.indexOf(c.source) > -1) {
        const dest = path.join(c.destination.replace(def.root, "").replace(/^\/+/, ""));
        return [{ source: path.join(_dir, c.source), destination: dest }];
      }

      console.error("dirs", dirs);
      console.error("files", files);

      throw new Error(`wtf: ${c.source}`);
    })
    .reduce((a, b) => [...a, ...b], []);

  const all = [].concat(files, copies).map(_addFields);
  const dirs = Object.keys(all.reduce((m, x) => Object.assign(m, { [x.destDir]: 1 }), {})).filter(
    x => !!x.length
  );
  const destZipDir = path.resolve(_dir, ARTIFACT_BUNDLES_PATH);
  const destZip = path.resolve(destZipDir, `${key}.zip`);

  return buildZipFile(destZip, dirs, all, def, key, _dir);
}

function readFileIntoZip(file, stat, zipfile) {
  return fs.readFile(file.source).then(buf => {
    zipfile.file(file.destination, buf, { unixPermissions: stat.mode });
  });
}

function writeZip(zipfile, path) {
  return new Promise((resolve, reject) => {
    zipfile
      .generateNodeStream()
      .pipe(fs.createWriteStream(path))
      .on("finish", resolve)
      .on("error", reject);
  });
}

function mergeBuildInfo(def, buildInfo, pkg) {
  const buildVersion = pkg.pkgJson.version;
  return Object.assign({}, buildInfo, {
    buildVersion,
    versionedBuildId: `${buildVersion}+${buildInfo.buildId}`,
    versionedBuildStr: `${buildVersion}+${buildInfo.buildStr}`,
  });
}

function buildZipFile(outputPath, dirs, files, def, key, origRoot) {
  const zipfile = new JSZip();
  const meta = {};
  let stats = null;

  logger.log(`creating zip ${outputPath}, ${dirs.length} dirs, ${files.length}`);

  return Promise.resolve()
    .then(() =>
      Promise.all([
        serviceSpec.loadMeta(origRoot),
        buildInfo.loadMeta(origRoot),
        subpackages.loadMeta(origRoot),
      ])
    )
    .then(res => {
      const spec = res[0];
      const serviceBuildInfo = res[1];
      const subpackages = res[2];
      let buildInfo = serviceBuildInfo;

      meta.deployment = def;

      if (def.packageJson) {
        const pkgPath = path.join(
          def.root,
          def.packageJson === true ? "package.json" : def.packageJson
        );
        meta.package = subpackages[pkgPath];

        if (def["version-from"] === "package.json")
          buildInfo = mergeBuildInfo(def, buildInfo, meta.package);
      }

      meta.buildInfo = buildInfo; // might be differnet from the service buildInfo
      meta.buildVersion = buildInfo.buildVersion;
      meta.versionedBuildId = buildInfo.versionedBuildId;
      meta.versionedBuildStr = buildInfo.versionedBuildStr;

      meta.service = {
        serviceSpec: spec,
        buildInfo: serviceBuildInfo,
        subpackages,
      };
      meta.tapestry = {
        "tapestry-ci-tools": require("../package.json").version,
        "tapestry-util": require("@tapestry-ci/util/package.json").version,
      };
      zipfile.file("Tapestry.Meta.json", JSON.stringify(meta, null, 2), {
        unixPermissions: "644",
      });
    })
    .then(() => Promise.all(files.map(f => fs.stat(f.source).then(z => [f.source, z]))))
    .then(r => r.reduce((m, x) => Object.assign(m, { [x[0]]: x[1] }), {}))
    .then(s => (stats = s))
    .then(() => logger.log(`[${def.name}] build version: ${meta.versionedBuildId}`))
    .then(() => logger.log(`[${def.name}] build version (long): ${meta.versionedBuildStr}`))
    .then(() => logger.log(`[${def.name}] adding ${dirs.length} folders to ${key} bundle`))
    .then(() => dirs.forEach(dir => zipfile.file(dir, null, { unixPermissions: "755", dir: true })))
    .then(() => logger.log(`[${def.name}] adding ${files.length} files to ${key} bundle`))
    .then(() => queen.sequential(files, f => readFileIntoZip(f, stats[f.source], zipfile)))
    .then(() => logger.log(`[${def.name}] writing output bundle`))
    .then(() => writeZip(zipfile, outputPath))
    .then(() => logger.log(`[${def.name}] saved ${outputPath}`))
    .then(() => ({
      key,
      type: def.type,
      priority: def.priority,
      version: meta.buildInfo.version,
      buildId: meta.buildInfo.buildId,
      deploymentId: meta.buildInfo.deploymentId,
      deploymentHash: meta.deploymentHash,
      bundle: path.relative(path.resolve(origRoot, ARTIFACTS_PATH), outputPath),
      deployment: meta.deployment,
      package: meta.package || null,
      buildInfo: meta.buildInfo,
    }));
}

function loadDeploymentMeta(dir) {
  const summaryPath = path.resolve(dir, ARTIFACTS_PATH, "deployment-bundles.json");
  return fs.readFile(summaryPath, "utf8").then(JSON.parse);
}

module.exports = { createDeploymentBundles, loadDeploymentMeta };
