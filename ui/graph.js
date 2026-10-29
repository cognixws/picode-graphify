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
  },
  long: {
    binary: true,
    workspaces: [{ id: "ws", name: "workspace-with-a-very-long-name-that-must-stay-inside-the-toolbar-and-not-push-the-button-off-the-page" }],
    state: {
      state: "ready", nodes: 250000, edges: 1400000, finishedAt: "2026-10-29T18:02:00Z",
      hubs: Array.from({ length: 12 }, (_, i) => ({ label: "symbol_" + "n".repeat(40) + "_" + i, degree: 1000 - i })),
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

function draw(model, workspaces, selected) {
  root.replaceChildren();
  const title = el("h1", { class: "pc-title", text: "Graph" });
  const bar = el("div", { class: "toolbar", "data-align-row": "" });
  const select = el("select", { class: "pc-select", id: "workspace", "aria-label": "Workspace" });
  for (const ws of workspaces) {
    const opt = el("option", { value: ws.id, text: ws.name || ws.id });
    if (ws.id === selected) opt.selected = true;
    select.append(opt);
  }
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
  root.append(counts);
  if (model.hubs.length) {
    const list = el("ul", { class: "hubs" });
    for (const hub of model.hubs) {
      const row = el("li", {});
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
  root.append(ask, el("pre", { class: "result", id: "result" }));
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

async function load(api) {
  const list = await api("/workspaces", "GET");
  const workspaces = list.workspaces || [];
  if (!selected || !workspaces.some((w) => w.id === selected)) selected = workspaces[0]?.id || "";
  let state = { state: "empty" };
  if (selected) state = await api("/status?workspace=" + encodeURIComponent(selected), "GET");
  const ws = workspaces.find((w) => w.id === selected);
  const binary = list.binary !== false && state.binary !== false;
  const shown = presentation({ binary, workspaces, state, name: ws?.name });
  draw(shown, workspaces, selected);
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
