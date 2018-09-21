"use strict";

const request = require("request-promise");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const del = require("del");
const path = require("path");
const tempfile = require("tempfile");
const JSZip = require("jszip");
const executor = require("./executor");

const _rejecto = str => Promise.reject(new Error(str));
const _ERR_X_BADREPO = ext => _rejecto(`options.repo must be a string ${ext}`);
const _ERR_GITHUB_BADREPO = () => _ERR_X_BADREPO("of form user/repo or organization/repo");
const _ERR_LOCALGIT_BADREPO = () =>
  _ERR_X_BADREPO("containing a valid filesystem path to a git repository");

const GITHUB_ARCHIVE_DEFAULTS = {
  api: "https://api.github.com", // we might need to override this for GHE ? not an issue for now
};

const ARCHIVERS = { localgit, github };

const fetchAndSave = (options, stream) =>
  new Promise((resolve, reject) => {
    const instream = request.get(options);
    instream.on("error", reject);
    stream.on("close", resolve);
    stream.on("error", reject);
    instream.pipe(stream);
  });

const Accept = "application/vnd.github.v3.raw";
const UserAgent = "tapestry-archives/1.0";

function github(sha, options = {}) {
  options = Object.assign({}, GITHUB_ARCHIVE_DEFAULTS, options);
  if (!options.repo || typeof options.repo !== "string" || !options.repo.includes("/"))
    return _ERR_GITHUB_BADREPO();

  const { token, repo } = options;
  const [orgname, reponame] = options.repo.split("/");
  const url = `${options.api}/repos/${orgname}/${reponame}/zipball/${sha}`;
  const Authorization = `token ${token}`;
  const headers = { Authorization, Accept, "User-Agent": UserAgent };
  const fetchOptions = { url, headers };

  const inputZip = new JSZip();
  const outputZip = new JSZip();
  const tmpOutfilePath = tempfile(".raw-archive.zip");
  const tmpOutfile = fs.createWriteStream(tmpOutfilePath);

  const finalOutfilePath = options.output || tempfile(`.${reponame}-${sha}.github-ci-bundle.zip`);
  const finalOutfile = fs.createWriteStream(finalOutfilePath);

  const zipOpts = { compressionOptions: { level: 9 }, compression: "DEFLATE" };

  return Promise.resolve()
    .then(() => fetchAndSave(fetchOptions, tmpOutfile))
    .then(data => inputZip.loadAsync(fs.readFile(tmpOutfilePath)))
    .then(() =>
      inputZip.forEach((relpath, file) => {
        const chomped = relpath
          .split(path.sep)
          .filter((x, i) => i !== 0)
          .join(path.sep);
        if (chomped === "") return;

        try {
          outputZip.file(chomped, file.async("nodebuffer"));
        } catch (e) {
          console.log("error writing to ", chomped, file);
        }
      })
    )
    .then(
      () =>
        new Promise(resolve =>
          outputZip
            .generateNodeStream(zipOpts)
            .pipe(finalOutfile)
            .on("finish", resolve)
        )
    )
    .then(() => del([tmpOutfilePath], { force: true }))
    .then(() => finalOutfilePath);
}

function localgit(sha, options = {}) {
  if (!options.repo || typeof options.repo !== "string") return _ERR_LOCALGIT_BADREPO();

  const repo = path.resolve(options.repo);
  const last = path.basename(options.repo);
  const finalOutfilePath = options.output || tempfile(`.${last}-${sha}.localgit-ci-bundle.zip`);
  const gitdir = path.resolve(repo, ".git");
  const gitcmd = `git archive --format=zip -9 -o "${finalOutfilePath}" ${sha}`;
  const execopts = { dir: repo, env: process.env };

  return Promise.resolve()
    .then(() => fs.stat(gitdir))
    .then(stat => (stat.isDirectory() ? null : _rejecto(`${gitdir} isn't a folder?`)))
    .then(() => executor.exec(gitcmd, execopts))
    .then(() => finalOutfilePath);
}

function archive(type, sha, options) {
  const archiver = ARCHIVERS[type];
  return archiver ? archiver(sha, options) : _rejecto(`unknown archive type ${type}`);
}

module.exports = Object.assign({}, ARCHIVERS, { archive });
