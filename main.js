"use strict";

// ===== 調整しやすいプロトタイプ定数 =====
const GRID_SIZE = 0.001; // 約100m前後。値を大きくすると1マスが広くなります。
const VISIT_COOLDOWN_MS = 30000; // GPS更新による同一マスの加算は30秒に1回まで。
const MAP_RADIUS = 5; // 5なら現在地中心の11x11マップ。
const STORAGE_KEY = "lifeRpgMap.visitedTiles.v2";
const LEGACY_STORAGE_KEY = "lifeRpgMap.visitedTiles.v1";
const OSM_CACHE_STORAGE_KEY = "lifeRpgMap.osmCache.v1";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const OSM_SEARCH_RADIUS_M = 300;
const OSM_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7日
const DEBUG_START_GRID = { x: 135123, y: 35123 };

// 訪問回数に応じたマスの成長段階。ここを変えるとゲームバランスを調整できます。
const TILE_LEVELS = [
  { min: 0, name: "未踏", symbol: "???", className: "unknown" },
  { min: 1, name: "草原", symbol: "草", className: "grass" },
  { min: 3, name: "けもの道", symbol: "道", className: "trail" },
  { min: 10, name: "街道", symbol: "道", className: "road" },
  { min: 25, name: "村", symbol: "村", className: "village" },
  { min: 50, name: "街", symbol: "街", className: "town" },
  { min: 100, name: "王都", symbol: "王", className: "capital" }
];

// 地名生成用の語彙。座標から決定的に選ぶので、同じマスは同じ名前になります。
const PLACE_PREFIXES = [
  "風鳴りの", "灰色", "忘れられた", "静寂の", "夜明けの", "星拾いの",
  "雨待ちの", "古灯りの", "遠雷の", "白露の", "旅人の", "薄明の"
];
const PLACE_ROOTS = ["草原", "森", "丘", "街道", "谷", "野", "村", "町", "王都", "沼", "高原", "辻"];

const OSM_EMPTY_SUMMARY = {
  park: 0,
  station: 0,
  worship: 0,
  water: 0,
  commercial: 0
};

const OSM_CATEGORY_LABELS = {
  park: "公園",
  station: "駅",
  worship: "神社・寺",
  water: "川・水辺",
  commercial: "店・飲食店",
  none: "なし"
};

const OSM_RPG_NAMES = {
  park: "妖精の森",
  station: "宿場町",
  worship: "祠",
  water: "精霊の川",
  commercial: "交易所",
  none: "草原"
};

const OSM_SYMBOLS = {
  park: "森",
  station: "宿",
  worship: "祠",
  water: "水",
  commercial: "市"
};

// ===== DOM参照 =====
const elements = {
  debugModeToggle: document.querySelector("#debugModeToggle"),
  statusText: document.querySelector("#statusText"),
  sourceText: document.querySelector("#sourceText"),
  gridText: document.querySelector("#gridText"),
  latText: document.querySelector("#latText"),
  lngText: document.querySelector("#lngText"),
  accuracyText: document.querySelector("#accuracyText"),
  updatedText: document.querySelector("#updatedText"),
  exploredCountText: document.querySelector("#exploredCountText"),
  totalVisitsText: document.querySelector("#totalVisitsText"),
  bestTownText: document.querySelector("#bestTownText"),
  currentPlaceText: document.querySelector("#currentPlaceText"),
  osmStatusText: document.querySelector("#osmStatusText"),
  osmFeatureText: document.querySelector("#osmFeatureText"),
  osmParkText: document.querySelector("#osmParkText"),
  osmStationText: document.querySelector("#osmStationText"),
  osmWorshipText: document.querySelector("#osmWorshipText"),
  osmWaterText: document.querySelector("#osmWaterText"),
  osmCommercialText: document.querySelector("#osmCommercialText"),
  osmFeatureList: document.querySelector("#osmFeatureList"),
  gridMap: document.querySelector("#gridMap"),
  selectedTileText: document.querySelector("#selectedTileText"),
  recordButton: document.querySelector("#recordButton"),
  boostButton: document.querySelector("#boostButton"),
  resetButton: document.querySelector("#resetButton"),
  moveUpButton: document.querySelector("#moveUpButton"),
  moveLeftButton: document.querySelector("#moveLeftButton"),
  moveDownButton: document.querySelector("#moveDownButton"),
  moveRightButton: document.querySelector("#moveRightButton")
};

// ===== アプリ状態 =====
let visitedTiles = loadVisitedTiles();
let osmCache = loadOsmCache();
let watchId = null;
let gpsPosition = null;
let debugMode = false;
let debugGrid = { ...DEBUG_START_GRID };
let selectedGridId = null;
let lastRecordedGridId = null;
let lastRecordedAt = 0;
let currentOsmGridId = null;
let currentOsmResult = null;
let currentOsmStatus = "未取得";
let osmRequestSerial = 0;

// ===== localStorage =====
function loadVisitedTiles() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    return normalizeVisitedTiles(parsed);
  } catch (error) {
    console.warn("訪問データの読み込みに失敗しました。新規データで開始します。", error);
    return {};
  }
}

function normalizeVisitedTiles(data) {
  const normalized = {};
  for (const [gridId, tile] of Object.entries(data || {})) {
    normalized[gridId] = {
      visitCount: Number(tile.visitCount) || 0,
      firstVisitedAt: Number(tile.firstVisitedAt) || Date.now(),
      lastVisitedAt: Number(tile.lastVisitedAt) || Date.now(),
      placeName: tile.placeName || generatePlaceName(gridId)
    };
  }
  return normalized;
}

function saveVisitedTiles() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(visitedTiles));
}

function loadOsmCache() {
  try {
    return JSON.parse(localStorage.getItem(OSM_CACHE_STORAGE_KEY)) || {};
  } catch (error) {
    console.warn("OSMキャッシュの読み込みに失敗しました。", error);
    return {};
  }
}

function saveOsmCache() {
  localStorage.setItem(OSM_CACHE_STORAGE_KEY, JSON.stringify(osmCache));
}

// ===== GPSとグリッド変換 =====
function gpsToGrid(latitude, longitude) {
  const x = Math.floor(longitude / GRID_SIZE);
  const y = Math.floor(latitude / GRID_SIZE);
  return { x, y, id: createGridId(x, y) };
}

function createGridId(x, y) {
  return `${x}_${y}`;
}

function parseGridId(gridId) {
  const [x, y] = gridId.split("_").map(Number);
  return { x, y };
}

function getCurrentGrid() {
  // デバッグON、またはGPSがまだ成功していない場合は疑似座標を使います。
  if (debugMode || !gpsPosition) {
    return { x: debugGrid.x, y: debugGrid.y, id: createGridId(debugGrid.x, debugGrid.y), source: "debug" };
  }

  const grid = gpsToGrid(gpsPosition.latitude, gpsPosition.longitude);
  return { ...grid, source: "gps" };
}

function getCurrentDebugReadout() {
  if (!debugMode && gpsPosition) {
    return {
      latitude: gpsPosition.latitude.toFixed(6),
      longitude: gpsPosition.longitude.toFixed(6),
      accuracy: `${Math.round(gpsPosition.accuracy)}m`,
      updatedAt: new Date(gpsPosition.updatedAt).toLocaleTimeString()
    };
  }

  // 疑似座標でも緯度経度に相当する値を出し、保存形式と同じ体験を確認できます。
  return {
    latitude: (debugGrid.y * GRID_SIZE).toFixed(6),
    longitude: (debugGrid.x * GRID_SIZE).toFixed(6),
    accuracy: "debug",
    updatedAt: new Date().toLocaleTimeString()
  };
}

function getLatLonForGrid(grid) {
  if (grid.source === "gps" && gpsPosition) {
    return {
      latitude: gpsPosition.latitude,
      longitude: gpsPosition.longitude
    };
  }

  return {
    latitude: grid.y * GRID_SIZE,
    longitude: grid.x * GRID_SIZE
  };
}

function startWatchingPosition() {
  if (!("geolocation" in navigator)) {
    setStatus("GPSが使えないため、疑似座標で探索します");
    debugMode = true;
    elements.debugModeToggle.checked = true;
    render();
    return;
  }

  stopWatchingPosition();
  setStatus("GPSと自動同期しています...");

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      gpsPosition = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        updatedAt: position.timestamp
      };
      setStatus("足跡が世界に刻まれました");
      recordCurrentTile({ force: false });
      render();
    },
    (error) => {
      gpsPosition = null;
      debugMode = true;
      elements.debugModeToggle.checked = true;
      setStatus(`GPSエラー: ${error.message}`);
      render();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000
    }
  );
}

function stopWatchingPosition() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    setStatus("GPS探索を停止しました");
  }
}

// ===== OSM / Overpass API =====
async function ensureOsmForGrid(grid) {
  if (currentOsmGridId === grid.id && currentOsmStatus !== "未取得") {
    return;
  }

  const now = Date.now();
  const cached = osmCache[grid.id];
  currentOsmGridId = grid.id;

  if (cached && cached.radius === OSM_SEARCH_RADIUS_M && now - cached.fetchedAt < OSM_CACHE_TTL_MS) {
    currentOsmResult = cached;
    currentOsmStatus = "キャッシュ使用";
    applyOsmToVisitedTile(grid.id, cached);
    render();
    return;
  }

  if (typeof fetch !== "function") {
    currentOsmResult = null;
    currentOsmStatus = "取得失敗";
    render();
    return;
  }

  const requestId = ++osmRequestSerial;
  const point = getLatLonForGrid(grid);
  currentOsmResult = null;
  currentOsmStatus = "取得中";
  render();

  try {
    const result = await fetchOsmAroundGrid(grid.id, point.latitude, point.longitude);
    if (requestId !== osmRequestSerial) return;

    osmCache[grid.id] = result;
    saveOsmCache();
    currentOsmResult = result;
    currentOsmStatus = "取得成功";
    applyOsmToVisitedTile(grid.id, result);
    render();
  } catch (error) {
    if (requestId !== osmRequestSerial) return;
    console.warn("OSM取得に失敗しました。通常地形で続行します。", error);
    currentOsmResult = null;
    currentOsmStatus = "取得失敗";
    render();
  }
}

async function fetchOsmAroundGrid(gridId, latitude, longitude) {
  const query = buildOverpassQuery(latitude, longitude);
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: `data=${encodeURIComponent(query)}`
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data = await response.json();
  const features = (data.elements || []).map(normalizeOsmElement).filter(Boolean);

  return {
    gridId,
    fetchedAt: Date.now(),
    radius: OSM_SEARCH_RADIUS_M,
    summary: summarizeOsmFeatures(features),
    features
  };
}

function buildOverpassQuery(latitude, longitude) {
  const around = `(around:${OSM_SEARCH_RADIUS_M},${latitude.toFixed(6)},${longitude.toFixed(6)})`;
  return `[out:json][timeout:25];
(
  node["leisure"="park"]${around};
  way["leisure"="park"]${around};
  relation["leisure"="park"]${around};

  node["railway"="station"]${around};
  way["railway"="station"]${around};
  relation["railway"="station"]${around};

  node["amenity"="place_of_worship"]${around};
  way["amenity"="place_of_worship"]${around};
  relation["amenity"="place_of_worship"]${around};

  node["waterway"="river"]${around};
  way["waterway"="river"]${around};
  relation["waterway"="river"]${around};

  node["natural"="water"]${around};
  way["natural"="water"]${around};
  relation["natural"="water"]${around};

  node["water"="river"]${around};
  way["water"="river"]${around};
  relation["water"="river"]${around};

  node["shop"]${around};
  way["shop"]${around};
  relation["shop"]${around};
  node["amenity"="restaurant"]${around};
  way["amenity"="restaurant"]${around};
  relation["amenity"="restaurant"]${around};
  node["amenity"="cafe"]${around};
  way["amenity"="cafe"]${around};
  relation["amenity"="cafe"]${around};
  node["amenity"="fast_food"]${around};
  way["amenity"="fast_food"]${around};
  relation["amenity"="fast_food"]${around};
);
out center tags;`;
}

function normalizeOsmElement(element) {
  const tags = element.tags || {};
  const category = getOsmCategory(tags);
  if (!category) return null;

  const center = element.center || null;
  return {
    id: element.id,
    type: element.type,
    name: tags.name || tags["name:ja"] || "名前なし",
    category,
    categoryLabel: OSM_CATEGORY_LABELS[category],
    rpg: OSM_RPG_NAMES[category],
    lat: element.lat ?? center?.lat ?? null,
    lon: element.lon ?? center?.lon ?? null,
    tags
  };
}

function getOsmCategory(tags) {
  if (tags.railway === "station") return "station";
  if (tags.amenity === "place_of_worship") return "worship";
  if (tags.leisure === "park") return "park";
  if (tags.waterway === "river" || tags.natural === "water" || tags.water === "river") return "water";
  if (tags.shop || ["restaurant", "cafe", "fast_food"].includes(tags.amenity)) return "commercial";
  return null;
}

function summarizeOsmFeatures(features) {
  const summary = { ...OSM_EMPTY_SUMMARY };
  for (const feature of features) {
    summary[feature.category] += 1;
  }
  return summary;
}

function getDominantOsmCategory(summary = OSM_EMPTY_SUMMARY) {
  if (summary.station > 0) return "station";
  if (summary.worship > 0) return "worship";
  if (summary.park > 0) return "park";
  if (summary.water > 0) return "water";
  if (summary.commercial >= 3) return "commercial";
  if (summary.commercial > 0) return "commercial";
  return "none";
}

function applyOsmToVisitedTile(gridId, osmResult) {
  const tile = visitedTiles[gridId];
  if (!tile || !osmResult) return;

  const category = getDominantOsmCategory(osmResult.summary);
  tile.osmCategory = category;
  tile.osmCategoryLabel = OSM_CATEGORY_LABELS[category];
  tile.osmRpgName = OSM_RPG_NAMES[category];

  if (category !== "none") {
    tile.placeName = createOsmPlaceName(gridId, tile.osmRpgName);
  }

  saveVisitedTiles();
}

function createOsmPlaceName(gridId, rpgName) {
  const seed = hashString(`${gridId}:${rpgName}`);
  const prefix = PLACE_PREFIXES[seed % PLACE_PREFIXES.length];
  return `${prefix}${rpgName}`;
}

// ===== 訪問記録 =====
function recordCurrentTile({ force = false } = {}) {
  const now = Date.now();
  const currentGrid = getCurrentGrid();
  const isSameGrid = currentGrid.id === lastRecordedGridId;
  const isCoolingDown = now - lastRecordedAt < VISIT_COOLDOWN_MS;

  // GPS更新が連続しても、同じマスではクールダウン中に増やしません。
  if (!force && isSameGrid && isCoolingDown) {
    setStatus("同じ場所を見渡しています");
    return false;
  }

  const existing = visitedTiles[currentGrid.id];
  visitedTiles[currentGrid.id] = {
    visitCount: existing ? existing.visitCount + 1 : 1,
    firstVisitedAt: existing ? existing.firstVisitedAt : now,
    lastVisitedAt: now,
    placeName: existing ? existing.placeName : generatePlaceName(currentGrid.id)
  };

  lastRecordedGridId = currentGrid.id;
  lastRecordedAt = now;
  selectedGridId = currentGrid.id;
  saveVisitedTiles();
  setStatus(`${visitedTiles[currentGrid.id].placeName} を開拓しました`);
  render();
  ensureOsmForGrid(currentGrid);
  return true;
}

function resetVisitedTiles() {
  const ok = window.confirm("すべての探索データを削除しますか？");
  if (!ok) return;

  visitedTiles = {};
  selectedGridId = null;
  lastRecordedGridId = null;
  lastRecordedAt = 0;
  currentOsmGridId = null;
  currentOsmResult = null;
  currentOsmStatus = "未取得";
  osmCache = {};
  saveVisitedTiles();
  saveOsmCache();
  setStatus("世界は再び霧に包まれました");
  render();
}

// ===== 地名・成長・道ネットワーク =====
function generatePlaceName(gridId) {
  const seed = hashString(gridId);
  const prefix = PLACE_PREFIXES[seed % PLACE_PREFIXES.length];
  const root = PLACE_ROOTS[Math.floor(seed / PLACE_PREFIXES.length) % PLACE_ROOTS.length];
  return `${prefix}${root}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getTileLevel(visitCount = 0) {
  let level = TILE_LEVELS[0];
  for (const candidate of TILE_LEVELS) {
    if (visitCount >= candidate.min) level = candidate;
  }
  return level;
}

function isExplored(gridId) {
  return Boolean(visitedTiles[gridId]);
}

function getConnectionClasses(x, y) {
  // 探索済みの上下左右マスがあれば道としてつながって見えるようにします。
  const directions = [
    { className: "path-n", id: createGridId(x, y + 1) },
    { className: "path-s", id: createGridId(x, y - 1) },
    { className: "path-e", id: createGridId(x + 1, y) },
    { className: "path-w", id: createGridId(x - 1, y) }
  ];
  return directions.filter((direction) => isExplored(direction.id)).map((direction) => direction.className);
}

function getWorldStats() {
  const tiles = Object.entries(visitedTiles);
  const totalVisits = tiles.reduce((sum, [, tile]) => sum + tile.visitCount, 0);
  const best = tiles.reduce((winner, [gridId, tile]) => {
    if (!winner || tile.visitCount > winner.tile.visitCount) return { gridId, tile };
    return winner;
  }, null);

  return {
    exploredCount: tiles.length,
    totalVisits,
    bestTown: best ? `${best.tile.placeName} (${getTileLevel(best.tile.visitCount).name})` : "未発見"
  };
}

function formatTileInfo(gridId) {
  const tile = visitedTiles[gridId];
  const { x, y } = parseGridId(gridId);

  if (!tile) {
    return `${gridId} / 濃い霧 / 未探索`;
  }

  const level = getTileLevel(tile.visitCount);
  const connections = getConnectionClasses(x, y).length;
  const osmText = tile.osmCategory && tile.osmCategory !== "none" ? ` / 周辺特徴 ${tile.osmCategoryLabel} → ${tile.osmRpgName}` : "";
  return `${tile.placeName} / ${level.name}${osmText} / 訪問 ${tile.visitCount} / 道の接続 ${connections} / 最終 ${formatTime(tile.lastVisitedAt)}`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

// ===== 描画 =====
function render() {
  const currentGrid = getCurrentGrid();
  const readout = getCurrentDebugReadout();
  const currentTile = visitedTiles[currentGrid.id];
  const stats = getWorldStats();

  elements.debugModeToggle.checked = debugMode;
  elements.sourceText.textContent = currentGrid.source === "gps" ? "GPS探索" : "疑似探索";
  elements.gridText.textContent = currentGrid.id;
  elements.latText.textContent = readout.latitude;
  elements.lngText.textContent = readout.longitude;
  elements.accuracyText.textContent = readout.accuracy;
  elements.updatedText.textContent = readout.updatedAt;
  elements.exploredCountText.textContent = String(stats.exploredCount);
  elements.totalVisitsText.textContent = String(stats.totalVisits);
  elements.bestTownText.textContent = stats.bestTown;
  elements.currentPlaceText.textContent = currentTile ? currentTile.placeName : "名もなき霧の中";
  renderOsmPanel(currentGrid);

  renderMap(currentGrid);
  renderSelectedTile(currentGrid);
}

function renderOsmPanel(currentGrid) {
  const result = currentOsmGridId === currentGrid.id ? currentOsmResult : null;
  const summary = result ? result.summary : OSM_EMPTY_SUMMARY;
  const dominant = result ? getDominantOsmCategory(result.summary) : "none";
  const status = currentOsmGridId === currentGrid.id ? currentOsmStatus : "未取得";

  elements.osmStatusText.textContent = status;
  elements.osmFeatureText.textContent = result ? `${OSM_CATEGORY_LABELS[dominant]} → ${OSM_RPG_NAMES[dominant]}` : "未判定";
  elements.osmParkText.textContent = String(summary.park);
  elements.osmStationText.textContent = String(summary.station);
  elements.osmWorshipText.textContent = String(summary.worship);
  elements.osmWaterText.textContent = String(summary.water);
  elements.osmCommercialText.textContent = String(summary.commercial);
  renderOsmFeatureList(result);
}

function renderOsmFeatureList(result) {
  elements.osmFeatureList.innerHTML = "";

  if (!result || result.features.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "取得済みのOSM要素はありません。";
    elements.osmFeatureList.appendChild(emptyItem);
    return;
  }

  for (const feature of result.features.slice(0, 80)) {
    const item = document.createElement("li");
    const location = feature.lat !== null && feature.lon !== null ? `${feature.lat.toFixed(5)}, ${feature.lon.toFixed(5)}` : "centerなし";
    item.textContent = `${feature.name} / type: ${feature.type} / category: ${feature.category} / rpg: ${feature.rpg} / ${location} / tags: ${JSON.stringify(feature.tags)}`;
    elements.osmFeatureList.appendChild(item);
  }
}

function renderMap(currentGrid) {
  elements.gridMap.innerHTML = "";

  for (let y = currentGrid.y + MAP_RADIUS; y >= currentGrid.y - MAP_RADIUS; y -= 1) {
    for (let x = currentGrid.x - MAP_RADIUS; x <= currentGrid.x + MAP_RADIUS; x += 1) {
      const gridId = createGridId(x, y);
      const tileData = visitedTiles[gridId];
      const distance = Math.abs(x - currentGrid.x) + Math.abs(y - currentGrid.y);
      const tileButton = document.createElement("button");

      tileButton.type = "button";
      tileButton.dataset.gridId = gridId;
      tileButton.setAttribute("aria-label", formatTileInfo(gridId));

      if (tileData) {
        const level = getTileLevel(tileData.visitCount);
        const osmClass = tileData.osmCategory && tileData.osmCategory !== "none" ? `osm-${tileData.osmCategory}` : "";
        tileButton.className = ["tile", level.className, osmClass, ...getConnectionClasses(x, y)].filter(Boolean).join(" ");
        tileButton.textContent = OSM_SYMBOLS[tileData.osmCategory] || level.symbol;
        tileButton.dataset.count = tileData.visitCount > 0 ? tileData.visitCount : "";
      } else {
        // 未探索マスは霧。現在地の近くのみ少し薄くして、次に進みたくなる余白を作ります。
        tileButton.className = `tile ${distance <= 1 ? "fog-near" : "fog-far"}`;
        tileButton.textContent = distance <= 1 ? "???" : "■■";
        tileButton.dataset.count = "";
      }

      if (gridId === currentGrid.id) tileButton.classList.add("current");
      if (gridId === selectedGridId) tileButton.classList.add("selected");

      tileButton.addEventListener("click", () => {
        selectedGridId = gridId;
        render();
      });

      elements.gridMap.appendChild(tileButton);
    }
  }
}

function renderSelectedTile(currentGrid) {
  const gridId = selectedGridId || currentGrid.id;
  elements.selectedTileText.textContent = formatTileInfo(gridId);
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

// ===== 疑似移動 =====
function moveDebugGrid(dx, dy) {
  debugMode = true;
  debugGrid.x += dx;
  debugGrid.y += dy;
  // 矢印移動はテスト用の「歩いた」操作なので、移動先を即座に開拓します。
  recordCurrentTile({ force: true });
}

// ===== イベント =====
elements.recordButton.addEventListener("click", () => recordCurrentTile({ force: true }));
elements.boostButton.addEventListener("click", () => recordCurrentTile({ force: true }));
elements.resetButton.addEventListener("click", resetVisitedTiles);

elements.moveUpButton.addEventListener("click", () => moveDebugGrid(0, 1));
elements.moveDownButton.addEventListener("click", () => moveDebugGrid(0, -1));
elements.moveLeftButton.addEventListener("click", () => moveDebugGrid(-1, 0));
elements.moveRightButton.addEventListener("click", () => moveDebugGrid(1, 0));

elements.debugModeToggle.addEventListener("change", () => {
  debugMode = elements.debugModeToggle.checked;
  setStatus(debugMode ? "疑似座標で霧を進みます" : "GPS座標で探索します");
  render();
});

// 初期表示ではGPS未取得なら疑似座標を中心にマップを出し、すぐ触れる状態にします。
render();
// GPSはボタン操作なしで同期開始します。許可されない環境では疑似移動だけで遊べます。
startWatchingPosition();
