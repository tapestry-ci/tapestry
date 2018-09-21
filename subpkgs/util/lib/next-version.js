"use strict";

const semver = require("semver");

const BAD_ARG = a =>
  new Error(
    `Bad 'forTag' argument given to .nextVersion(). Must be either an empty string, or a string representing a pre-release tag (got: ${a})`
  );

function nextVersion(versionsList, targetVersion, forTag) {
  const curUntagged = semver.maxSatisfying(versionsList, targetVersion);
  const nextUntagged = curUntagged ? semver.inc(curUntagged, "patch") : first(targetVersion);

  if (forTag === "") return nextUntagged;
  else if (!forTag || typeof forTag !== "string") throw BAD_ARG(forTag);

  const firstPrerelease = `${nextUntagged}-${forTag}.0`;
  const maxPrerelease = `${nextUntagged}-${forTag}.999999`; // boy i sure do hope nobody tries to make a million prereleases? :D
  const gteqFirst = `>=${firstPrerelease} <=${maxPrerelease}`;
  const bestMatch = semver.maxSatisfying(versionsList, gteqFirst);
  const nextPrerelease = bestMatch ? semver.inc(bestMatch, "prerelease", forTag) : firstPrerelease;

  return nextPrerelease;
}

function checkLatest(versionsList, targetVersion, forTag) {
  const sorted = semver.rsort(versionsList);
  const _trgChunk = targetVersion.replace(/\./, "\\.");
  const _suffChunk = forTag ? `-${forTag}\\.\\d+` : "";
  const pattern = new RegExp(`^${_trgChunk}\\.\\d+${_suffChunk}(\\+.+)?$`);
  const item = sorted.find(x => pattern.test(x));
  return item;
}

function first(targetVersion) {
  const [major, minor] = targetVersion.split(".", 2);
  return [major, minor, 0].map(x => x || 0).join(".");
}

Object.assign(nextVersion, { first, checkLatest });

module.exports = nextVersion;
