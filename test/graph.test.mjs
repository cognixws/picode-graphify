import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  contain, graphKey, graphifyEnv, planBuild, enqueue, listJobs, recover,
  readState, writeState, summarize, handleTool, runBuild, sameSecret, INSTALL,
} from "../lib/graph.mjs";
import { presentation } from "../lib/view.mjs";
import { extractMap } from "../lib/map.mjs";

const root = mkdtempSync(join(tmpdir(), "graphify-ext-"));
const nested = join(root, "src");
mkdirSync(nested);

test("a folder stays inside the workspace", () => {
  assert.equal(contain(root, ""), root);
  assert.equal(contain(root, "src"), nested);
  assert.throws(() => contain(root, "../etc"), /outside/);
  assert.throws(() => contain(root, "/etc"), /inside/);
  assert.throws(() => contain("", "src"), /working folder/);
});

test("the same workspace and folder share one graph", () => {
  assert.equal(graphKey("ws 1", root), graphKey("ws 1", root));
  assert.notEqual(graphKey("ws 1", root), graphKey("ws 1", nested));
  assert.match(graphKey("ws/1", root), /^ws1-[a-f0-9]{12}$/);
});

test("graphify writes into the extension and receives no API key", () => {
  const env = graphifyEnv({
    PATH: "/usr/bin", GEMINI_API_KEY: "secret", PICODE_EXT_TOKEN: "tok", GRAPHIFY_FORCE: "1",
  }, "/data/graphs/a/graphify-out");
  assert.equal(env.GRAPHIFY_OUT, "/data/graphs/a/graphify-out");
  assert.equal(env.GRAPHIFY_NO_TIPS, "1");
  assert.equal(env.GEMINI_API_KEY, undefined);
  assert.equal(env.PICODE_EXT_TOKEN, undefined);
  assert.equal(env.GRAPHIFY_FORCE, undefined);
  assert.equal(env.PATH, "/usr/bin");
});

test("a first build is code-only and a later one updates in place", () => {
  const first = planBuild({ hasGraph: false, root, force: false, slot: "/data/slot" });
  assert.deepEqual(first, ["extract", root, "--code-only", "--no-cluster", "--out", "/data/slot"]);
  const again = planBuild({ hasGraph: true, root, force: true, slot: "/data/slot" });
  assert.deepEqual(again, ["update", root, "--no-cluster", "--force"]);
  assert.equal(first.join(" ").includes("install"), false);
  assert.equal(again.join(" ").includes("backend"), false);
});

test("a queued build survives, and a build in progress is marked stopped after a restart", () => {
  const data = mkdtempSync(join(tmpdir(), "graphify-data-"));
  const state = enqueue(data, { key: "k", root, workspaceId: "ws", name: "picode", force: false });
  assert.equal(state.state, "queued");
  assert.equal(listJobs(data).length, 1);
  writeState(data, "k", { ...state, state: "building" });
  recover(data);
  assert.equal(readState(data, "k").state, "error");
  assert.match(readState(data, "k").error, /restarted/);
  assert.equal(listJobs(data).length, 1);
});

test("counts come from the graph file", () => {
  const file = join(root, "graph.json");
  writeFileSync(file, JSON.stringify({ nodes: [{ id: "a" }, { id: "b" }], links: [{}] }));
  assert.deepEqual(summarize(file), { bytes: readFileSync(file).length, nodes: 2, edges: 1 });
});

test("the proxy secret is compared in full", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  assert.equal(sameSecret("abc", "abcd"), false);
  assert.equal(sameSecret("", "abc"), false);
  assert.equal(sameSecret("abc", ""), false);
});

function binEnv() {
  const dir = mkdtempSync(join(tmpdir(), "graphify-bin-"));
  writeFileSync(join(dir, "graphify"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "graphify"), 0o755);
  return { PATH: dir, HOME: process.env.HOME };
}

function fakeSpawn(calls) {
  return (bin, args, opts) => {
    calls.push({ args, env: opts.env });
    if (args[0] === "extract" || args[0] === "update") {
      mkdirSync(opts.env.GRAPHIFY_OUT, { recursive: true });
      writeFileSync(join(opts.env.GRAPHIFY_OUT, "graph.json"), JSON.stringify({
        nodes: [{ id: "a" }, { id: "b" }], edges: [{}, {}, {}],
      }));
    }
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      if (args[0] === "god-nodes") child.stdout.emit("data", JSON.stringify([{ label: "Store.Append", degree: 4 }]));
      if (args[0] === "query") child.stdout.emit("data", "found Store.Append");
      child.emit("close", args[0] === "query" && args[1] === "missing" ? 4 : 0);
    });
    return child;
  };
}

test("build is queued and does not run graphify inside the tool call", async () => {
  const data = mkdtempSync(join(tmpdir(), "graphify-data-"));
  const env = binEnv();
  const out = await handleTool({
    protocol: "picode-tools/1", capability: "graph", tool: "build",
    arguments: {}, context: { workDir: root, workspace: "ws", dataDir: data },
  }, env);
  assert.equal(out.isError, false);
  assert.match(out.content[0].text, /Build started/);
  assert.equal(listJobs(data).length, 1);
  assert.equal(listJobs(data)[0].job.root, root);
});

test("a missing graphify command is a tool error with the install line", async () => {
  const data = mkdtempSync(join(tmpdir(), "graphify-data-"));
  const out = await handleTool({
    protocol: "picode-tools/1", capability: "graph", tool: "build",
    arguments: {}, context: { workDir: root, workspace: "ws", dataDir: data },
  }, { PATH: "" });
  assert.equal(out.isError, true);
  assert.match(out.content[0].text, new RegExp(INSTALL));
});

test("the process build is local and then a query reads that graph", async () => {
  const data = mkdtempSync(join(tmpdir(), "graphify-data-"));
  const env = binEnv();
  const calls = [];
  const job = { key: graphKey("ws", root), root, workspaceId: "ws", name: "picode", force: false };
  const state = await runBuild(data, job, env, fakeSpawn(calls));
  assert.equal(state.state, "ready");
  assert.equal(state.nodes, 2);
  assert.equal(state.edges, 3);
  assert.equal(state.hubs[0].label, "Store.Append");
  assert.equal(calls[0].args[0], "extract");
  assert.equal(calls[0].args.includes("--code-only"), true);
  assert.equal(calls[0].env.GEMINI_API_KEY, undefined);
  assert.match(calls[0].env.GRAPHIFY_OUT, /graphify-out$/);
  const answer = await handleTool({
    protocol: "picode-tools/1", capability: "graph", tool: "query",
    arguments: { question: "where is append" },
    context: { workDir: root, workspace: "ws", dataDir: data },
  }, env, fakeSpawn(calls));
  assert.equal(answer.isError, false);
  assert.match(answer.content[0].text, /Store.Append/);
  const miss = calls.filter((c) => c.args[0] === "query").pop();
  assert.equal(miss.args[1], "where is append");
  assert.equal(miss.args.includes("--graph"), true);
});

test("the page states say what is true and name one action", () => {
  const none = presentation({ binary: true, workspaces: [], state: null });
  assert.equal(none.mode, "none");
  assert.match(none.sentence, /Check again/);
  assert.equal(none.action, "Check again");
  const missing = presentation({ binary: false, workspaces: [{ id: "a" }], state: { state: "empty" } });
  assert.equal(missing.action, "Copy install line");
  const empty = presentation({ binary: true, workspaces: [{ id: "a", name: "picode" }], state: { state: "empty" }, name: "picode" });
  assert.equal(empty.action, "Build graph");
  const building = presentation({ binary: true, workspaces: [{ id: "a" }], state: { state: "building" }, name: "picode" });
  assert.match(building.sentence, /picode/);
  assert.equal(building.action, "");
  const failed = presentation({ binary: true, workspaces: [{ id: "a" }], state: { state: "error", error: "disk full" } });
  assert.equal(failed.sentence, "Disk full.");
  assert.equal(failed.action, "Build again");
  const ready = presentation({
    binary: true, workspaces: [{ id: "a" }],
    state: { state: "ready", nodes: 1200, edges: 3400, finishedAt: "2026-10-29T15:10:00Z", hubs: [{ label: "a", degree: 2 }] },
  });
  assert.equal(ready.mode, "ready");
  assert.match(ready.counts, /1,200 symbols/);
  const unknown = presentation({
    binary: true, workspaces: [{ id: "a" }],
    state: { state: "ready", nodes: null, edges: null, finishedAt: "2026-10-29T22:30:00Z", hubs: [{ label: "api()", degree: 3 }] },
  });
  assert.equal(unknown.counts, "Graph ready · built 2026-10-29 22:30");
});

test("the map keeps a call ahead of a file that only contains the symbol", async () => {
  const file = join(root, "graph.json");
  writeFileSync(file, JSON.stringify({
    nodes: [
      { id: "file", label: "app.js" },
      { id: "main", label: "main()" },
      { id: "add", label: "add()" },
    ],
    edges: [
      { source: "file", target: "main", relation: "contains" },
      { source: "main", target: "add", relation: "calls" },
    ],
  }));
  const map = await extractMap(file, [{ label: "main()", degree: 2 }], { maxLinks: 1 });
  assert.equal(map.hubs.length, 1);
  assert.equal(map.hubs[0].links.length, 1);
  assert.equal(map.hubs[0].links[0].label, "add()");
  assert.equal(map.hubs[0].links[0].relation, "calls");
});

test("the map is the largest folders and the imports between them", async () => {
  const file = join(root, "folders.json");
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 6; i++) nodes.push({ id: "b" + i, label: "view" + i, source_file: "web/browser/view" + i + ".js" });
  for (let i = 0; i < 4; i++) nodes.push({ id: "s" + i, label: "shared" + i, source_file: "web/shared/lib" + i + ".js" });
  for (let i = 0; i < 2; i++) nodes.push({ id: "g" + i, label: "main" + i, source_file: "cmd/picode/main.go" });
  for (let i = 0; i < 6; i++) edges.push({ source: "b" + i, target: "s0", relation: "imports_from" });
  edges.push({ source: "g0", target: "s0", relation: "imports" });
  writeFileSync(file, JSON.stringify({ nodes, edges }));
  const map = await extractMap(file, [], { minWeight: 1 });
  assert.equal(map.nodes, 12);
  assert.equal(map.edges, 7);
  assert.deepEqual(map.areas.map((area) => area.id), ["web/browser", "web/shared", "cmd/picode"]);
  assert.equal(map.areas[0].symbols, 6);
  const link = map.links.find((item) => item.from === "web/browser" && item.to === "web/shared");
  assert.equal(link.weight, 6);
  assert.equal(map.links.some((item) => item.from === "cmd/picode"), true);
});
