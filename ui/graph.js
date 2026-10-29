import { INSTALL, presentation } from "../lib/view.mjs";

const root = document.getElementById("root");
const params = new URLSearchParams(location.search);
const previewName = window.parent === window ? params.get("preview") : "";

const PREVIEW = {
  none: { binary: true, workspaces: [], state: null },
  missing: { binary: false, workspaces: [{ id: "ws", name: "picode" }], state: { state: "empty" } },
  empty: { binary: true, workspaces: [{ id: "ws", name: "picode" }], state: { state: "empty" } },
  building: { binary: true, workspaces: [{ id: "ws", name: "picode" }], state: { state: "building", startedAt: "2026-10-29T15:04:00Z" } },
  error: { binary: true, workspaces: [{ id: "ws", name: "picode" }], state: { state: "error", error: "The disk filled up before the graph was written." } },
  ready: {
    binary: true,
    workspaces: [{ id: "ws", name: "COGNIX workspace" }],
    state: {
      state: "ready", nodes: 12400, edges: 40112, finishedAt: "2026-10-29T15:10:00Z",
      hubs: [{ label: "Store.Append", degree: 86 }, { label: "openTab", degree: 54 }, { label: "frameProcess", degree: 31 }],
    },
    map: {
      version: 2,
      nodes: 49846,
      edges: 529068,
      areas: [
        { id: "internal/server", label: "internal/server", symbols: 9037 },
        { id: "web/shared", label: "web/shared", symbols: 6227 },
        { id: "web/browser", label: "web/browser", symbols: 5654 },
        { id: "internal/store", label: "internal/store", symbols: 3339 },
        { id: "web/mobile", label: "web/mobile", symbols: 2893 },
        { id: "desktop-shell/src", label: "desktop-shell/src", symbols: 2439 },
      ],
      links: [
        { from: "web/browser", to: "web/shared", weight: 1782 },
        { from: "web/mobile", to: "web/shared", weight: 1203 },
        { from: "internal/server", to: "internal/store", weight: 1074 },
      ],
      hubs: [
        { id: "store", label: "Store.Append", degree: 86, links: [
          { id: "event", label: "writeEvent", relation: "calls" },
          { id: "tx", label: "begin", relation: "calls" },
          { id: "row", label: "insertRow", relation: "calls" },
        ] },
        { id: "tab", label: "openTab", degree: 54, links: [{ id: "frame", label: "frameProcess", relation: "calls" }] },
        { id: "frame", label: "frameProcess", degree: 31, links: [{ id: "tab", label: "openTab", relation: "calls" }] },
      ],
    },
  },
  long: {
    binary: true,
    workspaces: [{ id: "ws", name: "workspace-with-a-very-long-name-that-must-stay-inside-the-toolbar-and-not-push-the-button-off-the-page" }],
    state: {
      state: "ready", nodes: 250000, edges: 1400000, finishedAt: "2026-10-29T18:02:00Z",
      hubs: Array.from({ length: 12 }, (_, i) => ({ label: "symbol_" + "n".repeat(40) + "_" + i, degree: 1000 - i })),
    },
    map: {
      version: 2,
      nodes: 250000,
      edges: 1400000,
      areas: Array.from({ length: 12 }, (_, i) => ({
        id: "internal/part_" + "p".repeat(18) + "_" + i,
        label: "internal/part_" + "p".repeat(18) + "_" + i,
        symbols: 9000 - i * 500,
      })),
      links: Array.from({ length: 8 }, (_, i) => ({
        from: "internal/part_" + "p".repeat(18) + "_" + i,
        to: "internal/part_" + "p".repeat(18) + "_" + ((i + 1) % 12),
        weight: 400 - i * 30,
      })),
      hubs: Array.from({ length: 12 }, (_, i) => ({
        id: "h" + i,
        label: "symbol_" + "n".repeat(40) + "_" + i,
        degree: 1000 - i,
        links: Array.from({ length: 6 }, (_, j) => ({ id: "n" + i + j, label: "neighbor_" + "m".repeat(24) + "_" + j, relation: "calls" })),
      })),
    },
  },
};

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children || []) node.append(child);
  return node;
}

function svg(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

function shortLabel(text, chars) {
  const t = String(text || "");
  if (t.length <= chars) return t;
  return "…" + t.slice(-(chars - 1));
}

let focusLabel = "";
let focusArea = "";
let measureCtx = null;

// Canvas width plus a few pixels, so an SVG glyph that renders wider still fits.
function textWidth(text) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  measureCtx.font = "12px " + family;
  return Math.ceil(measureCtx.measureText(String(text || "")).width) + 6;
}

function areaSentence(map) {
  const area = (map?.areas || []).find((item) => item.id === focusArea);
  if (!area) return "Each circle is a folder, sized by how much code it holds. A line means one folder calls or imports another.";
  const next = (map.links || []).filter((link) => link.from === area.id).sort((a, b) => b.weight - a.weight)[0];
  const held = area.label + " holds " + Number(area.symbols).toLocaleString("en-US") + " symbols.";
  return next ? held + " Most of its calls and imports go to " + next.to + "." : held;
}

function layoutAreas(areas, links, width) {
  const cols = width < 520 ? 2 : areas.length > 8 ? 4 : 3;
  const rows = Math.ceil(areas.length / cols);
  const cellW = width / cols;
  const cellH = width < 520 ? 108 : 120;
  const height = rows * cellH + 8;
  const maxSym = Math.max(1, ...areas.map((area) => area.symbols || 1));
  const maxR = Math.min(28, cellW * 0.22, cellH * 0.24);
  const nodes = areas.map((area, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      ...area,
      r: 12 + (maxR - 12) * Math.sqrt((area.symbols || 1) / maxSym),
      x: (col + 0.5) * cellW,
      y: row * cellH + cellH * 0.38,
      cellW,
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = (links || []).map((link) => ({ a: byId.get(link.from), b: byId.get(link.to), weight: link.weight || 1 })).filter((edge) => edge.a && edge.b);
  return { nodes, edges, height };
}

function drawAreas(stage, map) {
  const areas = map.areas || [];
  const width = Math.max(280, root.clientWidth || 640);
  const laid = layoutAreas(areas, map.links || [], width);
  const height = laid.height;
  const picture = svg("svg", { viewBox: "0 0 " + width + " " + height, role: "group", "aria-label": "Folders in this workspace" });
  const maxW = Math.max(1, ...laid.edges.map((edge) => edge.weight));
  if (!(map.areas || []).some((area) => area.id === focusArea)) focusArea = "";
  for (const edge of laid.edges) {
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const x1 = edge.a.x + (dx / len) * edge.a.r;
    const y1 = edge.a.y + (dy / len) * edge.a.r;
    const x2 = edge.b.x - (dx / len) * (edge.b.r + 2);
    const y2 = edge.b.y - (dy / len) * (edge.b.r + 2);
    const stroke = (1.25 + 2.2 * Math.log10(edge.weight + 1) / Math.log10(maxW + 1)).toFixed(2);
    picture.append(svg("line", { class: "edge", x1, y1, x2, y2, "stroke-width": stroke }));
    const ux = dx / len;
    const uy = dy / len;
    const size = 7;
    picture.append(svg("polygon", {
      class: "edge-head",
      points: [
        [x2, y2],
        [x2 - ux * size + -uy * 3.4, y2 - uy * size + ux * 3.4],
        [x2 - ux * size - -uy * 3.4, y2 - uy * size - ux * 3.4],
      ].map((point) => point.map((n) => n.toFixed(1)).join(",")).join(" "),
    }));
  }
  for (const node of laid.nodes) {
    const current = node.id === focusArea;
    const bubble = svg("circle", {
      class: "bubble",
      cx: node.x,
      cy: node.y,
      r: node.r,
      tabindex: "0",
      role: "button",
      "aria-label": node.label + ", " + Number(node.symbols).toLocaleString("en-US") + " symbols",
      "data-area": node.id,
    });
    if (current) bubble.setAttribute("data-current", "true");
    const title = svg("title");
    title.textContent = node.label + " · " + Number(node.symbols).toLocaleString("en-US") + " symbols";
    bubble.append(title);
    let chars = Math.max(6, Math.floor((node.cellW - 16) / 7));
    let shown = shortLabel(node.label, chars);
    while (textWidth(shown) > node.cellW - 12 && chars > 5) {
      chars -= 1;
      shown = shortLabel(node.label, chars);
    }
    const tw = textWidth(shown);
    const ly = node.y + node.r + 16;
    const halo = svg("rect", {
      x: node.x - tw / 2 - 2,
      y: ly - 12,
      width: tw + 4,
      height: 16,
      fill: "var(--pc-panel)",
    });
    const label = svg("text", { class: "bubble-label", x: node.x, y: ly, "text-anchor": "middle" });
    label.textContent = shown;
    picture.append(halo, bubble, label);
  }
  stage.append(picture);
  return stage;
}

// The folders of the workspace. A chosen symbol replaces that with its own links.
function drawMap(map) {
  const stage = el("div", { class: "stage" });
  const hubs = map?.hubs || [];
  const areas = map?.areas || [];
  if (map?.pending) {
    stage.append(el("p", { class: "map-note", text: "Drawing the map of this workspace." }));
    return stage;
  }
  if (map?.error || (areas.length === 0 && hubs.length === 0)) {
    stage.append(el("p", { class: "map-note", text: "The picture of this graph could not be drawn." }));
    return stage;
  }
  if (focusLabel && !hubs.some((hub) => hub.label === focusLabel)) focusLabel = "";
  if (!focusLabel && areas.length) return drawAreas(stage, map);
  const hub = hubs.find((item) => item.label === focusLabel) || hubs[0];
  if (!hub) {
    stage.append(el("p", { class: "map-note", text: "The picture of this graph could not be drawn." }));
    return stage;
  }
  const links = (hub.links || []).slice(0, 8);
  // User units match CSS pixels, so a 12px label stays 12px on a narrow pane.
  const width = Math.max(280, root.clientWidth || 640);
  const height = 300;
  const PAD = 8;
  const GAP = 12;
  const picture = svg("svg", { viewBox: "0 0 " + width + " " + height, role: "group", "aria-label": "Symbols connected to " + hub.label });
  const cx = width / 2;
  const cy = 128;
  let chars = width < 480 ? 9 : 16;
  const fit = () => {
    const shown = links.map((link) => shortLabel(link.label, chars));
    const widest = shown.reduce((max, label) => Math.max(max, textWidth(label)), 0);
    return { shown, widest, radius: width / 2 - widest - GAP - PAD };
  };
  let plan = fit();
  while (plan.radius < 56 && chars > 5) {
    chars -= 2;
    plan = fit();
  }
  const radius = Math.min(112, Math.max(40, plan.radius));
  const place = (i, count) => {
    if (count === 1) return -Math.PI / 2;
    const gap = 1.35;
    const sweep = Math.PI * 2 - gap;
    const start = Math.PI / 2 + gap / 2;
    return start + (i * sweep) / (count - 1);
  };
  // Leave room above the top label and below the hub name.
  const reachCap = Math.min(radius, cy - (PAD + 22), height - PAD - 36 - cy);
  links.forEach((link, i) => {
    const angle = place(i, links.length);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = cx + cos * radius;
    const y = cy + sin * reachCap;
    const len = Math.hypot(x - cx, y - cy) || 1;
    const dx = (x - cx) / len;
    const dy = (y - cy) / len;
    picture.append(svg("line", {
      class: "edge",
      x1: cx + dx * 12,
      y1: cy + dy * 12,
      x2: x - dx * 8,
      y2: y - dy * 8,
    }));
    const shown = plan.shown[i];
    const tw = textWidth(shown);
    let anchor = "start";
    let tx = x + GAP;
    let ty = y + 4;
    if (cos < -0.25) {
      anchor = "end";
      tx = Math.max(PAD + tw, x - GAP);
    } else if (cos > 0.25) {
      tx = Math.min(width - PAD - tw, x + GAP);
    } else {
      anchor = "middle";
      tx = Math.min(width - PAD - tw / 2, Math.max(PAD + tw / 2, x));
      ty = sin < 0 ? y - 14 : y + 16;
    }
    ty = Math.min(height - PAD, Math.max(PAD + 12, ty));
    const text = svg("text", { x: tx, y: ty, "text-anchor": anchor });
    text.textContent = shown;
    const hit = svg("circle", { class: "hit", cx: x, cy: y, r: 16, tabindex: "0", role: "button", "aria-label": link.relation + " " + link.label, "data-symbol": link.label });
    const title = svg("title");
    title.textContent = link.relation + " " + link.label;
    hit.append(title);
    picture.append(svg("circle", { class: "dot-near", cx: x, cy: y, r: 5 }), text, hit);
  });
  let hubChars = Math.max(chars, 14);
  let shownName = shortLabel(hub.label, hubChars);
  while (textWidth(shownName) > width - PAD * 2 && hubChars > 5) {
    hubChars -= 2;
    shownName = shortLabel(hub.label, hubChars);
  }
  const name = svg("text", { x: cx, y: cy + 32, "text-anchor": "middle" });
  name.textContent = shownName;
  const haloW = Math.min(width - PAD * 2, textWidth(shownName) + 8);
  const halo = svg("rect", { x: cx - haloW / 2, y: cy + 16, width: haloW, height: 20, rx: 4, fill: "var(--pc-panel)" });
  const hubHit = svg("circle", { class: "hit", cx, cy, r: 18, tabindex: "0", role: "button", "aria-label": hub.label, "data-symbol": hub.label, "data-hub": "true" });
  picture.append(svg("circle", { class: "dot-hub", cx, cy, r: 8 }), halo, name, hubHit);
  stage.append(picture);
  return stage;
}

function draw(model, workspaces, selected, map) {
  root.replaceChildren();
  const title = el("h1", { class: "pc-title", text: "Graph" });
  const bar = el("div", { class: "toolbar", "data-align-row": "" });
  const select = el("select", { class: "pc-select", id: "workspace", "aria-label": "Workspace" });
  const nameBudget = Math.max(12, Math.floor(((root.clientWidth || 640) - 168) / 7));
  const fitName = (name) => {
    const t = String(name || "");
    return t.length <= nameBudget ? t : t.slice(0, nameBudget - 1) + "…";
  };
  for (const ws of workspaces) {
    const full = ws.name || ws.id;
    const opt = el("option", { value: ws.id, text: fitName(full), title: full });
    if (ws.id === selected) opt.selected = true;
    select.append(opt);
  }
  const chosen = workspaces.find((ws) => ws.id === selected);
  if (chosen) select.title = chosen.name || chosen.id;
  if (workspaces.length === 0) select.append(el("option", { value: "", text: "No workspace" }));
  bar.append(select);
  if (model.mode === "ready") {
    bar.append(el("button", { class: "pc-button", type: "button", id: "build", text: "Build again" }));
  }
  root.append(title, bar);

  if (model.mode !== "ready") {
    const card = el("div", { class: "empty" });
    card.append(el("h2", { text: model.title }));
    card.append(el("p", { text: model.sentence }));
    if (model.action) {
      const btn = el("button", { class: "pc-button primary", type: "button", id: "action", text: model.action });
      card.append(btn);
    }
    root.append(card);
    return;
  }

  const counts = el("p", { class: "counts" });
  const parts = String(model.counts || "").split(" · ");
  for (const part of parts) counts.append(el("span", { text: part }));
  root.append(counts, drawMap(map));
  const looking = focusLabel && (map?.hubs || []).some((hub) => hub.label === focusLabel);
  root.append(el("p", { class: "map-note", text: looking
    ? "The most connected symbols, and a few of what each one touches."
    : areaSentence(map) }));
  if (looking) root.append(el("button", { class: "pc-button", type: "button", id: "folders", text: "Show folders" }));
  // The sentence sits under the picture, so a click is visible without scrolling past the list.
  root.append(el("pre", { class: "result", id: "result" }));
  if (model.hubs.length) {
    const list = el("div", { class: "hubs" });
    for (const hub of model.hubs) {
      const row = el("button", { class: "hub-row", type: "button", "data-symbol": hub.label, "data-hub": "true" });
      if (hub.label === focusLabel) row.setAttribute("aria-current", "true");
      row.append(el("span", { text: hub.label }));
      row.append(el("span", { class: "pc-muted", text: String(hub.degree) }));
      list.append(row);
    }
    root.append(el("h2", { class: "hubs-title", text: "Most connected" }), list);
  }
  const ask = el("div", { class: "toolbar", "data-align-row": "" });
  const input = el("input", { class: "pc-input", id: "question", type: "text", placeholder: "What connects to this?", "aria-label": "Question" });
  const button = el("button", { class: "pc-button primary", type: "button", id: "ask", text: "Ask" });
  ask.append(input, button);
  root.append(ask);
}

async function liveCall(path, method, body) {
  const proc = await picode.use("process");
  if (!proc) throw new Error("Open Graph from Apps.");
  const response = await proc.request(path, { method, body });
  let data = null;
  try { data = JSON.parse(response.body || ""); } catch { data = null; }
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error((data && data.error) || "The graph service did not answer.");
  }
  return data;
}

async function copyInstall() {
  try {
    const links = window.picode ? await picode.use("links") : null;
    if (links) await links.copy(INSTALL);
    else await navigator.clipboard.writeText(INSTALL);
  } catch { /* the command is also in the sentence's action */ }
}

let timer = 0;
let selected = "";
let last = null;
let loadGen = 0;

async function load(api) {
  const gen = ++loadGen;
  const list = await api("/workspaces", "GET");
  const workspaces = list.workspaces || [];
  if (!selected || !workspaces.some((w) => w.id === selected)) selected = workspaces[0]?.id || "";
  let state = { state: "empty" };
  if (selected) state = await api("/status?workspace=" + encodeURIComponent(selected), "GET");
  if (gen !== loadGen) return;
  const ws = workspaces.find((w) => w.id === selected);
  const binary = list.binary !== false && state.binary !== false;
  let shown = presentation({ binary, workspaces, state, name: ws?.name });
  let picture = null;
  if (shown.mode === "ready") {
    picture = { pending: true };
    last = { model: shown, workspaces, selected, map: picture, api };
    const typed = document.getElementById("question")?.value || "";
    draw(shown, workspaces, selected, picture);
    const pendingInput = document.getElementById("question");
    if (pendingInput && typed) pendingInput.value = typed;
    wire(api, shown);
    try {
      picture = await api("/map?workspace=" + encodeURIComponent(selected), "GET");
    } catch {
      picture = { error: true };
    }
    if (gen !== loadGen) return;
    if (picture?.nodes != null) {
      shown = presentation({
        binary, workspaces, name: ws?.name,
        state: { ...state, nodes: picture.nodes, edges: picture.edges },
      });
    }
  }
  last = { model: shown, workspaces, selected, map: picture, api };
  const typed = document.getElementById("question")?.value || "";
  draw(shown, workspaces, selected, picture);
  const input = document.getElementById("question");
  if (input && typed) input.value = typed;
  wire(api, shown);
  clearInterval(timer);
  if (shown.mode === "building" || shown.mode === "queued") timer = setInterval(() => load(api).catch(showFail), 2000);
}

function showFail(err) {
  const model = { mode: "error", title: "The graph service did not answer", sentence: err.message || "Check that the extension is running, then try again.", action: "Check again" };
  draw(model, [], "");
  document.getElementById("action")?.addEventListener("click", () => boot());
}

function wire(api, model) {
  document.getElementById("workspace")?.addEventListener("change", (e) => {
    selected = e.target.value;
    load(api).catch(showFail);
  });
  document.getElementById("build")?.addEventListener("click", () => {
    if (!selected) return;
    api("/build", "POST", { workspace: selected }).then(() => load(api)).catch(showFail);
  });
  const showSymbol = (label, hub) => {
    if (hub) {
      focusLabel = label;
      if (last) {
        const keep = document.getElementById("question")?.value || "";
        draw(last.model, last.workspaces, last.selected, last.map);
        const input = document.getElementById("question");
        if (input && keep) input.value = keep;
        wire(api, last.model);
      }
      return;
    }
    const out = document.getElementById("result");
    out.textContent = "Looking up " + label + ".";
    out.scrollIntoView({ block: "nearest" });
    api("/explain", "POST", { workspace: selected, node: label }).then((answer) => {
      out.textContent = answer.text || "";
    }).catch((e) => { out.textContent = e.message || "The symbol could not be explained."; });
  };
  document.getElementById("folders")?.addEventListener("click", () => {
    focusLabel = "";
    if (!last) return;
    const keep = document.getElementById("question")?.value || "";
    draw(last.model, last.workspaces, last.selected, last.map);
    const input = document.getElementById("question");
    if (input && keep) input.value = keep;
    wire(api, last.model);
  });
  root.querySelectorAll("[data-area]").forEach((node) => {
    const run = () => {
      focusArea = node.getAttribute("data-area") || "";
      focusLabel = "";
      if (!last) return;
      const keep = document.getElementById("question")?.value || "";
      draw(last.model, last.workspaces, last.selected, last.map);
      const kept = document.getElementById("question");
      if (kept && keep) kept.value = keep;
      wire(api, last.model);
    };
    node.addEventListener("click", run);
    node.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  });
  root.querySelectorAll("[data-symbol]").forEach((node) => {
    const run = () => showSymbol(node.getAttribute("data-symbol"), node.getAttribute("data-hub") === "true");
    node.addEventListener("click", run);
    if (node.tagName !== "BUTTON") node.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  });
  document.getElementById("action")?.addEventListener("click", () => { void (async () => {
    if (model.mode === "missing") {
      await copyInstall();
      const btn = document.getElementById("action");
      if (btn) btn.textContent = "Copied";
      return;
    }
    if (model.mode === "none" || model.mode === "error" && model.action === "Check again") { await load(api); return; }
    if (!selected) { await load(api); return; }
    await api("/build", "POST", { workspace: selected, force: model.mode === "error" });
    await load(api);
  })().catch(showFail); });
  const ask = document.getElementById("ask");
  const input = document.getElementById("question");
  const run = async () => {
    const question = input.value.trim();
    const out = document.getElementById("result");
    if (!question) { out.textContent = "Write a question first."; return; }
    out.textContent = "Looking through the graph.";
    try {
      const answer = await api("/query", "POST", { workspace: selected, question });
      out.textContent = answer.text || "";
    } catch (e) {
      out.textContent = e.message || "The question could not be answered.";
    }
  };
  ask?.addEventListener("click", run);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

async function boot() {
  if (previewName && PREVIEW[previewName]) {
    const sample = structuredClone(PREVIEW[previewName]);
    selected = sample.workspaces[0]?.id || "";
    const api = async (path, method, body) => {
      if (path === "/workspaces") return { binary: sample.binary, workspaces: sample.workspaces };
      if (path.startsWith("/status")) return { binary: sample.binary, ...(sample.state || { state: "empty" }) };
      if (path.startsWith("/map")) return sample.map || { hubs: [] };
      if (path === "/explain") return { text: String(body?.node || "") + " is one symbol in this graph." };
      if (path === "/build") {
        sample.state = { ...(sample.state || {}), state: "building", startedAt: new Date().toISOString() };
        return sample.state;
      }
      if (path === "/query") {
        const q = String(body?.question || "");
        return { text: q ? "Store.Append writes the event in the same transaction." : "" };
      }
      return body || {};
    };
    await load(api);
    return;
  }
  if (!window.picode) {
    draw({ mode: "error", title: "Open Graph from Apps", sentence: "This page talks to COGNIX[WS], which is not connected here.", action: "" }, [], "");
    return;
  }
  try {
    await load(liveCall);
  } catch (e) {
    showFail(e);
  }
}

boot();
