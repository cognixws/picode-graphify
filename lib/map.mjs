// A small picture of a graph that is too large to draw whole. One pass
// over graph.json keeps, for each hub, the few links that say the most
// (a call before a file that merely contains the symbol).
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MAX_LINKS = 8;
const MAX_AREAS = 12;
const MIN_WEIGHT = 8;
const MAP_VERSION = 3;
const RANK = { calls: 0, imports: 1, references: 2, extends: 3, implements: 3, defines: 5, contains: 9 };
const AREA_REL = new Set(["imports", "imports_from", "calls", "dynamic_import"]);

// Path prefixes a click can open: the folder, then what is inside it, then one level deeper.
function chainOf(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const d2 = parts[0] + "/" + parts[1];
  const d3 = parts.length >= 3 ? d2 + "/" + parts[2] : "";
  const d4 = parts.length >= 4 ? d3 + "/" + parts[3] : "";
  return { d2, d3, d4 };
}

function rank(relation) {
  return RANK[relation] ?? 4;
}

function offer(list, other, relation, maxLinks) {
  if (!other) return;
  const found = list.find((item) => item.id === other);
  if (found) {
    if (rank(relation) < rank(found.relation)) found.relation = relation;
    return;
  }
  if (list.length < maxLinks) {
    list.push({ id: other, relation });
    return;
  }
  let worst = 0;
  for (let i = 1; i < list.length; i++) {
    if (rank(list[i].relation) > rank(list[worst].relation)) worst = i;
  }
  if (rank(relation) < rank(list[worst].relation)) list[worst] = { id: other, relation };
}

// extractMap reads Graphify's graph.json without parsing it whole.
// The picture is the largest folders and the calls and imports between
// them. One symbol and its neighbours stay available for a closer look.
export function extractMap(file, hubs, { maxLinks = MAX_LINKS, maxAreas = MAX_AREAS, minWeight = MIN_WEIGHT } = {}) {
  const rows = (Array.isArray(hubs) ? hubs : []).slice(0, 12).map((hub) => ({
    id: String(hub?.id || ""),
    label: String(hub?.label || hub?.id || "").slice(0, 120),
    degree: Number(hub?.degree) || 0,
    links: [],
  })).filter((hub) => hub.label);
  const labels = new Map();
  const idChain = new Map();
  const prefixCount = new Map();
  const buckets = new Map(rows.map((hub) => [hub.label, []]));
  let nodeCount = 0;
  let edgeCount = 0;

  return new Promise((resolve, reject) => {
    const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
    let pending = "";
    let edges = false;
    let shown = new Set();
    const weights = new Map();
    const nodeRe = /\{"id":"([^"]*)","label":"([^"]*)"(?:,"file_type":"[^"]*")?(?:,"source_file":"([^"]*)")?/g;
    const edgeRe = /"source":"([^"]*)","target":"([^"]*)","relation":"([^"]*)"/g;
    const takeNodes = (text) => {
      for (const match of text.matchAll(nodeRe)) {
        nodeCount++;
        labels.set(match[1], match[2]);
        const chain = chainOf(match[3]);
        if (!chain) continue;
        idChain.set(match[1], chain);
        for (const key of [chain.d2, chain.d3, chain.d4]) {
          if (key) prefixCount.set(key, (prefixCount.get(key) || 0) + 1);
        }
      }
    };
    const ranked = (parent, parts) => [...prefixCount.entries()]
      .filter(([key]) => key.split("/").length === parts && (!parent || key.startsWith(parent + "/")))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, maxAreas);
    const freezeAreas = () => {
      shown = new Set(ranked("", 2).map(([id]) => id));
      for (const id of [...shown]) {
        for (const [child] of ranked(id, 3)) shown.add(child);
      }
      for (const id of [...shown].filter((key) => key.split("/").length === 3)) {
        for (const [child] of ranked(id, 4)) shown.add(child);
      }
    };
    const addWeight = (from, to, sourceId) => {
      if (!from || !to || from === to || !shown.has(from) || !shown.has(to)) return;
      if (from.split("/").length !== to.split("/").length) return;
      if (from.split("/").length > 2 && from.split("/").slice(0, -1).join("/") !== to.split("/").slice(0, -1).join("/")) return;
      const key = from + "\0" + to;
      let set = weights.get(key);
      if (!set) weights.set(key, set = new Set());
      set.add(sourceId);
    };
    const takeEdges = (text) => {
      for (const match of text.matchAll(edgeRe)) {
        edgeCount++;
        const source = labels.get(match[1]);
        const target = labels.get(match[2]);
        if (source && target && source !== target) {
          if (buckets.has(source)) offer(buckets.get(source), target, match[3], maxLinks);
          if (buckets.has(target)) offer(buckets.get(target), source, match[3], maxLinks);
        }
        if (!AREA_REL.has(match[3])) continue;
        const from = idChain.get(match[1]);
        const to = idChain.get(match[2]);
        if (from && to) {
          addWeight(from.d2, to.d2, match[1]);
          addWeight(from.d3, to.d3, match[1]);
          addWeight(from.d4, to.d4, match[1]);
        }
      }
    };
    stream.on("data", (buf) => {
      pending += buf.toString("utf8");
      if (!edges) {
        const cut = pending.indexOf('],"edges":');
        if (cut < 0) {
          const keep = Math.min(800, pending.length);
          takeNodes(pending.slice(0, pending.length - keep));
          pending = pending.slice(pending.length - keep);
          return;
        }
        takeNodes(pending.slice(0, cut));
        freezeAreas();
        pending = pending.slice(cut);
        edges = true;
      }
      const keep = Math.min(1200, pending.length);
      takeEdges(pending.slice(0, pending.length - keep));
      pending = pending.slice(pending.length - keep);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (!edges) {
        takeNodes(pending);
        freezeAreas();
      } else takeEdges(pending);
      // Hubs recorded by label still need the id Graphify uses.
      const idByLabel = new Map();
      for (const [id, label] of labels) if (!idByLabel.has(label)) idByLabel.set(label, id);
      for (const row of rows) {
        if (!row.id) row.id = idByLabel.get(row.label) || "";
        const links = buckets.get(row.label) || [];
        links.sort((a, b) => rank(a.relation) - rank(b.relation) || a.id.localeCompare(b.id));
        row.links = links.map((link) => ({
          id: idByLabel.get(link.id) || "",
          label: link.id,
          relation: link.relation,
        }));
      }
      const asArea = (id, symbols) => ({
        id,
        label: id.split("/").length > 2 ? id.split("/").pop() : id,
        symbols,
      });
      const areas = ranked("", 2).map(([id, symbols]) => asArea(id, symbols));
      const linkRows = [...weights.entries()]
        .map(([key, set]) => ({ from: key.split("\0")[0], to: key.split("\0")[1], weight: set.size }))
        .filter((link) => link.weight >= minWeight)
        .sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from));
      const linksFor = (parent) => {
        const parts = parent ? parent.split("/").length + 1 : 2;
        return linkRows.filter((link) => link.from.split("/").length === parts && (!parent || link.from.startsWith(parent + "/") && link.to.startsWith(parent + "/"))).slice(0, 24);
      };
      const inside = {};
      for (const area of areas) {
        const kids = ranked(area.id, 3).map(([id, symbols]) => asArea(id, symbols));
        if (kids.length) inside[area.id] = { areas: kids, links: linksFor(area.id) };
        for (const kid of kids) {
          const grand = ranked(kid.id, 4).map(([id, symbols]) => asArea(id, symbols));
          if (grand.length) inside[kid.id] = { areas: grand, links: linksFor(kid.id) };
        }
      }
      resolve({ version: MAP_VERSION, nodes: nodeCount, edges: edgeCount, areas, links: linksFor(""), inside, hubs: rows });
    });
  });
}

export function mapFile(dataDir, key) {
  return join(dataDir, "graphs", key, "map.json");
}

// loadMap returns the cached picture, or builds it once from graph.json.
export async function loadMap(dataDir, key, hubs) {
  const file = mapFile(dataDir, key);
  if (existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, "utf8"));
      if (cached?.version === MAP_VERSION) return cached;
    } catch { /* build again */ }
  }
  const graph = join(dataDir, "graphs", key, "graphify-out", "graph.json");
  if (!existsSync(graph)) return null;
  const map = await extractMap(graph, hubs || []);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".part";
  writeFileSync(tmp, JSON.stringify(map));
  renameSync(tmp, file);
  return map;
}
