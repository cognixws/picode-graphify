// What the Graph page says. One place, so the page and the tests match.

export const INSTALL = "uv tool install graphifyy";

export function shortName(name) {
  const t = String(name || "").trim() || "this workspace";
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
}

function errorSentence(text) {
  let t = String(text || "").replace(/[A-Za-z]:\\[^\s]+/g, "").replace(/\/[^\s]+/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 180) t = t.slice(0, 177) + "…";
  if (t.length < 8) return "The build stopped before the graph was written.";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

export function countsLine(state) {
  const when = state?.finishedAt ? " · built " + String(state.finishedAt).slice(0, 16).replace("T", " ") : "";
  const n = Number(state?.nodes);
  const e = Number(state?.edges);
  // A missing count is unknown. Number(null) is 0, which would claim an empty graph.
  if (state?.nodes == null || !Number.isFinite(n)) return "Graph ready" + when;
  const edges = state?.edges == null || !Number.isFinite(e) ? "" : " · " + e.toLocaleString("en-US") + " connections";
  return n.toLocaleString("en-US") + " symbols" + edges + when;
}

// binary: graphify is on PATH. workspaces: ones this extension is on in.
// state: the graph record for the selected workspace.
export function presentation({ binary, workspaces, state, name }) {
  if (!workspaces || workspaces.length === 0) {
    return {
      mode: "none",
      title: "No workspace is using Graphify",
      sentence: "Check again after you turn it on for a workspace.",
      action: "Check again",
    };
  }
  if (!binary) {
    return {
      mode: "missing",
      title: "Graphify is not installed",
      sentence: "Copy the install line and run it, then build the graph of this workspace.",
      action: "Copy install line",
    };
  }
  const s = state?.state || "empty";
  if (s === "building") {
    return {
      mode: "building",
      title: "Building the graph",
      sentence: "Reading the code in " + shortName(name) + ". Closing this page leaves the build running.",
      action: "",
    };
  }
  if (s === "queued") {
    return {
      mode: "queued",
      title: "The build is waiting",
      sentence: "It starts as soon as the current one finishes.",
      action: "",
    };
  }
  if (s === "error") {
    return {
      mode: "error",
      title: "The build stopped",
      sentence: errorSentence(state?.error),
      action: "Build again",
    };
  }
  if (s !== "ready") {
    return {
      mode: "empty",
      title: "No graph for this workspace yet",
      sentence: "Build reads the code on this machine and keeps the graph with this extension.",
      action: "Build graph",
    };
  }
  return {
    mode: "ready",
    title: "",
    sentence: "",
    action: "Build again",
    counts: countsLine(state),
    hubs: Array.isArray(state?.hubs) ? state.hubs.slice(0, 12) : [],
  };
}
