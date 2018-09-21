"use strict";

const blessed = require("blessed");
const contrib = require("blessed-contrib");

function renderText(text, indent = "", width = 80) {
  const out = [];
  text.split("\n").forEach(line => {
    const splitLines = [];
    while (line.length > width) {
      let breakPoint = line.lastIndexOf(" ", width);
      if (breakPoint < width * 0.7) breakPoint = width - 1;

      const firstLine = line.slice(0, breakPoint);
      const rest = indent + line.slice(breakPoint).trimLeft();
      // console.log("OH NO: ", width, breakPoint, `[first:${firstLine}]`, rest);
      line = rest;
      splitLines.push(firstLine);
    }
    splitLines.push(line);
    out.push(...splitLines);
  });
  return out.join("\n");
}

function textHeight(text, indent = "", width = 80) {
  const rendered = renderText(text, width);
  return Array.from(rendered).reduce((x, chr) => (chr === "\n" ? x + 1 : x), 1);
}

function multisel(label, desc, lst, sel = "✔", unsel = " ", width = 120) {
  const txtsz = textHeight(desc, "", width - 8);
  const barsz = 1;
  const listsz = lst.length < 40 ? lst.length + 4 : 40;
  const vertpad = 1;
  const whatever = 2;
  const height = whatever + txtsz + barsz + listsz + vertpad * 2;

  const selected = new Set();
  const gendata = () => lst.map((str, idx) => [selected.has(idx) ? ` ${sel} ` : "", str]);
  const regen = t => t.setData({ headers: ["  ?", " package"], data: gendata() });
  const maxlen = lst.map(x => blessed.stripTags(x).length).reduce((m, x) => Math.max(m, x), 0);

  const box = blessed.box({
    label,
    width,
    height,
    top: "center",
    left: "center",
    style: {
      fg: "#ea2",
      bg: "#222",
      label: {
        fg: "#2ae",
        bg: "#222",
      },
    },
    border: { type: "line", fg: "#e2a" },
  });
  const textbox = blessed.text({
    top: 1,
    left: 2,
    right: 2,
    padding: 1,
    height: txtsz + 2, // account for padding
    width: width - 6,
    style: {
      bg: "#333",
      fg: "#ea2",
    },
    content: renderText(desc, "", width - 8),
  });

  const table = contrib.table({
    keys: true,
    mouse: true,
    fg: "#2ae",
    bg: "black",
    selectedFg: "#201",
    selectedBg: "#e2a",
    interactive: true,
    width: width - 4,
    height: listsz,
    top: txtsz + 2 + 1,
    left: 1,
    right: 2,
    border: { type: "bg", bg: "#222" },
    columnSpacing: 2, //in chars
    columnWidth: [3, width - 6 - 3],
  });

  box.append(textbox);
  box.append(table);

  regen(table);

  table.focus();

  table.rows.key(["C-a"], () => {
    lst.forEach((x, i) => selected.add(i));
    regen(table);
    table.screen.render();
  });
  table.rows.key(["C-d"], () => {
    lst.forEach((x, i) => selected.delete(i));
    regen(table);
    table.screen.render();
  });

  let cur = 0;
  const curItem = null;

  table.rows.on("select item", (item, index) => {
    cur = index;
  });

  table.rows.key(["space"], (ch, key) => {
    if (selected.has(cur)) selected.delete(cur);
    else selected.add(cur);

    const index = lst.indexOf(cur);
    regen(table);
    table.screen.render();
  });

  table.rows.key(["enter"], (ch, key) => {
    const chosen = [...selected.keys()];
    box.emit("results", chosen.map(x => lst[x]), chosen);
  });

  box.focus = () => table.focus();

  return box;
}

module.exports = multisel;
