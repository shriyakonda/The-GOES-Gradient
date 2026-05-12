// ─── Constants ────────────────────────────────────────────────────────────────
const MONTHS       = ["2020-06","2020-07","2020-08","2020-09","2020-10","2020-11"];
const MONTH_LABELS = ["June 2020","July 2020","August 2020",
                      "September 2020","October 2020","November 2020"];

const LAT_MIN = 10, LAT_MAX = 45, LON_MIN = -100, LON_MAX = -15;
const W = 1040, H = 480, M = 10;

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  monthIdx:    2,
  threshold:   26.5,
  showTracks:  true,
  hoveredStorm: null,   // storm id currently highlighted
  playing:     false,   // playback state
  playTimer:   null,
  sstByMonth:  {},
  tracks:      null,
  world:       null,
};

// ─── Scales ───────────────────────────────────────────────────────────────────
const sstColor = d3.scaleSequential()
  .domain([18, 31])
  .interpolator(d3.interpolateTurbo)
  .clamp(true);

const catColor = d3.scaleOrdinal()
  .domain([-1, 0, 1, 2, 3, 4, 5])
  .range(["#bdbdbd","#7fb3d5","#f4d35e","#ee964b","#f95738","#c1121f","#6a040f"]);

// ─── SVG setup ────────────────────────────────────────────────────────────────
const svg = d3.select("#map")
  .attr("viewBox", "0 0 " + W + " " + H)
  .attr("preserveAspectRatio", "xMidYMid meet");

const proj = d3.geoEquirectangular()
  .fitExtent(
    [[M, M], [W - M, H - M]],
    { type: "Polygon", coordinates: [[
      [LON_MIN, LAT_MIN], [LON_MAX, LAT_MIN],
      [LON_MAX, LAT_MAX], [LON_MIN, LAT_MAX],
      [LON_MIN, LAT_MIN],
    ]] }
  );
const pathGen = d3.geoPath(proj);

const gSst    = svg.append("g");
const gLand   = svg.append("g");
const gTracks = svg.append("g");
const tooltip = d3.select("#tooltip");

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadMonth(mk) {
  if (state.sstByMonth[mk]) return state.sstByMonth[mk];
  const d = await d3.json("data/sst_" + mk.replace("-", "_") + ".json");
  state.sstByMonth[mk] = d;
  return d;
}

async function loadAll() {
  state.world  = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json");
  state.tracks = await d3.json("data/tracks_2020.json");
  await loadMonth(MONTHS[state.monthIdx]);
}

// Preload remaining months in background after first render
function preloadRemaining() {
  MONTHS.forEach(mk => {
    if (!state.sstByMonth[mk]) loadMonth(mk).catch(() => {});
  });
}

// ─── Draw SST ─────────────────────────────────────────────────────────────────
function drawSst(data) {
  const lat0 = data.lat_min, lon0 = data.lon_min, r = data.res;
  const grid = data.sst;
  const nLat = grid.length, nLon = grid[0].length;

  const p0 = proj([lon0, lat0]);
  const p1 = proj([lon0 + r, lat0 + r]);
  const cw = Math.abs(p1[0] - p0[0]) + 0.5;
  const ch = Math.abs(p1[1] - p0[1]) + 0.5;

  const cells = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      const v = grid[i][j];
      if (v === null) continue;
      cells.push({ lat: lat0 + i * r, lon: lon0 + j * r, v, i, j });
    }
  }

  const sel = gSst.selectAll("rect").data(cells, d => d.lat + "," + d.lon);

  sel.exit().remove();

  sel.enter().append("rect")
    .attr("width", cw)
    .attr("height", ch)
    .attr("x", d => proj([d.lon, d.lat])[0])
    .attr("y", d => proj([d.lon, d.lat + r])[1])
    .attr("fill", d => sstColor(d.v))
    .attr("opacity", 0)
    // ── SST cell tooltip ──
    .on("mouseover", function(e, d) {
      const aboveThresh = d.v >= state.threshold;
      tooltip.style("opacity", 1).html(
        "<span style='color:#aaa;font-size:10px'>SEA SURFACE TEMP</span><br>" +
        "<b>" + d.v.toFixed(1) + "°C</b>" +
        (aboveThresh
          ? " <span style='color:#f4d35e'>▲ above threshold</span>"
          : " <span style='color:#7fb3d5'>▼ below threshold</span>")
      );
    })
    .on("mousemove", function(e) {
      const xy = d3.pointer(e, document.body);
      tooltip.style("left", (xy[0] + 14) + "px").style("top", (xy[1] - 10) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0))
    .merge(sel)
    .attr("fill", d => sstColor(d.v))
    // smooth threshold opacity transition
    .transition().duration(300)
    .attr("opacity", d => d.v >= state.threshold ? 1.0 : 0.38);
}

// ─── Draw Land ────────────────────────────────────────────────────────────────
function drawLand() {
  const land = topojson.feature(state.world, state.world.objects.land);
  gLand.selectAll("path").data([land]).join("path")
    .attr("class", "land").attr("d", pathGen);
}

// ─── Draw Tracks ──────────────────────────────────────────────────────────────
function drawTracks() {
  gTracks.selectAll("*").remove();
  if (!state.showTracks) return;

  const mk       = MONTHS[state.monthIdx];
  const inMonth  = state.tracks.filter(s => s.points.some(p => p.t.startsWith(mk)));
  const hovered  = state.hoveredStorm;

  const lineGen = d3.line()
    .x(d => proj([d.lon, d.lat])[0])
    .y(d => proj([d.lon, d.lat])[1])
    .curve(d3.curveCatmullRom);

  const g = gTracks.selectAll("g.storm").data(inMonth, d => d.id)
    .join("g").attr("class", "storm")
    // dim all others when one is hovered
    .attr("opacity", d => hovered && d.id !== hovered ? 0.18 : 1);

  // ── Track path ──
  g.append("path")
    .attr("class", "track")
    .attr("d", d => lineGen(d.points.filter(p => p.t.startsWith(mk))))
    .attr("stroke", d => catColor(d.category_max))
    .attr("stroke-width", d => hovered && d.id === hovered ? 2.2 : 1.2);

  // Wide invisible hit-target path for easier hover
  g.append("path")
    .attr("class", "track-hit")
    .attr("d", d => lineGen(d.points.filter(p => p.t.startsWith(mk))))
    .attr("stroke", "transparent")
    .attr("fill", "none")
    .attr("stroke-width", 12)
    .style("cursor", "pointer")
    .on("mouseover", function(e, d) {
      state.hoveredStorm = d.id;
      drawTracks();
      // show storm name label tooltip
      const xy = d3.pointer(e, document.body);
      tooltip.style("opacity", 1).style("left", (xy[0] + 14) + "px").style("top", (xy[1] - 10) + "px")
        .html(
          "<b style='font-size:13px'>" + d.name + "</b><br>" +
          "<span style='color:#aaa'>Peak: Cat " +
          (d.category_max < 0 ? "TD" : d.category_max) + "</span>"
        );
    })
    .on("mousemove", function(e) {
      const xy = d3.pointer(e, document.body);
      tooltip.style("left", (xy[0] + 14) + "px").style("top", (xy[1] - 10) + "px");
    })
    .on("mouseout", function() {
      state.hoveredStorm = null;
      drawTracks();
      tooltip.style("opacity", 0);
    });

  // ── Track points ──
  g.selectAll("circle")
    .data(d => d.points
      .filter(p => p.t.startsWith(mk))
      .map(p => Object.assign({}, p, { stormId: d.id, storm: d.name }))
    )
    .join("circle")
    .attr("class", "track-point")
    .attr("cx", p => proj([p.lon, p.lat])[0])
    .attr("cy", p => proj([p.lon, p.lat])[1])
    .attr("r",  p => p.cat < 0 ? 1.8 : 2.5 + p.cat * 0.6)
    .attr("fill", p => catColor(p.cat))
    .on("mouseover", function(e, p) {
      state.hoveredStorm = p.stormId;
      drawTracks();

      // look up SST at this point
      const d    = state.sstByMonth[MONTHS[state.monthIdx]];
      const i    = Math.round((p.lat - d.lat_min) / d.res);
      const j    = Math.round((p.lon - d.lon_min) / d.res);
      const sst  = (d.sst[i] && d.sst[i][j] != null)
                   ? d.sst[i][j].toFixed(1) + "°C"
                   : "n/a";
      const fuel = (d.sst[i] && d.sst[i][j] != null && d.sst[i][j] >= state.threshold)
                   ? " <span style='color:#f4d35e'>⚡ above fuel threshold</span>"
                   : "";

      tooltip.style("opacity", 1).html(
        "<b>" + p.storm + "</b>" +
        " &nbsp;<span style='color:" + catColor(p.cat) + ";font-weight:700'>" +
        (p.cat < 0 ? "TD" : "Cat " + p.cat) + "</span><br>" +
        "<span style='color:#aaa'>" + p.t + "</span><br>" +
        "Wind: <b>" + p.wind + " kt</b><br>" +
        "SST below: <b>" + sst + "</b>" + fuel
      );
    })
    .on("mousemove", function(e) {
      const xy = d3.pointer(e, document.body);
      tooltip.style("left", (xy[0] + 14) + "px").style("top", (xy[1] - 10) + "px");
    })
    .on("mouseout", function() {
      state.hoveredStorm = null;
      drawTracks();
      tooltip.style("opacity", 0);
    });
}

// ─── Draw Legend ──────────────────────────────────────────────────────────────
function drawLegend() {
  const container = d3.select("#legend").html("");

  // ── SST gradient bar ──
  const sstWrap = container.append("div").attr("class", "legend-section");
  sstWrap.append("div").attr("class", "legend-title").text("Sea Surface Temperature");

  const gw = 300, gh = 14;
  const sv = sstWrap.append("svg")
    .attr("width", gw + 50).attr("height", 38);
  const grad = sv.append("defs").append("linearGradient").attr("id", "sstgrad");
  for (let t = 0; t <= 1; t += 0.05) {
    grad.append("stop")
      .attr("offset", (t * 100) + "%")
      .attr("stop-color", sstColor(18 + t * (31 - 18)));
  }
  sv.append("rect").attr("x", 20).attr("y", 4)
    .attr("width", gw).attr("height", gh)
    .attr("fill", "url(#sstgrad)").attr("rx", 2);

  const s = d3.scaleLinear().domain([18, 31]).range([20, 20 + gw]);
  sv.append("g").attr("transform", "translate(0," + (gh + 4) + ")")
    .call(d3.axisBottom(s).ticks(6).tickFormat(d => d + "°").tickSize(3))
    .select(".domain").remove();

  // threshold tick on gradient
  const tx = s(state.threshold);
  sv.append("line")
    .attr("x1", tx).attr("x2", tx)
    .attr("y1", 2).attr("y2", gh + 6)
    .attr("stroke", "#fff").attr("stroke-width", 2.5);
  sv.append("line")
    .attr("x1", tx).attr("x2", tx)
    .attr("y1", 2).attr("y2", gh + 6)
    .attr("stroke", "#111").attr("stroke-width", 1.5);

  sstWrap.append("div").attr("class", "legend-note")
    .html("Cells below <b>" + state.threshold +
          "°C</b> are dimmed. 26.5°C is the widely cited hurricane intensification threshold.");

  // ── Category color swatches ──
  const catWrap = container.append("div").attr("class", "legend-section legend-cats");
  catWrap.append("div").attr("class", "legend-title").text("Storm Category (peak)");

  const cats = [
    { cat: -1, label: "TD / TS" },
    { cat: 1,  label: "Cat 1" },
    { cat: 2,  label: "Cat 2" },
    { cat: 3,  label: "Cat 3" },
    { cat: 4,  label: "Cat 4" },
    { cat: 5,  label: "Cat 5" },
  ];
  const swatches = catWrap.append("div").attr("class", "swatch-row");
  cats.forEach(c => {
    const item = swatches.append("div").attr("class", "swatch-item");
    item.append("span").attr("class", "swatch-dot")
      .style("background", catColor(c.cat));
    item.append("span").text(c.label);
  });
}

// ─── Play / Pause ─────────────────────────────────────────────────────────────
function startPlay() {
  if (state.playing) return;
  state.playing = true;
  document.getElementById("play-btn").textContent = "⏸ Pause";

  // If already at last month, restart
  if (state.monthIdx >= MONTHS.length - 1) {
    state.monthIdx = 0;
    document.getElementById("month-slider").value = 0;
    render();
  }

  state.playTimer = setInterval(async () => {
    state.monthIdx = (state.monthIdx + 1);
    document.getElementById("month-slider").value = state.monthIdx;
    await render();
    if (state.monthIdx >= MONTHS.length - 1) stopPlay();
  }, 1400);
}

function stopPlay() {
  state.playing = false;
  clearInterval(state.playTimer);
  state.playTimer = null;
  document.getElementById("play-btn").textContent = "▶ Play Season";
}

// ─── Render ───────────────────────────────────────────────────────────────────
async function render() {
  const data = await loadMonth(MONTHS[state.monthIdx]);
  drawSst(data);
  drawLand();
  drawTracks();
  drawLegend();
  document.getElementById("month-label").textContent     = MONTH_LABELS[state.monthIdx];
  document.getElementById("threshold-label").textContent = state.threshold + "°C";
}

// ─── Event listeners ──────────────────────────────────────────────────────────
window.vizState  = state;
window.vizRender = render;

document.getElementById("month-slider").addEventListener("input", function(e) {
  stopPlay();   // manual scrub cancels playback
  state.monthIdx = +e.target.value;
  render();
});

document.getElementById("threshold-slider").addEventListener("input", function(e) {
  state.threshold = +e.target.value;
  render();
});

document.getElementById("show-tracks").addEventListener("change", function(e) {
  state.showTracks = e.target.checked;
  render();
});

document.getElementById("play-btn").addEventListener("click", function() {
  state.playing ? stopPlay() : startPlay();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
loadAll()
  .then(() => {
    render();
    preloadRemaining();   // cache remaining months in background
  })
  .catch(err => {
    console.error(err);
    document.body.insertAdjacentHTML("beforeend",
      "<pre style='color:#c00;padding:16px'>Load error: " + err.message + "</pre>");
  });