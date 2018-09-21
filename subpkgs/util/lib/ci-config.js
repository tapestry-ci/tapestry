"use strict";

const AWS = require("aws-sdk");
const fs = require("PLEASE-FIX-MY-FS-ACCESS");
const path = require("path");
const os = require("os");
const _rejecto = m => Promise.reject(m instanceof Error ? m : new Error(m));

// prettier-ignore
const ERRORS = {
  NOT_YET_DECRYPTED: "must call async .prepare() at some point prior to deployCreds(), or call async .fetchDeployCreds()",
  NO_CI_CONFIG: "Please set the env var TAPESTRY_CI_CONFIG_LOCATION to a valid S3 configuration location in JSON format {Bucket,Key,region}",
};

// const _CONFIG = Symbol("tapestry-ci-config-location");
const _S3 = Symbol("tapestry-ci-config-s3-instance");
const _KMS = Symbol("tapestry-ci-config-kms-instance");
const _DECRYPT = Symbol("tapestry-ci-decryptionator");
const _DATA = Symbol("tapestry-ci-configuration-data");
const _REG = Symbol("tapestry-ci-config-region");
const _CREDS = Symbol("tapestry-ci-deployment-credentials");
const _USER_DB = Symbol("tapestry-ci-user-registry");

const keypath = k => (typeof k === "string" ? k.split(".") : Array.from(k));
const guessRegion = r =>
  r || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-west-2";

const s3pathfillmatch = /(:([a-zA-Z]+))/g;

const defaultCacheKey = () => (((Date.now() / 900000) | 0) * 900000).toString(16); // 90000 == 15 minutes so this keeps a short-lived config around. only used as a default if nothing better can be used

class TapestryCIConfig {
  constructor(data, region, opts = {}) {
    this[_DATA] = data;
    this[_REG] = guessRegion(region);
    this[_S3] = opts.s3 || new AWS.S3({ region: this[_REG] });
    this[_KMS] = new AWS.KMS({ region: this[_REG] });
  }

  static fetchFromS3OrCache(
    Bucket,
    Key,
    region,
    cacheKey = process.env.TAPESTRY_BUILD_STR || defaultCacheKey()
  ) {
    const fn = path.resolve(os.tmpdir(), `tapestry-ci-config.cache.${cacheKey}.json`);
    let cfg;

    const tryCache = () =>
      Promise.resolve()
        .then(() => fs.readFile(fn, "utf8").then(JSON.parse))
        .then(obj => (cfg = new this(obj, region)))
        .catch(e => (e.code === "ENOENT" ? Promise.resolve() : Promise.reject(e)));

    const tryS3 = () => cfg || this.fetchFromS3(Bucket, Key, region).then(c => (cfg = c));

    const writeCache = () => fs.writeFile(fn, cfg.rawJson, "utf8");

    return Promise.resolve()
      .then(tryCache)
      .then(tryS3)
      .then(writeCache)
      .then(() => cfg.prepare()) // may have been already prepared but will be a no-op in that case
      .then(() => cfg);
  }

  static fetchFromS3(Bucket, Key, region) {
    const realRegion = guessRegion(region);
    const s3 = new AWS.S3({ region: guessRegion(realRegion) });
    let cfg;
    return Promise.resolve()
      .then(() => s3.getObject({ Bucket, Key }).promise())
      .then(rs => (cfg = new this(JSON.parse(rs.Body), realRegion, { s3 })))
      .then(() => cfg.prepare())
      .then(() => cfg);
  }

  get raw() {
    return JSON.parse(this.rawJson); // never give back our real object
  }

  get rawJson() {
    return JSON.stringify(this[_DATA]);
  }

  get deployments() {
    return this[_DATA].deployments;
  }

  get github() {
    return (
      this[_DATA].github || {
        accessToken: null,
      }
    );
  }

  get users() {
    return JSON.parse(JSON.stringify(this[_USER_DB]));
  }

  get region() {
    return this[_REG];
  }

  get publishRegistry() {
    try {
      const reg = this[_DATA].npm["publish-registry"];
      if (reg) return reg;
    } catch (e) {}

    return "https://registry.npmjs.org";
  }

  fetchUserDb() {
    if (this[_USER_DB]) return Promise.resolve(this[_USER_DB]);
    const s3 = new AWS.S3({ region: this[_DATA].region });
    const params = JSON.parse(JSON.stringify(this[_DATA].tapestryUsers));
    return Promise.resolve()
      .then(() => s3.getObject(params).promise())
      .then(rs => (this[_USER_DB] = JSON.parse(rs.Body)));
  }

  prepare() {
    return (this[_CREDS]
      ? Promise.resolve()
      : this[_DECRYPT]().then(c => {
          this[_CREDS] = c;
        })
    ).then(() => this.fetchUserDb());
  }

  [_DECRYPT]() {
    const encrypted = Buffer.from(this[_DATA].deploymentCredentials, "base64");
    return Promise.resolve()
      .then(() => this[_KMS].decrypt({ CiphertextBlob: encrypted }).promise())
      .then(r => JSON.parse(r.Plaintext.toString("utf8")));
  }

  s3Location(type, data) {
    const keys = keypath(type);
    const dkeys = Object.keys(data).join(" | ");
    const last = keys.length - 1;
    let cur = this[_DATA].s3;
    let buk = cur.bucket;
    let tpl;
    const scan = (k, idx) => {
      if (idx === last) {
        tpl = cur[k];
        if (typeof tpl !== "string") throw new Error(`${type} does not reference a string path!`);
      } else {
        cur = cur[k];
        if (!cur) {
          throw new Error(
            `${k} (from ${keys.join(",")}) not found in s3cfg: ${JSON.stringify(this[_DATA].s3)}`
          );
        }
        if (cur.bucket) buk = cur.bucket;
      }
    };

    const filldata = (m, tag, stripped) => {
      if (typeof data[stripped] === "undefined")
        throw new Error(`Bad s3 path '${type}': '${tag}' does not match a key in data: ${dkeys} `);

      return data[stripped];
    };

    keys.forEach(scan);

    return { Bucket: buk, Key: tpl.replace(s3pathfillmatch, filldata) };
  }

  repo(name) {
    const defaultRules = this[_DATA].repositories.rules;
    const rec = this[_DATA].repositories[name];
    if (!rec) return { codebuild: null, rules: null };

    const { codebuild } = rec;
    const rules = rec.rules || Object.assign({}, defaultRules, rec["rules-add"] || {});
    return { codebuild, rules };
  }

  fetchDeployCreds(forEnv) {
    return this.prepare().then(() => this.deployCreds(forEnv));
  }

  deployCreds(forEnv) {
    if (!this[_CREDS]) throw new Error(ERRORS.NOT_YET_DECRYPTED);

    return this[_CREDS][forEnv];
  }
}

function getConfig(cfgloc = process.env.TAPESTRY_CI_CONFIG_LOCATION, cache = true) {
  if (!cfgloc) return _rejecto(ERRORS.NO_CI_CONFIG);

  return Promise.resolve(cfgloc)
    .then(JSON.parse)
    .then(cfg =>
      TapestryCIConfig[cache ? "fetchFromS3OrCache" : "fetchFromS3"](
        cfg.Bucket,
        cfg.Key,
        cfg.region
      )
    );
}

getConfig.TapestryCIConfig = TapestryCIConfig;

module.exports = getConfig;
