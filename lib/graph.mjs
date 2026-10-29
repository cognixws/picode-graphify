// Local Graphify adapter. Graphs live under the extension's data folder.
// graphify reads GRAPHIFY_OUT when it starts. An absolute value replaces
// <repo>/graphify-out (Python's Path / absolute keeps the right side), so
// `extract` and `update` both write here and the workspace stays clean.
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { INSTALL } from "./view.mjs";

export { INSTALL };

const OUT_NAME = "graphify-out";
const BUILD_MS = 15 * 60 * 1000;
const QUERY_MS = 25 * 1000;
const SUMMARY_BYTES = 32 * 1024 * 1024;

const DROP_ENV = [
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY", "MOONSHOT_API_KEY", "KIMI_API_KEY", "OPENAI_BASE_URL",
  "ANTHROPIC_BASE_URL", "GRAPHIFY_FORCE",
];

export function sameSecret(got, expect) {
  if (!expect) return false;
  const a = Buffer.from(String(got || ""));
  const b = Buffer.from(String(expect));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function contain(workDir, subdir) {
  if (!workDir || typeof workDir !== "string") {
    throw Object.assign(new Error("This agent has no working folder."), { code: "root" });
  }
  const base = resolve(workDir);
  const sub = typeof subdir === "string" ? subdir.trim() : "";
  if (!sub) return base;
  if (isAbsolute(sub)) {
    throw Object.assign(new Error("Name a folder inside the workspace."), { code: "root" });
  }
  const full = resolve(base, sub);
  const rel = relative(base, full);
  if (rel.split(/[/\\]/).includes("..")) {
    throw Object.assign(new Error("That folder is outside the workspace."), { code: "root" });
  }
  return full;
}

export function graphKey(workspaceId, root) {
  const id = String(workspaceId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "workspace";
  const h = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 12);
  return id + "-" + h;
}

export function slotDir(dataDir, key) {
  return join(dataDir, "graphs", key);
}

export function graphPath(dataDir, key) {
  return join(slotDir(dataDir, key), OUT_NAME, "graph.json");
}

function statePath(dataDir, key) {
  return join(slotDir(dataDir, key), "state.json");
}

function writeJSON(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

export function readState(dataDir, key) {
  try {
    return JSON.parse(readFileSync(statePath(dataDir, key), "utf8"));
  } catch {
    return null;
  }
}

export function writeState(dataDir, key, state) {
  writeJSON(statePath(dataDir, key), state);
}

export function whichGraphify(env = process.env) {
  const names = process.platform === "win32" ? ["graphify.exe", "graphify.cmd", "graphify"] : ["graphify"];
  for (const dir of String(env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const p = join(dir, name);
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch { /* next */ }
    }
  }
  return "";
}

// Child env for graphify: code stays local, output stays in our slot.
export function graphifyEnv(base, graphifyOut) {
  const env = { ...base };
  for (const k of Object.keys(env)) {
    if (k.startsWith("PICODE_")) delete env[k];
  }
  for (const k of DROP_ENV) delete env[k];
  env.GRAPHIFY_OUT = graphifyOut;
  env.GRAPHIFY_NO_TIPS = "1";
  return env;
}

export function planBuild({ hasGraph, root, force, slot }) {
  if (hasGraph) {
    const args = ["update", root, "--no-cluster"];
    if (force) args.push("--force");
    return args;
  }
  return ["extract", root, "--code-only", "--no-cluster", "--out", slot];
}

export function enqueue(dataDir, job) {
  const dir = join(dataDir, "jobs");
  mkdirSync(dir, { recursive: true });
  const name = String(Date.now()).padStart(16, "0") + "-" + randomBytes(3).toString("hex") + ".json";
  writeJSON(join(dir, name), job);
  const prev = readState(dataDir, job.key) || {};
  if (prev.state !== "building") {
    writeState(dataDir, job.key, {
      ...prev,
      key: job.key,
      state: "queued",
      workspaceId: job.workspaceId || "",
      name: job.name || "",
      root: job.root,
      queuedAt: new Date().toISOString(),
      error: "",
    });
  }
  return readState(dataDir, job.key);
}

export function listJobs(dataDir) {
  const dir = join(dataDir, "jobs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => {
    const file = join(dir, n);
    return { file, job: JSON.parse(readFileSync(file, "utf8")) };
  });
}

export function recover(dataDir) {
  const root = join(dataDir, "graphs");
  if (!existsSync(root)) return;
  for (const key of readdirSync(root)) {
    const state = readState(dataDir, key);
    if (state?.state === "building") {
      writeState(dataDir, key, {
        ...state,
        state: "error",
        error: "The build stopped because the extension restarted.",
        finishedAt: new Date().toISOString(),
      });
    }
  }
}

export function summarize(file) {
  let size = 0;
  try { size = statSync(file).size; } catch { return { bytes: 0, nodes: null, edges: null }; }
  if (size > SUMMARY_BYTES) return { bytes: size, nodes: null, edges: null };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const nodes = Array.isArray(raw.nodes) ? raw.nodes.length : null;
    const edges = Array.isArray(raw.links) ? raw.links.length : Array.isArray(raw.edges) ? raw.edges.length : null;
    return { bytes: size, nodes, edges };
  } catch {
    return { bytes: size, nodes: null, edges: null };
  }
}

export function runGraphify(bin, args, { env, cwd, timeoutMs, spawnFn } = {}) {
  const start = spawnFn || spawn;
  return new Promise((resolve) => {
    let child;
    try {
      child = start(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: 127, stdout: "", stderr: e.message || String(e) });
      return;
    }
    let out = "";
    let err = "";
    const cap = (s, chunk) => (s + chunk).slice(-65536);
    child.stdout?.on("data", (c) => { out = cap(out, String(c)); });
    child.stderr?.on("data", (c) => { err = cap(err, String(c)); });
    let timer;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000);
      }, timeoutMs);
    }
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout: out, stderr: e.message || String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: out, stderr: err });
    });
  });
}

function tail(text) {
  const line = String(text || "").trim().split("\n").filter(Boolean).pop() || "";
  return line.length > 180 ? line.slice(0, 177) + "…" : line;
}

export async function runBuild(dataDir, job, env = process.env, spawnFn) {
  const bin = whichGraphify(env);
  const now = new Date().toISOString();
  if (!bin) {
    writeState(dataDir, job.key, {
      ...(readState(dataDir, job.key) || {}),
      key: job.key, state: "error", root: job.root, workspaceId: job.workspaceId || "",
      name: job.name || "", error: "graphify is not installed. Run: " + INSTALL,
      finishedAt: now,
    });
    return readState(dataDir, job.key);
  }
  const slot = slotDir(dataDir, job.key);
  const out = join(slot, OUT_NAME);
  mkdirSync(out, { recursive: true });
  const hasGraph = existsSync(join(out, "graph.json"));
  const args = planBuild({ hasGraph, root: job.root, force: job.force === true, slot });
  writeState(dataDir, job.key, {
    ...(readState(dataDir, job.key) || {}),
    key: job.key, state: "building", root: job.root, workspaceId: job.workspaceId || "",
    name: job.name || "", startedAt: now, error: "",
  });
  const result = await runGraphify(bin, args, {
    env: graphifyEnv(env, out), cwd: slot, timeoutMs: BUILD_MS, spawnFn,
  });
  if (result.code !== 0 || !existsSync(join(out, "graph.json"))) {
    writeState(dataDir, job.key, {
      ...(readState(dataDir, job.key) || {}),
      state: "error",
      error: tail(result.stderr) || tail(result.stdout) || "graphify stopped before writing the graph.",
      finishedAt: new Date().toISOString(),
    });
    return readState(dataDir, job.key);
  }
  const counts = summarize(join(out, "graph.json"));
  let hubs = [];
  const hubsRun = await runGraphify(bin, ["god-nodes", "--top", "12", "--json", "--graph", join(out, "graph.json")], {
    env: graphifyEnv(env, out), cwd: slot, timeoutMs: QUERY_MS, spawnFn,
  });
  if (hubsRun.code === 0) {
    try {
      const parsed = JSON.parse(hubsRun.stdout);
      if (Array.isArray(parsed)) {
        hubs = parsed.slice(0, 12).map((n) => ({
          label: String(n.label || n.id || "").slice(0, 120),
          degree: Number(n.degree) || 0,
        })).filter((n) => n.label);
      }
    } catch { /* hubs stay empty; the graph is still ready */ }
  }
  writeState(dataDir, job.key, {
    ...(readState(dataDir, job.key) || {}),
    state: "ready",
    finishedAt: new Date().toISOString(),
    error: "",
    nodes: counts.nodes,
    edges: counts.edges,
    bytes: counts.bytes,
    hubs,
  });
  return readState(dataDir, job.key);
}

let building = false;

// One build at a time. Called on an interval by the process.
export async function drain(dataDir, env = process.env, spawnFn) {
  if (building) return;
  const jobs = listJobs(dataDir);
  if (jobs.length === 0) return;
  const next = jobs[0];
  rmSync(next.file, { force: true });
  building = true;
  try {
    await runBuild(dataDir, next.job, env, spawnFn);
  } finally {
    building = false;
  }
}

function clampBudget(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 2000;
  return Math.max(100, Math.min(4000, Math.trunc(v)));
}

export async function ask(dataDir, key, spec, env = process.env, spawnFn) {
  const bin = whichGraphify(env);
  if (!bin) {
    return { isError: true, text: "graphify is not installed. Ask the person to run: " + INSTALL };
  }
  const file = graphPath(dataDir, key);
  if (!existsSync(file)) {
    return { isError: true, text: "No graph yet. Call graph.build, then graph.status." };
  }
  const out = join(slotDir(dataDir, key), OUT_NAME);
  let args;
  if (spec.tool === "query") {
    args = ["query", spec.question, "--budget", String(clampBudget(spec.budget)), "--graph", file];
  } else if (spec.tool === "explain") {
    args = ["explain", spec.node, "--graph", file];
  } else if (spec.tool === "path") {
    args = ["path", spec.from, spec.to, "--graph", file];
  } else if (spec.tool === "hubs") {
    args = ["god-nodes", "--top", "12", "--json", "--graph", file];
  } else {
    return { isError: true, text: "Unknown tool." };
  }
  const result = await runGraphify(bin, args, {
    env: graphifyEnv(env, out), cwd: slotDir(dataDir, key), timeoutMs: QUERY_MS, spawnFn,
  });
  const text = (result.stdout || result.stderr || "").trim();
  if (result.code === 0 || result.code === 3 || result.code === 4) {
    return { isError: false, text: text || "graphify returned an empty answer.", code: result.code };
  }
  return { isError: true, text: text || "graphify could not answer.", code: result.code };
}

function statusText(state, bin) {
  if (!bin) return { isError: true, text: "graphify is not installed. Ask the person to run: " + INSTALL };
  if (!state || state.state === "empty") {
    return { isError: false, text: "No graph yet for this folder. Call graph.build. It returns immediately and keeps running; call graph.status again to see when it is ready." };
  }
  if (state.state === "queued") {
    return { isError: false, text: "Queued. The build starts as soon as the current one finishes. Call graph.status again." };
  }
  if (state.state === "building") {
    return { isError: false, text: "Building since " + (state.startedAt || "just now") + ". Call graph.status again in a minute." };
  }
  if (state.state === "error") {
    return { isError: true, text: state.error || "The build stopped before it finished." };
  }
  const counts = countsPhrase(state);
  const hubs = (state.hubs || []).slice(0, 8).map((h) => h.label + " (" + h.degree + ")").join(", ");
  return { isError: false, text: "Ready. " + counts + (hubs ? " Hubs: " + hubs + "." : "") };
}

function countsPhrase(state) {
  if (!Number.isFinite(Number(state.nodes))) return "Graph is ready.";
  const edges = Number.isFinite(Number(state.edges)) ? state.edges + " connections" : "connections unread";
  return state.nodes + " symbols, " + edges + ".";
}

function result(text, isError, extra) {
  return {
    content: [{ type: "text", text }],
    isError: !!isError,
    ...(extra ? { structuredContent: extra } : {}),
  };
}

// One picode-tools/1 request. dataDir comes from the daemon's context.
export async function handleTool(request, env = process.env, spawnFn) {
  if (request?.protocol !== "picode-tools/1" || request.capability !== "graph") {
    return result("Unknown tool.", true);
  }
  const tool = request.tool;
  const args = request.arguments || {};
  const ctx = request.context || {};
  const dataDir = ctx.dataDir || env.PICODE_EXT_DATA;
  if (!dataDir) return result("This extension has no data folder.", true);
  let root;
  try {
    root = contain(ctx.workDir, args.subdir);
  } catch (e) {
    return result(e.message, true);
  }
  if (!existsSync(root)) return result("That folder is not on this machine.", true);
  const key = graphKey(ctx.workspace, root);
  const bin = whichGraphify(env);
  if (tool === "status") {
    const s = statusText(readState(dataDir, key), bin);
    return result(s.text, s.isError, readState(dataDir, key) || { state: "empty", key });
  }
  if (tool === "build") {
    if (!bin) return result("graphify is not installed. Ask the person to run: " + INSTALL, true);
    const state = enqueue(dataDir, {
      key, root, workspaceId: ctx.workspace || "", name: "", force: args.force === true,
    });
    const word = state.state === "building" ? "A build is already running." : "Build started.";
    return result(word + " It keeps running after this call. Call graph.status to see when the graph is ready. Code stays on this machine.", false, state);
  }
  if (tool === "query" || tool === "explain" || tool === "path" || tool === "hubs") {
    const spec = { tool };
    if (tool === "query") spec.question = String(args.question || "");
    if (tool === "explain") spec.node = String(args.node || "");
    if (tool === "path") { spec.from = String(args.from || ""); spec.to = String(args.to || ""); }
    if (tool === "query") spec.budget = args.budget;
    const answer = await ask(dataDir, key, spec, env, spawnFn);
    return result(answer.text, answer.isError, { code: answer.code });
  }
  return result("Unknown tool.", true);
}
