"use strict";

const logger = require("../custom-logger").logger("command:docs-publish");
const subpackages = require("../subpackages");
const statusUpdate = require("../status-update");
const waitsecs = secs => new Promise(r => setTimeout(r, secs * 1000));

const NO_BUILDREC = "Can't find previous build record! :(";

async function command(dir) {
  logger.log("Publishing documentation");
  await waitsecs(5);
  const rec = await statusUpdate.load();
  const recMd = statusUpdate.renderMarkdown(rec);
  if (!rec) throw new Error(NO_BUILDREC);
  //TODO: it would be supremely nice if, in the case of errors, add a subpackages.publishFailedBuild() which still provided this rec/recMd as well
  if (rec.hasErrors) return logger.error("BUILD HAS ERRORS! DOCS-PUBLISH CAN BE SKIPPED!");
  return await subpackages.publishDocs(dir, rec, recMd);
}

module.exports = { command };
