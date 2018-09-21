"use strict";

const { test } = require("ava");
const reportData = require("../data/build-reports");
const {
  renderSlackMessage,
  renderSlackErrorDM,
} = require("../build-finished/render-slack-message");

reportData.keys.forEach(name => {
  test(`renderSlackMessage:${name}: can render an object without failing`, t => {
    const { build, report } = reportData.get(name);
    const obj = renderSlackMessage(build, report, []);
    t.true(obj.attachments.length > 0, "should have attachments");
    t.true(
      !!(obj.text && typeof obj.text === "string" && obj.text.length > 10),
      "should have a text entry that's not useless"
    );
  });

  if (reportData.get(name).report.hasErrors) {
    test(`renderSlackErrorDM:${name}: can render an object without failing`, t => {
      const { build, report } = reportData.get(name);
      const obj = renderSlackErrorDM(build, report, []);
      t.true(
        !!(obj.text && typeof obj.text === "string" && obj.text.length > 10),
        "should have a text entry that's not useless"
      );
    });
  }
});
