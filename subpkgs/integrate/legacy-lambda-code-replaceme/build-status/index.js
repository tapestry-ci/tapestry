"use strict";

//
const qsp = require("querystrings");
const tapUtil = require("@tapestry-ci/util");
const monk = require("monk");
const { StatusManager } = tapUtil.buildStatusUpdates;

function parseQueryStringParameters(event) {
  let toReturn = {};

  if (event.query) toReturn = event.query;
  else if (event.queryStringParameters && typeof event.queryStringParameters === "string")
    toReturn = qsp.parse(event.queryStringParameters);
  else if (event.queryStringParameters && typeof event.queryStringParameters === "object")
    toReturn = event.queryStringParameters;

  return toReturn;
}

function getStatus(event, context) {
  const { project, build: buildStr } = parseQueryStringParameters(event);
  let config, db, manager;
  return Promise.resolve()
    .then(() => tapUtil.ciConfig(undefined, false).then(c => (config = c)))
    .then(() => {
      db = monk(config.deployments.mongodbOptions);
      manager = new StatusManager(project, buildStr, db);
      return manager.load();
    })
    .then(rec => {
      db.close();
      return { statusCode: "200", body: rec ? JSON.stringify(rec) : "" };
    });
}

module.exports = {
  handler: (event, context, callback) => {
    console.log("BUILD-STATUS-EVENT", event);
    return getStatus(event, context)
      .then(r => callback(null, r))
      .catch(callback);
  },
};
