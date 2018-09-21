#!/usr/bin/env node

"use strict";
const logging = require("./lib/logging");

logging.saveText("/tmp/tap-log.txt");
logging.saveJson("/tmp/tap-log.json-stream");
const devlogger = logging.logger("dev-tools");

const loggers = [
  devlogger,
  ..."herp derp wubba dubba lubba fubba".split(" ").map(x => logging.logger(x)),
  ..."one two three four five six seven".split(" ").map(x => logging.utilLogger(x)),
];
const levels = "success info warn error debug trace".split(" ");

const r = a => a[(Math.random() * a.length) | 0];
const getLevel = () => (Math.random() > 0.666 ? r(levels) : "log");
const getLogger = () => r(loggers);

const ITAM = {
  success: "log",
  trace: "log",
  info: "log",
  warn: "warn",
  error: "error",
  debug: "error",
};
const ITAM2 = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 };

devlogger.startup("tapestry-dev-tools", "2.1.3");
devlogger.log("Hello", ITAM);
devlogger.log("Other Hello", ITAM2, ITAM);

for (let i = 0; i < 30; i++) {
  const logger = getLogger();
  const level = getLevel();
  const msg = Math.random()
    .toString(36)
    .slice(2);
  logger[level](msg);
}

for (const logger of loggers.slice(0, 1)) {
  for (const level of levels) {
    logger[level](`test of ${level} /this/part/looks/like/a/path.json whee`);
    logger.line(level);
    logger[level]("[one] [two] [three:four] [five:six:seven] msg");
    logger[level](
      "[a really long message] Your shields were failing, sir. Captain, why are we out here chasing comets? Computer, belay that order. You did exactly what you had to do. You considered all your options, you tried every alternative and then you made the hard choice. When has justice ever been as simple as a rule book? Fear is the true enemy, the only enemy. I'm afraid I still don't understand, sir. Commander William Riker of the Starship Enterprise. Now, how the hell do we defeat an enemy that knows us better than we know ourselves? I'd like to think that I haven't changed those things, sir. I've had twelve years to think about it. And if I had it to do over again, I would have grabbed the phaser and pointed it at you instead of them. Ensign Babyface! Sorry, Data. Wouldn't that bring about chaos? Fate protects fools, little children and ships named Enterprise. Travel time to the nearest starbase? My oath is between Captain Kargan and myself."
    );
    logger[level]("hi\nim a message with\na linefeed or two");
    logger[level]("bullets • get • remade • in • style");
  }
}

const exampleLogger = logging.logger("example:message");
for (const level of levels) exampleLogger[level](level);
