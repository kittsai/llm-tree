const laneHeight = 100;
const sidebarWidth = 160;
const bottomBarHeight = 66;
const nodeRadius = 16;
const expandedRadius = 38;
const textPadding = 44;
const detailsWidth = 230;

// --- Org colour palette ---
const orgColors = {
  "Google":            "#4285F4",
  "OpenAI":            "#10a37f",
  "Meta":              "#0064e0",
  "DeepMind":          "#9c27b0",
  "Microsoft":         "#00a4ef",
  "Stanford":          "#e05c5c",
  "DeepSeek":          "#e84393",
  "Anthropic":         "#e8763a",
  "NVIDIA":            "#76b900",
  "Mistral":           "#ff8c42",
  "Alibaba":           "#ff6a00",
  "HuggingFace":       "#ffcc00",
  "BigScience":        "#78909c",
  "EleutherAI et al.": "#546e7a",
  "Ai2":               "#00bcd4",
  "xAI":               "#b0bec5",
};
const defaultOrgColor = "#90a4ae";

const orgAlias = {
  "CMU&Google":            "Google",
  "Google&Princeton":      "Google",
  "UW–Madison&Microsoft":  "Microsoft",
  "Microsoft&NVIDIA":      "Microsoft",
  "CMU et al.":            "Stanford",
  "CMU&Princeton":         "Stanford",
  "HuggingFace et al.":    "HuggingFace",
  "King Abdullah University": "Stanford",
  "Tsinghua":              "Stanford",
};

function canonicalOrg(raw) {
  if (orgAlias[raw]) return orgAlias[raw];
  for (const key of Object.keys(orgAlias)) {
    if (raw && raw.includes(key)) return orgAlias[key];
  }
  return raw;
}

function orgColor(org) {
  const canon = canonicalOrg(org);
  for (const key of Object.keys(orgColors)) {
    if (canon && canon.includes(key)) return orgColors[key];
  }
  return defaultOrgColor;
}

// --- Text wrap helper ---
function wrapText(textSelection, maxWidth, lineHeight = 1.2) {
  textSelection.each(function () {
    const text  = d3.select(this);
    const words = text.text().split(/\s+/).reverse();
    let word, line = [], lineNumber = 0;
    const x  = text.attr("x") || 0;
    const y  = text.attr("y") || 0;
    const dy = parseFloat(text.attr("dy")) || 0;
    text.text("");
    let tspan = text.append("tspan").attr("x", x).attr("y", y).attr("dy", dy + "em");
    while ((word = words.pop())) {
      line.push(word);
      tspan.text(line.join(" "));
      if (tspan.node().getComputedTextLength() > maxWidth) {
        line.pop();
        tspan.text(line.join(" "));
        line = [word];
        lineNumber++;
        tspan = text
          .append("tspan").attr("x", x).attr("y", y)
          .attr("dy", lineNumber * lineHeight + dy + "em")
          .text(word);
      }
    }
  });
}

// --- Load + render ---
fetch("/api/graph")
  .then(r => r.json())
  .then(data => renderGraph(data))
  .catch(err => console.error("Error loading graph data:", err));

function renderGraph(graph) {

  // ── 1. Preprocess nodes ──────────────────────────────────────────────────
  const tempSvg = d3.select("body").append("svg").style("visibility", "hidden");
  graph.nodes.forEach(d => {
    d.dateObj    = new Date(d.date);
    d.expanded   = false;
    d.canonicalOrg = canonicalOrg(d.properties.organization);
    const el = tempSvg.append("text").text(d.name).attr("font-size", "11px");
    d.textWidth = el.node().getBBox().width + textPadding;
    el.remove();
  });
  tempSvg.remove();

  // ── 2. Assign radius by degree + org color ─────────────────────────────────
  const outDegree = {};
  graph.nodes.forEach(d => { outDegree[d.id] = 0; });
  graph.links.forEach(l => {
    const srcId = l.source.id !== undefined ? l.source.id : l.source;
    outDegree[srcId] = (outDegree[srcId] || 0) + 1;
  });
  const maxDegree = Math.max(...Object.values(outDegree), 1);
  graph.nodes.forEach(d => {
    d.degree   = outDegree[d.id] || 0;
    // Scale radius: 11px (leaf) → 20px (most-referenced)
    d.baseRadius = 11 + (d.degree / maxDegree) * 9;
    d.orgColor   = orgColor(d.properties.organization);
  });

  // ── 3. Build org lanes ───────────────────────────────────────────────────
  const nodeMap = {};
  graph.nodes.forEach(d => { nodeMap[d.id] = d; });

  const orgGroups = {};
  graph.nodes.forEach(d => {
    const org = d.canonicalOrg;
    if (!orgGroups[org]) orgGroups[org] = [];
    orgGroups[org].push(d);
  });

  const orgList = Object.keys(orgGroups).sort((a, b) => {
    // Sort by latest model date descending (newest org on top)
    const aLatest = Math.max(...orgGroups[a].map(n => n.dateObj));
    const bLatest = Math.max(...orgGroups[b].map(n => n.dateObj));
    return bLatest - aLatest;
  });

  // ── 4. Compute canvas dimensions ─────────────────────────────────────────
  const totalLanes = orgList.length;
  const contentTop = 0;
  const canvasHeight = totalLanes * laneHeight + 40;
  const viewWidth = window.innerWidth - sidebarWidth;
  const canvasWidth = Math.max(viewWidth, viewWidth * 2.5);

  // ── 5. Time scale (horizontal) ───────────────────────────────────────────
  const dateExtent = d3.extent(graph.nodes, d => d.dateObj);
  dateExtent[0] = new Date(dateExtent[0].getFullYear(), 0, 1);
  dateExtent[1] = new Date(dateExtent[1].getFullYear() + 1, 0, 1);
  const xScale = d3.scaleTime().domain(dateExtent).range([40, canvasWidth - 60]);
  const yearTicks = d3.timeYears(dateExtent[0], dateExtent[1]);
  const monthTicks = d3.timeMonths(dateExtent[0], dateExtent[1]);

  // ── 6. Compute lane Y positions ──────────────────────────────────────────
  const orgLaneY = {};
  orgList.forEach((org, i) => {
    orgLaneY[org] = i * laneHeight + laneHeight / 2;
  });

  // ── 7. Position nodes within their lane ──────────────────────────────────
  // Nodes always on lane center line; only push x-right to avoid horizontal overlap
  orgList.forEach(org => {
    const nodes = orgGroups[org].sort((a, b) => a.dateObj - b.dateObj);
    const laneY = orgLaneY[org];
    const placed = []; // { x, radius }
    nodes.forEach(d => {
      let x = xScale(d.dateObj); // x starts at exact date position
      const r = d.baseRadius;
      const minGap = r * 2 + 6;

      // Only push right if overlapping horizontally (no vertical displacement)
      let attempts = 0;
      while (attempts < 30) {
        const overlaps = placed.some(p => Math.abs(p.x - x) < p.radius + r + minGap);
        if (!overlaps) break;
        x += r * 2 + 4; // nudge right by node diameter
        attempts++;
      }
      d.timelineX = x;
      d.timelineY = laneY; // always on lane center
      d.x = d.timelineX;
      d.y = d.timelineY;
      placed.push({ x, radius: r });
    });
  });

  // ── 8. Scrollbar sync (bidirectional, pixel-accurate) ─────────────────────
  const contentEl  = document.getElementById("content");
  const sidebarEl  = document.getElementById("sidebar");
  const timelineEl = document.getElementById("timeline");
  let isSyncing = false;

  function syncVertical(source) {
    if (isSyncing) return;
    isSyncing = true;
    const contentMax = contentEl.scrollHeight - contentEl.clientHeight;
    const sidebarMax = sidebarEl.scrollHeight - sidebarEl.clientHeight;
    if (contentMax > 0 && sidebarMax > 0) {
      if (source === contentEl) {
        sidebarEl.scrollTop = Math.min(contentEl.scrollTop, sidebarMax);
      } else {
        contentEl.scrollTop = Math.min(sidebarEl.scrollTop, contentMax);
      }
    }
    isSyncing = false;
  }

  // Override scrollTop setters to dispatch scroll event (for programmatic scrolls)
  function patchScrollEl(el) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'scrollTop') ||
                 Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    if (!desc || !desc.set) return;
    const origSet = desc.set;
    Object.defineProperty(el, 'scrollTop', {
      get: desc.get,
      set(v) { origSet.call(el, v); el.dispatchEvent(new Event('scroll')); },
      configurable: true
    });
  }
  patchScrollEl(contentEl);
  patchScrollEl(sidebarEl);

  contentEl.addEventListener("scroll",  () => {
    syncVertical(contentEl);
    timelineEl.scrollLeft = contentEl.scrollLeft;
  });

  sidebarEl.addEventListener("scroll",  () => syncVertical(sidebarEl));

  timelineEl.addEventListener("scroll", () => {
    if (isSyncing) return;
    isSyncing = true;
    contentEl.scrollLeft = timelineEl.scrollLeft;
    isSyncing = false;
  });

  // ── 9. Draw sidebar org labels ───────────────────────────────────────────
  // Map org names to their icon files
  const orgIconMap = {
    "Google": "google.png", "OpenAI": "openai.jpg", "Meta": "meta.png",
    "DeepMind": "deepmind.webp", "Microsoft": "microsoft.png",
    "Stanford": "stanford.png", "DeepSeek": "deepseek.webp",
    "Anthropic": "anthropic.webp", "NVIDIA": "nvidia.png",
    "Mistral": "mistral.png", "Alibaba": "alibaba.webp",
    "HuggingFace": "huggingface.svg", "BigScience": "bigscience.png",
    "EleutherAI et al.": "eleutherai.webp", "Ai2": "ai2.jpg",
    "xAI": "xai.png",
  };

  const sidebarSvg = d3.select("#sidebar").append("svg")
    .attr("width", sidebarWidth).attr("height", canvasHeight);

  // Right-aligned layout: [name] [icon] at right edge
  const iconCx = sidebarWidth - 26; // icon center x (rightmost)
  const iconX = sidebarWidth - 40;  // icon image x
  const nameX = sidebarWidth - 48;  // name text x (left of icon, text-anchor=end)

  // Clip path for sidebar icons
  const sidebarDefs = sidebarSvg.append("defs");
  sidebarDefs.append("clipPath").attr("id", "sidebar-icon-clip")
    .append("circle").attr("cx", iconCx).attr("cy", 0).attr("r", 13);

  const orgRows = sidebarSvg.selectAll("g.org-row").data(orgList).enter()
    .append("g").attr("class", "org-row")
    .attr("transform", d => `translate(0, ${orgLaneY[d]})`);

  // Company icon background circle
  orgRows.append("circle")
    .attr("cx", iconCx).attr("cy", 0)
    .attr("r", 14)
    .attr("fill", d => orgColor(d))
    .attr("opacity", 0.25);

  // Company icon (clipped to circle)
  orgRows.append("image")
    .attr("xlink:href", d => "icons/" + (orgIconMap[d] || "google.png"))
    .attr("x", sidebarWidth - 40).attr("y", -14)
    .attr("width", 28).attr("height", 28)
    .attr("clip-path", "url(#sidebar-icon-clip)");

  // Org name (right-aligned, left of icon)
  orgRows.append("text")
    .attr("class", "org-label")
    .attr("x", nameX)
    .attr("y", 0)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .attr("font-size", "11px")
    .attr("font-family", "'Inter', sans-serif")
    .attr("font-weight", "500")
    .attr("fill", d => orgColor(d))
    .attr("opacity", 0.9)
    .text(d => d);

  // Subtle horizontal divider per lane
  sidebarSvg.selectAll("line.lane-sep").data(orgList).enter()
    .append("line")
    .attr("x1", 16).attr("x2", sidebarWidth - 16)
    .attr("y1", d => orgLaneY[d] + laneHeight / 2)
    .attr("y2", d => orgLaneY[d] + laneHeight / 2)
    .attr("stroke", "rgba(0,0,0,0.04)")
    .attr("stroke-width", 1);

  // ── 10. Draw bottom timeline ─────────────────────────────────────────────
  const timelineSvg = d3.select("#timeline").append("svg")
    .attr("width", canvasWidth).attr("height", bottomBarHeight);

  // Year interval color bands (subtle warm tints for light theme)
  const yearBandColors = [
    "rgba(0,0,0,0.02)",   // dark tint 1
    "rgba(0,0,0,0.01)",   // dark tint 2
    "rgba(0,0,0,0.02)",   // dark tint 3
    "rgba(0,0,0,0.01)",   // dark tint 4
    "rgba(0,0,0,0.02)",   // dark tint 5
    "rgba(0,0,0,0.01)",   // dark tint 6
    "rgba(0,0,0,0.02)",   // dark tint 7
    "rgba(0,0,0,0.01)",   // dark tint 8
    "rgba(0,0,0,0.02)",   // dark tint 9
    "rgba(0,0,0,0.01)",   // dark tint 10
  ];
  yearTicks.forEach((year, i) => {
    const x1 = xScale(year);
    const x2 = i < yearTicks.length - 1 ? xScale(yearTicks[i + 1]) : canvasWidth;
    timelineSvg.append("rect")
      .attr("x", x1).attr("y", 0)
      .attr("width", x2 - x1).attr("height", bottomBarHeight)
      .attr("fill", yearBandColors[i % yearBandColors.length]);
  });

  timelineSvg.selectAll("line.tl-line").data(yearTicks).enter()
    .append("line")
    .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
    .attr("y1", 0).attr("y2", bottomBarHeight)
    .attr("stroke", "rgba(120,150,200,0.15)")
    .attr("stroke-width", 1);

  timelineSvg.selectAll("text.tl-label").data(yearTicks).enter()
    .append("text")
    .attr("x", d => xScale(d))
    .attr("y", 18)
    .attr("dy", "0.35em")
    .attr("text-anchor", "middle")
    .attr("font-size", "12px")
    .attr("font-family", "'Inter', sans-serif")
    .attr("font-weight", "600")
    .attr("fill", "rgba(0,0,0,0.6)")
    .text(d => d.getFullYear());

  // Month labels (abbreviated, smaller)
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  timelineSvg.selectAll("text.tl-month").data(monthTicks).enter()
    .append("text")
    .attr("class", "tl-month")
    .attr("x", d => xScale(d))
    .attr("y", 42)
    .attr("dy", "0.35em")
    .attr("text-anchor", "middle")
    .attr("font-size", "9px")
    .attr("font-family", "'Inter', sans-serif")
    .attr("font-weight", "400")
    .attr("fill", "rgba(0,0,0,0.3)")
    .text(d => monthNames[d.getMonth()]);

  // Month tick marks (short lines)
  timelineSvg.selectAll("line.tl-month-tick").data(monthTicks).enter()
    .append("line")
    .attr("class", "tl-month-tick")
    .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
    .attr("y1", 30).attr("y2", 36)
    .attr("stroke", "rgba(0,0,0,0.1)")
    .attr("stroke-width", 1);

  // Year boundary separator lines in timeline
  timelineSvg.selectAll("line.tl-boundary").data(yearTicks).enter()
    .append("line")
    .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
    .attr("y1", 0).attr("y2", bottomBarHeight)
    .attr("stroke", "rgba(0,0,0,0.08)")
    .attr("stroke-width", 1);

  // ── 11. Draw main SVG content ────────────────────────────────────────────
  const svg = d3.select("#content").append("svg")
    .attr("width", canvasWidth).attr("height", canvasHeight);

  // Starfield (subtle dots for light theme)
  const starGroup = svg.append("g").attr("class", "stars");
  for (let i = 0; i < 80; i++) {
    starGroup.append("circle")
      .attr("cx", Math.random() * canvasWidth)
      .attr("cy", Math.random() * canvasHeight)
      .attr("r", Math.random() * 0.8 + 0.2)
      .attr("fill", "#000000")
      .attr("opacity", Math.random() * 0.04 + 0.01);
  }

  // Lane backgrounds with subtle dividers
  const laneGroup = svg.append("g").attr("class", "lanes");
  orgList.forEach((org, i) => {
    const laneY = orgLaneY[org];
    const opacity = i % 2 === 0 ? 0.018 : 0.032;
    laneGroup.append("rect")
      .attr("x", 0).attr("y", laneY - laneHeight / 2)
      .attr("width", canvasWidth).attr("height", laneHeight)
      .attr("fill", "#000000").attr("opacity", opacity);
    // Horizontal divider at lane bottom
    if (i < orgList.length - 1) {
      laneGroup.append("line")
        .attr("x1", 40).attr("x2", canvasWidth - 60)
        .attr("y1", laneY + laneHeight / 2).attr("y2", laneY + laneHeight / 2)
        .attr("stroke", "rgba(0,0,0,0.06)")
        .attr("stroke-width", 0.5);
    }
  });

  // Year grid lines (in content, synced with bottom bar)
  const gridGroup = svg.append("g").attr("class", "grid");

  // Year interval color bands (matching timeline)
  yearTicks.forEach((year, i) => {
    const x1 = xScale(year);
    const x2 = i < yearTicks.length - 1 ? xScale(yearTicks[i + 1]) : canvasWidth;
    gridGroup.append("rect")
      .attr("x", x1).attr("y", 0)
      .attr("width", x2 - x1).attr("height", canvasHeight)
      .attr("fill", yearBandColors[i % yearBandColors.length]);
  });

  // Year boundary vertical lines (visible separators)
  gridGroup.selectAll("line.year-boundary").data(yearTicks).enter()
    .append("line").attr("class", "year-boundary")
    .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
    .attr("y1", 0).attr("y2", canvasHeight)
    .attr("stroke", "rgba(0,0,0,0.06)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,4");

  // Month grid lines (very subtle, dotted)
  gridGroup.selectAll("line.month-line").data(monthTicks).enter()
    .append("line").attr("class", "month-line")
    .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
    .attr("y1", 0).attr("y2", canvasHeight)
    .attr("stroke", "rgba(0,0,0,0.025)")
    .attr("stroke-width", 0.5)
    .attr("stroke-dasharray", "2,4");

  gridGroup.selectAll("line.year-line").data(yearTicks).enter()
    .append("line").attr("class", "year-line")
    .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
    .attr("y1", 0).attr("y2", canvasHeight);

  // SVG defs
  const svgDefs = svg.append("defs");
  svgDefs.append("filter").attr("id", "dropShadow").html(`
    <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
    <feOffset dx="0" dy="4" result="offsetblur"/>
    <feFlood flood-color="#00000033"/>
    <feComposite in2="offsetblur" operator="in"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  `);

  // Per-node clip paths for icons (dynamic radius on expand)

  // Per-link gradient
  graph.links.forEach((l, i) => {
    const srcId   = l.source.id !== undefined ? l.source.id : l.source;
    const tgtId   = l.target.id !== undefined ? l.target.id : l.target;
    const srcNode = nodeMap[srcId];
    const tgtNode = nodeMap[tgtId];
    const gradId  = `link-grad-${i}`;
    l._gradId = gradId;

    const deg      = srcNode ? srcNode.degree : 0;
    l._strokeWidth = 0.6 + Math.sqrt(deg) * 0.3;
    l._opacity     = 0.2 + Math.min(deg / maxDegree, 1) * 0.4;

    const grad = svgDefs.append("linearGradient")
      .attr("id", gradId)
      .attr("gradientUnits", "userSpaceOnUse")
      .attr("x1", srcNode ? srcNode.timelineX || 0 : 0)
      .attr("y1", srcNode ? srcNode.timelineY || 0 : 0)
      .attr("x2", tgtNode ? tgtNode.timelineX || 0 : 0)
      .attr("y2", tgtNode ? tgtNode.timelineY || 0 : 0);
    grad.append("stop").attr("offset", "0%")
      .attr("stop-color", srcNode ? srcNode.orgColor : defaultOrgColor)
      .attr("stop-opacity", l._opacity);
    grad.append("stop").attr("offset", "100%")
      .attr("stop-color", tgtNode ? tgtNode.orgColor : defaultOrgColor)
      .attr("stop-opacity", l._opacity * 0.5);
  });

  // Draw links
  const linkGroup    = svg.append("g").attr("class", "links");
  const linkElements = linkGroup.selectAll("path").data(graph.links).enter()
    .append("path")
    .attr("class", "link")
    .attr("stroke", d => `url(#${d._gradId})`)
    .attr("stroke-width", d => d._strokeWidth)
    .attr("d", d => {
      const srcNode = nodeMap[d.source.id || d.source];
      const tgtNode = nodeMap[d.target.id || d.target];
      if (!srcNode || !tgtNode) return "";
      return `M${srcNode.timelineX},${srcNode.timelineY} L${tgtNode.timelineX},${tgtNode.timelineY}`;
    });

  // Draw nodes
  const nodeGroup    = svg.append("g").attr("class", "nodes");
  const nodeElements = nodeGroup.selectAll("g.node").data(graph.nodes).enter()
    .append("g").attr("class", "node")
    .attr("transform", d => `translate(${d.timelineX}, ${d.timelineY})`)
    .style("filter", () => `drop-shadow(0 1px 3px rgba(0,0,0,0.12))`)
    .on("click", function (event, d) {
      event.stopPropagation();
      d.expanded = !d.expanded;
      d3.select(this).raise();
      updateNodeDetails(d3.select(this), d, d.expanded);
    });

  // Per-node clipPath
  nodeElements.each(function (d) {
    svgDefs.append("clipPath").attr("id", `clip-${d.id}`)
      .append("circle").attr("r", d.baseRadius - 2);
  });

  // Background circle (white for light theme icon contrast)
  nodeElements.append("circle")
    .attr("r", d => d.baseRadius)
    .attr("fill", "#ffffff")
    .attr("stroke", d => d.orgColor)
    .attr("stroke-width", d => 1.5 + (d.degree / maxDegree) * 1.5)
    .attr("stroke-opacity", 0.7);

  // Model icon (clipped to circle)
  nodeElements.append("image")
    .attr("class", "node-icon")
    .attr("xlink:href", d => "icons/" + d.image)
    .attr("x", d => -(d.baseRadius - 2))
    .attr("y", d => -(d.baseRadius - 2))
    .attr("width", d => (d.baseRadius - 2) * 2)
    .attr("height", d => (d.baseRadius - 2) * 2)
    .attr("clip-path", d => `url(#clip-${d.id})`);

  // Label
  nodeElements.append("text")
    .attr("class", "node-label")
    .attr("dy", d => d.baseRadius + 13)
    .attr("text-anchor", "middle")
    .attr("font-size", "10px")
    .attr("font-family", "'Inter', sans-serif")
    .attr("font-weight", "500")
    .attr("fill", "rgba(0,0,0,0.7)")
    .style("text-shadow", "0 1px 2px rgba(255,255,255,0.8)")
    .text(d => d.name);

  // ── 12. Expanded-node detail popup ────────────────────────────────────────
  function updateNodeDetails(nodeSelection, d, showDetails) {
    nodeSelection.selectAll(".details").remove();
    const r = showDetails ? expandedRadius : d.baseRadius;
    const imgR = r - 3;

    nodeSelection.select("circle")
      .attr("r", r).attr("stroke-width", showDetails ? 2.5 : 1.5 + (d.degree / maxDegree) * 1.5);
    nodeSelection.select("text.node-label")
      .attr("dy", showDetails ? expandedRadius + 16 : d.baseRadius + 13);
    nodeSelection.select("image.node-icon")
      .attr("x", -imgR).attr("y", -imgR)
      .attr("width", imgR * 2).attr("height", imgR * 2);
    // Update the per-node clip-path circle
    svgDefs.select(`#clip-${d.id} circle`).attr("r", imgR);

    if (!showDetails) return;

    const details = nodeSelection.append("g")
      .attr("class", "details")
      .attr("transform", `translate(0, ${expandedRadius + 34})`);
    details.raise();

    const detailsRect = details.append("rect")
      .attr("x", -detailsWidth / 2).attr("y", 0)
      .attr("width", detailsWidth).attr("height", 140)
      .attr("fill", "rgba(255, 255, 255, 0.98)")
      .attr("stroke", d.orgColor).attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1.5).attr("rx", 10).attr("ry", 10)
      .attr("filter", "url(#dropShadow)");

    const content = details.append("g").attr("transform", "translate(0, 12)");
    const addText = (txt, y, opts = {}) =>
      content.append("text")
        .attr("x", 0).attr("y", y).attr("text-anchor", "middle")
        .attr("font-size", opts.size || "12px")
        .attr("font-family", "'Inter', sans-serif")
        .attr("fill", opts.color || "rgba(0,0,0,0.6)")
        .attr("font-weight", opts.weight || "normal")
        .text(txt);

    addText(d.name, 20,  { color: "rgba(0,0,0,0.85)", weight: "600", size: "13px" });
    addText(d.date, 38,  { color: "rgba(0,0,0,0.45)", size: "11px" });
    addText(d.properties.organization, 54, { color: d.orgColor, size: "11px" });

    const desc = content.append("text")
      .attr("x", 0).attr("y", 70).attr("dy", "0em")
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-family", "'Inter', sans-serif")
      .attr("fill", "rgba(0,0,0,0.55)")
      .text(d.properties.description);
    wrapText(desc, detailsWidth - 24);

    const descBBox  = desc.node().getBBox();
    const newHeight = descBBox.y + descBBox.height + 60;
    detailsRect.attr("height", newHeight);

    const linkG = content.append("g")
      .style("cursor", "pointer")
      .on("click", (e) => { e.stopPropagation(); window.open(d.link, "_blank"); });
    linkG.append("text")
      .attr("x", 0).attr("y", newHeight - 30)
      .attr("text-anchor", "middle").attr("font-size", "11px")
      .attr("fill", d.orgColor).attr("font-family", "'Inter', sans-serif")
      .style("text-decoration", "underline")
      .text("View Paper / Announcement");
  }

  svg.on("click", () => {
    nodeElements.each(function (d) {
      if (d.expanded) {
        d.expanded = false;
        updateNodeDetails(d3.select(this), d, false);
      }
    });
  });

  // ── 13. Hover highlight ──────────────────────────────────────────────────
  const connectedTo = {};
  graph.nodes.forEach(d => { connectedTo[d.id] = new Set(); });
  graph.links.forEach(l => {
    const srcId = l.source.id || l.source;
    const tgtId = l.target.id || l.target;
    connectedTo[srcId].add(tgtId);
    connectedTo[tgtId].add(srcId);
  });

  nodeElements
    .on("mouseenter", function (event, d) {
      const connected = connectedTo[d.id] || new Set();
      connected.add(d.id);

      nodeElements
        .style("opacity", n => connected.has(n.id) ? 1 : 0.15)
        .style("filter", n => {
          if (!connected.has(n.id)) return "none";
          return `drop-shadow(0 0 4px ${n.orgColor}40) drop-shadow(0 0 8px ${n.orgColor}25)`;
        });

      linkElements
        .style("opacity", l => {
          const srcId = l.source.id || l.source;
          const tgtId = l.target.id || l.target;
          return (srcId === d.id || tgtId === d.id) ? 0.6 : 0.03;
        })
        .attr("stroke-width", l => {
          const srcId = l.source.id || l.source;
          const tgtId = l.target.id || l.target;
          return (srcId === d.id || tgtId === d.id) ? l._strokeWidth * 2 : l._strokeWidth;
        });
    })
    .on("mouseleave", function () {
      nodeElements
        .style("opacity", 1)
        .style("filter", () => `drop-shadow(0 1px 3px rgba(0,0,0,0.12))`);
      linkElements
        .style("opacity", 1)
        .attr("stroke-width", l => l._strokeWidth);
    });

  // ── 14. Organization filter ──────────────────────────────────────────────
  const activeOrgs = new Set(Object.keys(orgColors));

  function applyOrgFilter() {
    nodeElements.style("display", d => {
      const match = [...activeOrgs].some(k => d.canonicalOrg && d.canonicalOrg.includes(k));
      return match ? null : "none";
    });
    linkElements.style("display", l => {
      const srcNode = nodeMap[l.source.id || l.source];
      const tgtNode = nodeMap[l.target.id || l.target];
      if (!srcNode || !tgtNode) return "none";
      const srcMatch = [...activeOrgs].some(k => srcNode.canonicalOrg && srcNode.canonicalOrg.includes(k));
      const tgtMatch = [...activeOrgs].some(k => tgtNode.canonicalOrg && tgtNode.canonicalOrg.includes(k));
      return (srcMatch && tgtMatch) ? null : "none";
    });
  }

  window._orgFilter = { activeOrgs, orgColors, applyOrgFilter };
}
