"use strict";

const BUILD_STR_REGEX = (() => {
  const dec = n => `\\d{${n}}`;
  const hex = n => `[0-9a-fA-F]{${n}}`;
  const dot = "\\.";

  const dateparts = [dec(4), dec(2), dec(2), dec(2), dec(2), dec(2), dec(3)]
    .map(x => `(${x})`)
    .join("");
  const buildMode = "[a-zA-Z-]{2,}";
  const deployEnv = "[a-zA-Z]{2,}";

  return new RegExp(`^${dateparts}${dot}(${hex("6,40")})${dot}(${buildMode})${dot}(${deployEnv})`);
})();

const envVarsForAWS = obj =>
  Object.keys(obj).reduce((m, x) => m.concat([{ name: x, value: obj[x].toString() }]), []);

const _keyToEnv = key => `TAPESTRY_${key.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
const _tapVars = (buildInfo, addEnv) => {
  const base = {
    CI: "true",
    CONTINUOUS_INTEGRATION: "true",
  };
  const infoVars = Object.keys(buildInfo).reduce(
    (e, k) => Object.assign(e, { [_keyToEnv(k)]: buildInfo[k] }),
    {}
  );
  return Object.assign(base, infoVars, addEnv || {});
};

const _ifNotPrebuilt = `test -f /.TAPESTRY-CUSTOM-IMAGE ||`;
const _ifNotCITools = `test -f /.TAPESTRY-CUSTOM-IMAGE && npm ls -g @tapestry-ci/ci-tools --json >/dev/null ||`;
const generateBuildSpec = () =>
  `
version: 0.2

phases:
  install:
    commands:
      - ${_ifNotPrebuilt} curl -sL https://deb.nodesource.com/setup_8.x | bash -
      - ${_ifNotPrebuilt} apt-get install -y -qq nodejs
      - ${_ifNotPrebuilt} echo '//registry.npmjs.org/:_authToken=\${NPM_TOKEN}' > \${HOME}/.npmrc
      - ${_ifNotPrebuilt} cp -av \${HOME}/.npmrc /tmp
      - ${_ifNotCITools} npm install -g @tapestry-ci/ci-tools
      - tapestry-ci phase install
  pre_build:
    commands:
      - tapestry-ci phase prebuild
  build:
    commands:
      - tapestry-ci phase build
  post_build:
    commands:
      - tapestry-ci phase postbuild

artifacts:
  base-directory: Artifacts
  files:
    - "**/*"
`;

function codeBuildArgs({ projectName, artifactBucketName, buildInfo, addEnvVars = [] }) {
  const params = {
    projectName,
    sourceVersion: buildInfo.commitId,
    environmentVariablesOverride: envVarsForAWS(_tapVars(buildInfo, addEnvVars)),
    buildspecOverride: generateBuildSpec(),
    artifactsOverride: {
      type: "S3",
      location: artifactBucketName,
      path: `${projectName}/${buildInfo.env}-${buildInfo.buildMode}/${buildInfo.buildStr}`,
      name: `${projectName}.zip`,
      namespaceType: "NONE",
      packaging: "ZIP",
    },
  };
  return params;
}

function create(commitId, date, buildMode, env) {
  if (buildMode === "test-only") env = "none";

  // test-only always implies no build environment

  const dateISO = date.toISOString();
  const dateStamp = dateISO.replace(/\D+/g, "");
  // const commitIdToken = padded(hexToBase62(commitId), 27); // all sha1s when going to b62 fit within 27 chars
  // const dateToken = padded(decToBase62(date.getTime().toString()), 7); // all dates up till ~2081 sometime going to b62 fit under 7 chars

  // const buildId = `${dateToken}.${commitIdToken}.${buildModeToken}${envToken}`;
  const buildStr = `${dateStamp}.${commitId}.${buildMode}.${env}`;

  const info = {
    // buildId,
    buildStr,

    buildMode,
    // buildModeToken,

    commitId,
    // commitIdToken,

    date,
    dateISO,
    dateStamp,
    // dateToken,

    env,
    // envToken,
  };

  return info;
}

create.fromBuildStr = (str, dateOverride) => {
  const matches = str.match(BUILD_STR_REGEX);
  if (!matches) return null;

  const [, Y, M, D, h, m, s, ms, commitId, buildMode, env] = matches;
  const date = dateOverride || new Date(`${Y}-${M}-${D}T${h}:${m}:${s}.${ms}Z`);
  return create(commitId, date, buildMode, env);
};

const tapestryEnvVars = (commit, date, mode, env, addEnv) =>
  _tapVars(create(commit, date, mode, env), addEnv);
// tapestryEnvVars.fromBuildId = (id, date, addEnv) => _tapVars(create.fromBuildId(id, date), addEnv);
tapestryEnvVars.fromBuildStr = (str, date, addEnv) =>
  _tapVars(create.fromBuildStr(str, date), addEnv);
tapestryEnvVars.fromBuildInfo = (inf, addEnv) => _tapVars(inf, addEnv);

module.exports = {
  create,
  tapestryEnvVars,
  codeBuildArgs,
  generateBuildSpec,
};
