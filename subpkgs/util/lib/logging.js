"use strict";

const fs = require("fs");
const chalk = require("chalk");
const fecha = require("fecha");
const prettyMs = require("pretty-ms");
const pkgJson = require("../package.json");
const stripAnsi = require("strip-ansi");
const minimatch = require("minimatch");
const tUtilVersion = pkgJson.fullVersion || pkgJson.version;
const util = require("util");
const padded = (s, n) => new Array(n).fill(" ").reduce((m, x) => (m.length < n ? m + x : m), s);
const lpadded = (s, n) => new Array(n).fill(" ").reduce((m, x) => (m.length < n ? x + m : m), s);

const Syms = {
  Send: Symbol("send message to console"),
  Prepare: Symbol("prepare message string for display"),
  Inspectify: Symbol("prepare data objects for display"),
  Prefix: Symbol("logging prefix for output level"),
  Joiner: Symbol("render superficial log lines"),
  Constants: Symbol("constant values used for defining log levels"),
  State: Symbol("extra state metadata about times and sizes"),
};

Object.freeze(Syms);

// prettier-ignore
const LEVELS = {
  success: { label: "🌟 ", sigil: "♥", color: chalk.bold.green,   color2: chalk.green,   method: "log"   },
  trace:   { label: "🌈 ", sigil: "◣", color: chalk.bold.blue,    color2: chalk.blue,    method: "log"   },
  info:    { label: "💬 ", sigil: "▶", color: chalk.bold.cyan,    color2: chalk.cyan,    method: "log"   },
  warn:    { label: "⚠️ ", sigil: "▲", color: chalk.bold.yellow,  color2: chalk.yellow,  method: "warn"  },
  error:   { label: "💥 ", sigil: "●", color: chalk.bold.red,     color2: chalk.red,     method: "error" },
  debug:   { label: "🤔 ", sigil: "▷", color: chalk.bold.magenta, color2: chalk.magenta, method: "error" },
};

// disable emoji for now :(
for (const level of Object.keys(LEVELS))
  LEVELS[level].label = chalk.dim.white("·") + LEVELS[level].color(LEVELS[level].sigil);

const GLOBAL_STATE = {
  count: 0,
  dbgcount: 0,
  started: new Date(),
  nsSize: 0,
  snsSize: 0,
  tsSize: 8,
  elaSize: 8, // enough for up to `1m 10.0s` through `9m 59.9s` without having to change padding size.
  whSize: 8,
  screenSize: sizing(),
  nslist: [],

  slim: (() => {
    if (process.env.TAPESTRY_SLIM_OUTPUT) return true;
    if (process.argv.includes("--slim")) return true;
    return false;
  })(),

  vanilla: (() => {
    if (process.env.CODEBUILD_BUILD_ID) return true;
    if (process.argv.includes("--vanilla")) return true;
    return false;
  })(),
};

const _slim = () => !!GLOBAL_STATE.slim;
const _vanilla = () => !!GLOBAL_STATE.vanilla;
const _slimOrVanilla = () => _slim() || _vanilla();

// prettier-ignore
const JOINERS = {
  initial: (p, t, e, w) => `   ${p} ╔${t}╦${e}╗`,
  pre:     (p, t, e, w) => `   ${p} ╠${t}╩${e}╝`,
  mid:     (p, t, e, w) => `   ${p} ╟───────────────`,
  pfx:     (p, t, e, w) => `   ${p} ║ `,
  post:    (p, t, e, w) => `   ${p} ╠${t}╦${e}╗`,
  final:   (p, t, e, w) => `   ${p} ╚${t}╩${e}╝`,
};

GLOBAL_STATE.lastMessage = GLOBAL_STATE.started;

if (process.stdout.isTTY) {
  process.stdout.on("resize", () => {
    GLOBAL_STATE.screenSize = sizing();
  });
}

function sizing() {
  let columns = process.env.COLUMNS || 80;
  let rows = process.env.ROWS || 25;
  if (process.stdout.isTTY) {
    try {
      columns = process.stdout.columns;
      rows = process.stdout.rows;
    } catch (_ignore_) {
      /* ignore */
    }
  }

  const size = {
    columns,
    rows,
  };
  return size;
}

const vanillaInspect = data =>
  data.map(
    x =>
      typeof x === "string"
        ? stripAnsi(x)
        : x instanceof Error
          ? { message: x.message, stack: x.stack }
          : x
  );

class Logger {
  constructor(namespace) {
    this.namespace = namespace;
    this.debuggingEnabled = checkDebug(namespace);
    if (namespace.length > GLOBAL_STATE.nsSize) GLOBAL_STATE.nsSize = namespace.length;
    if (this.shortNs.length > GLOBAL_STATE.snsSize) GLOBAL_STATE.snsSize = this.shortNs.length;
    GLOBAL_STATE.nslist.push(namespace);
    methodsOf(this).forEach(method => (this[method] = this[method].bind(this)));
  }

  logger(chunk) {
    const Me = this.constructor;
    return new Me(`${this.namespace}:${chunk}`);
  }

  get elapsed() {
    return Date.now() - GLOBAL_STATE.started;
  }

  get sinceLast() {
    return Date.now() - GLOBAL_STATE.lastMessage;
  }

  get shortNs() {
    const _E = process.env;
    const _A = process.argv;
    const dbgopt = x => x.startsWith("--debug");

    if (_slim()) return "";
    if (_E.TAPESTRY_DEBUG || _E.DEBUG || _A.find(dbgopt)) return this.namespace;
    return this.namespace.split(":").pop();
    // return this.namespace.replace(/^tapestry:/, "");
  }

  startup(name, version) {
    if (!_slimOrVanilla()) console.log(this[Syms.Joiner]("initial", "info"));
    this[Syms.Send]("info", `Starting up : ${name} v${version} / tapestry-util v${tUtilVersion}`);
  }

  shutdown(level = "success", msg = "exiting...") {
    this[Syms.Send](level, msg);
    if (!_slimOrVanilla()) console[LEVELS[level].method](this[Syms.Joiner]("final", level));
  }

  log(msg, ...data) {
    return this[Syms.Send]("info", msg, ...data);
  }

  info(msg, ...data) {
    return this[Syms.Send]("info", msg, ...data);
  }

  success(msg, ...data) {
    return this[Syms.Send]("success", msg, ...data);
  }

  trace(msg, ...data) {
    return this[Syms.Send]("trace", msg, ...data);
  }

  warn(msg, ...data) {
    return this[Syms.Send]("warn", msg, ...data);
  }

  error(msg, ...data) {
    return this[Syms.Send]("error", msg, ...data);
  }

  debug(msg, ...data) {
    return this[Syms.Send]("debug", msg, ...data);
  }

  line(which) {
    if (_vanilla()) return console.log("=".repeat(70));

    if (!which) which = "info";
    const pfx = this[Syms.Prefix](which);
    const len = stripAnsi(pfx).length;

    if (_slim()) return console.log(`${pfx} ${LEVELS[which].color("━".repeat(70 - len))}`);

    let width = GLOBAL_STATE.screenSize.columns - len - 20;
    if (width < 10) width = 10;
    const line = LEVELS[which].color("═".repeat(width));
    return this[Syms.Send](`LINE:${which}`, `\b\b${line}`);
  }

  saveText(path) {
    if (path) GLOBAL_STATE.saveTextPath = path;
    else delete GLOBAL_STATE.saveTextPath;
  }

  saveJson(path) {
    if (path) GLOBAL_STATE.saveJsonPath = path;
    else delete GLOBAL_STATE.saveJsonPath;
  }

  static get _symbols() {
    return Syms;
  }

  static get logLevels() {
    return LEVELS;
  }

  static get [Syms.State]() {
    return GLOBAL_STATE;
  }

  get isSlim() {
    return _slim();
  }
  get isVanilla() {
    return _vanilla();
  }
  get isSlimOrVanilla() {
    return _slimOrVanilla();
  }

  get logLevels() {
    return LEVELS;
  }

  get [Syms.Constants]() {
    return this.constructor[Syms.Constants];
  }

  get [Syms.State]() {
    return this.constructor[Syms.State];
  }

  [Syms.Prefix](level, opts = {}) {
    const { color, sigil, label } = LEVELS[level];

    const now = Date.now();
    const _ms = prettyMs(this.elapsed);
    if (_ms.length > GLOBAL_STATE.elaSize) GLOBAL_STATE.elaSize = _ms.length;
    const ms = lpadded(opts.blank ? "↪" : _ms, GLOBAL_STATE.elaSize);
    const _ts = fecha.format(now, "HH:mm:ss");
    if (_ts.length > GLOBAL_STATE.tsSize) GLOBAL_STATE.tsSize = _ts.length;
    const ts = lpadded(opts.blank ? "↪" : _ts, GLOBAL_STATE.tsSize);
    const nm = padded(opts.blank ? "↪" : this.shortNs, GLOBAL_STATE.snsSize);

    const namePart = `${label} ${nm
      .split(":")
      .map(x => color(x))
      .join(chalk.dim.white(":"))}`;
    const timePart = chalk.dim(ts);
    const elapsedPart = chalk.dim(ms);

    if (_slim()) {
      return [
        timePart,
        color(level === "debug" ? `debug ${LEVELS.debug.sigil} ${this.namespace}` : level),
        color(opts.sigil || sigil),
      ].join(" ");
    }

    const sep = color(" ║ ");
    const end = opts.sigil ? color(` ║ ${opts.sigil}`) : color(` ╠═${sigil}`);
    // const levelPart = color(lpadded(level, GLOBAL_STATE.whSize));
    const _prefix = [namePart, timePart, elapsedPart].join(sep) + end;
    return _prefix;
  }

  [Syms.Send](level, msg, ...data) {
    const shouldPrint = this.debuggingEnabled || level !== "debug";
    // const shouldTrace = ["trace", "warn", "error"].includes(level);
    const shouldTrace = level === "trace";

    let isLine = false;
    const lineMatch = /^LINE:(\w+)$/.exec(level);
    if (lineMatch) {
      level = lineMatch[1];
      isLine = true;
    }

    const { color, color2, sigil } = LEVELS[level];

    const msgid = _slimOrVanilla()
      ? " "
      : color(`[${level === "debug" ? "dbg" : "msg"} #`) +
        color2(`${++GLOBAL_STATE[level === "debug" ? "dbgcount" : "count"]}`) +
        color(`]`);

    if (_vanilla()) {
      /* FUTURE:
      console.log(
        JSON.stringify({
          _tapestryLog: true,
          date: now,
          elapsedMs: _ms,
          namespace: this.namespace,
          level,
          message: stripAnsi(msg),
          data: data.map(d => (typeof d === "string" ? stripAnsi(d) : d)),
        })
      );*/
      console[shouldTrace ? "trace" : "log"](
        `${[this.namespace, level].join(" | ")} >`,
        msg.indexOf("\n") > 1 ? JSON.stringify(msg) : stripAnsi(msg),
        ...(data && data.length ? [JSON.stringify(vanillaInspect(data))] : [])
      );
      return;
    }

    let priors = [];
    if (msg.indexOf("\n") > -1) {
      priors = msg.split("\n");
      msg = priors.pop();
      priors = priors.map((m, i) => this[Syms.Prepare](`${m} ${color2("↩")}`, level));
    }

    const sinceLast = _slim() ? `⏱ ${prettyMs(this.sinceLast)}` : "";
    const prepared = this[Syms.Prepare](msg, level);
    const inspected = this[Syms.Inspectify](data, level, sinceLast);
    const prefix = `${this[Syms.Prefix](level, {
      sigil: priors.length ? "…" : null,
      blank: !!priors.length,
    })}`;
    const fullMsg = `${prepared} ${inspected}`;
    GLOBAL_STATE.lastMessage = new Date();

    if (shouldPrint) {
      const { method } = LEVELS[level];

      // const id = x => x;
      // const msgFilter = _vanilla() ? stripAnsi : id;
      // const prefix = this[Syms.Prefix](level);
      priors.forEach((prior, i) =>
        console[method](
          `${this[Syms.Prefix](level, { sigil: i === 0 ? null : "…", blank: i > 0 })} ${prior}`
        )
      );
      console[method](`${prefix} ${fullMsg} ${msgid}`);
      if (shouldTrace) {
        const tracelines = new Error("OH NO").stack
          .split("\n")
          .slice(3)
          .map(x => {
            const _padding = padded("", GLOBAL_STATE.snsSize);
            const _sep = color(_slim() ? sigil : "║");
            const _at = color2("↪");
            return x
              .replace(/^\s+(at)/, z => `   ${_padding} ${_sep} ${_at}`)
              .replace(/ \(([^:]+)(:(\d+):(\d+))?\)$/, (m, mPath, erp, mLine, mCol) => {
                const newPath = mPath
                  .split("/")
                  .map(x => color2(x))
                  .join(chalk.dim.white("/"));
                const extra =
                  mLine && mCol
                    ? [color(" @ line "), color2(mLine), color(" col "), color2(mCol)].join("")
                    : "";
                const start = color(" 《");
                const end = color("》 ");
                return [start, newPath, extra, end].join("");
              });
          })
          .join("\n");
        console.log(
          _slimOrVanilla()
            ? tracelines
            : `${this[Syms.Joiner]("pre", level)}\n${tracelines}\n${this[Syms.Joiner](
                "post",
                level
              )}`
        );
      }
    }

    // if enabled, debug lines *ALWAYS* save
    if (GLOBAL_STATE.saveJsonPath) {
      const time = Date.now();
      const date = new Date(time);
      const rec = {
        date,
        time,
        namespace: this.namespace,
        level,
        msg: isLine ? "=".repeat(60) : stripAnsi(msg),
        data,
        elapsed: this.elapsed,
        elapsedSinceLastMessage: this.sinceLast,
      };

      if (level === "trace") {
        rec.trace = new Error("OH NO").stack
          .split("\n")
          .slice(2)
          .join("\n");
      }

      const recStr = `${JSON.stringify(rec)}\n`;
      fs.appendFileSync(GLOBAL_STATE.saveJsonPath, recStr, "utf8");
    }

    if (GLOBAL_STATE.saveTextPath) {
      const now = Date.now();
      const elapsed = prettyMs(this.elapsed);
      const date = new Date(now).toISOString();
      const ns = this.namespace;
      const sinceLast = prettyMs(this.sinceLast);

      const myMsg = isLine ? "------------- SEPARATOR -------------" : stripAnsi(msg);

      let str = `${msgid} ${date} : ${ns} ${level} > ${myMsg} (elapsed: ${elapsed}, sinceLast: ${sinceLast})\n`;

      if (data.length) {
        str = `\n${str}`;
        str += data
          .map((x, i) => `${msgid} ${date} :        #${i + 1} > ${JSON.stringify(data)}`)
          .join("\n");
        str += "\n\n";
      }
      fs.appendFileSync(GLOBAL_STATE.saveTextPath, str, "utf8");
    }
  }

  [Syms.Joiner](type, which) {
    const { color } = LEVELS[which];
    const { snsSize, tsSize, elaSize } = GLOBAL_STATE;
    const prefix = lpadded("", snsSize);
    const [tsBar, elaBar] = [tsSize, elaSize].map(s => "═".repeat(s + 2));
    const joiner = JOINERS[type];
    if (!joiner) throw new Error(`Unknown joiner: ${type}`);
    return color(joiner(prefix, tsBar, elaBar));
  }

  /*
  [Syms.Prepare](msg) {
    return msg;
  }
*/
  [Syms.Prepare](msg, level) {
    const out = [];
    const check = () => (matches = /^\[([^\]\s]+)\]\s+/g.exec(rest));
    const { color, color2, sigil } = LEVELS[level];
    let rest = `${msg}`;
    let matches;
    rest = rest.replace(/•/g, color(sigil));
    while (check()) {
      const [full, token] = matches;
      const coloredToken = token
        .split(":")
        .map(x => color2(x.replace(/_/g, " ")))
        .join(chalk.dim.white(":"));
      out.push(`${coloredToken} ${color(sigil)} `);
      rest = rest.slice(full.length);
    }

    const pathrgx = /^(\w{2,4}:\/\/|[.~]?\/)?([a-zA-Z0-9\*\?.~_-]+\/){2,}([a-zA-Z0-9\*\?.~_-]+)?$/; // probably a path!
    rest = rest
      .split(" ")
      .map(x => {
        if (!pathrgx.test(x)) return x;
        const icn = "📄  ";
        return (
          icn +
          x
            .split("/")
            .map(y => color2(y))
            .join(chalk.dim.white("/"))
        );
      })
      .join(" ");

    out.push(rest);
    return out.join("");
  }

  [Syms.Inspectify](items, which, sinceLast) {
    if (items.length === 0) return sinceLast;

    if (_vanilla()) return vanillaInspect(items);

    if (items.length === 1 && typeof items[0] === "string" && !items[0].includes("\n"))
      return [LEVELS[which].color(items[0]), sinceLast].join(" ");

    const formattedItems = items.map((x, i) => {
      const numprefix = items.length > 1 ? `#${i + 1} ` : "";
      const prefix = LEVELS[which].color(
        `   ${lpadded(numprefix, GLOBAL_STATE.snsSize)} ${_slim() ? "|" : "║"} `
      );
      const inspected =
        typeof x === "string" && (x.includes("\n") || stripAnsi(x) !== x)
          ? x.replace(/•/g, LEVELS[which].color(LEVELS[which].sigil))
          : util.inspect(x, {
              depth: 10,
              colors: chalk.enabled,
            });
      const formatted = inspected.replace(/\n$/, "").replace(/^/gm, m => m + prefix);
      if (_slim()) return formatted;
      const trailing = this[Syms.Joiner](i === items.length - 1 ? "post" : "mid", which);
      return `${formatted}\n${trailing}`;
    });

    if (_slim()) return `${sinceLast}\n${formattedItems.join("\n")}\n`;

    return sinceLast + ["", this[Syms.Joiner]("pre", which), ...formattedItems].join("\n");
  }
}

function checkDebug(namespace) {
  if (process.argv.find(x => x === "--debug")) return true;
  const anyMatch = ary =>
    !!ary.find(
      x => minimatch(namespace, x) || (x.endsWith(":*") && namespace === x.replace(/:\*$/, ""))
    );
  const E = process.env;
  const splt = n => E[`${n}DEBUG`].split(",");
  const addTap = x => `tapestry:${x}`;
  if (process.env.TAPESTRY_DEBUG) return anyMatch(splt("TAPESTRY_").map(addTap));
  else if (process.env.DEBUG) return anyMatch(splt(""));

  return false;
}

function methodsOf(instance) {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(instance)).filter(
    property => property !== "constructor" && typeof instance[property] === "function"
  );
}

const BASE_LOGGER = new Logger("tapestry");
const _specialize = (BASE_LOGGER._specialize = t =>
  (BASE_LOGGER[`${t}Logger`] = n => BASE_LOGGER.logger(n ? `${t}:${n}` : t)));
"util ci dev bot".split(" ").forEach(x => _specialize(x));

module.exports = BASE_LOGGER;
