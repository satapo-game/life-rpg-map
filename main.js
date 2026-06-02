"use strict";

// ===== 調整しやすいプロトタイプ定数 =====
const GRID_SIZE = 0.001; // 約100m前後。値を大きくすると1マスが広くなります。
const VISIT_COOLDOWN_MS = 30000; // GPS更新による同一マスの加算は30秒に1回まで。
const MAP_RADIUS = 5; // 5なら現在地中心の11x11マップ。
const STORAGE_KEY = "lifeRpgMap.visitedTiles.v2";
const LEGACY_STORAGE_KEY = "lifeRpgMap.visitedTiles.v1";
const OSM_CACHE_STORAGE_KEY = "lifeRpgMap.osmCache.v1";
const WORLDORIA_TILES_KEY = "worldoriaTiles";
const WORLDORIA_BUILDINGS_KEY = "worldoriaBuildings";
const WORLDORIA_INVENTORY_KEY = "worldoriaInventory";
const WORLDORIA_HOME_GRID_KEY = "worldoriaHomeGridId";
const WORLDORIA_LAST_ACTIVE_KEY = "worldoriaLastActiveAt";
const WORLDORIA_EVENT_LOGS_KEY = "worldoriaEventLogs";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const OSM_SEARCH_RADIUS_M = 300;
const OSM_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7日
const BUILDING_SPAWN_STAY_MS = 1000 * 60 * 30; // 30分
const DEBUG_BUILDING_SPAWN_STAY_MS = 1000 * 30; // 30秒
const STAY_TICK_MS = 1000 * 10;
const IDLE_EVENT_INTERVAL_MS = 1000 * 60 * 60; // 1時間に1回
const DEBUG_IDLE_EVENT_INTERVAL_MS = 1000 * 60; // 1分に1回
const MAX_IDLE_EVENTS = 8;
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

const BUILDING_TYPES = [
  {
    id: "camp",
    name: "野営地",
    symbol: "⛺",
    description: "旅人が休む小さな野営地。",
    effect: "idle_explore"
  },
  {
    id: "inn",
    name: "宿屋",
    symbol: "🏠",
    description: "旅人が集まり、周辺を調査する。",
    effect: "idle_explore"
  },
  {
    id: "market",
    name: "市場",
    symbol: "🏪",
    description: "不在中に小さな交易が発生する。",
    effect: "idle_items"
  },
  {
    id: "tower",
    name: "見張り塔",
    symbol: "🗼",
    description: "周囲の霧を少しだけ晴らす。",
    effect: "idle_reveal"
  },
  {
    id: "library",
    name: "図書館",
    symbol: "📚",
    description: "探索記録を整理し、知識を得る。",
    effect: "idle_knowledge"
  }
];

const HOME_BUILDING = {
  id: "home",
  name: "故郷",
  symbol: "🏡",
  description: "旅の始まりとなる場所。",
  effect: "home_base"
};

const ITEM_TYPES = [
  { id: "wood", name: "木材", symbol: "🪵" },
  { id: "stone", name: "石材", symbol: "🪨" },
  { id: "herb", name: "薬草", symbol: "🌿" },
  { id: "coin", name: "古銭", symbol: "🪙" }
];

const DEFAULT_INVENTORY = {
  wood: 0,
  stone: 0,
  herb: 0,
  coin: 0,
  knowledge: 0
};

// ===== DOM参照 =====
const elements = {
  notificationBar: document.querySelector("#notificationBar"),
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
  tileDetailSheet: document.querySelector("#tileDetailSheet"),
  closeTileDetailButton: document.querySelector("#closeTileDetailButton"),
  tabButtons: document.querySelectorAll(".tab-button"),
  tabViews: document.querySelectorAll(".tab-view"),
  stayTimeText: document.querySelector("#stayTimeText"),
  buildingText: document.querySelector("#buildingText"),
  buildingEffectText: document.querySelector("#buildingEffectText"),
  inventoryText: document.querySelector("#inventoryText"),
  offlineLogPanel: document.querySelector("#offlineLogPanel"),
  offlineLogTitle: document.querySelector("#offlineLogTitle"),
  offlineLogList: document.querySelector("#offlineLogList"),
  eventLogList: document.querySelector("#eventLogList"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  recordButton: document.querySelector("#recordButton"),
  boostButton: document.querySelector("#boostButton"),
  setHomeButton: document.querySelector("#setHomeButton"),
  debugStayButton: document.querySelector("#debugStayButton"),
  debugIdleButton: document.querySelector("#debugIdleButton"),
  debugBackdateButton: document.querySelector("#debugBackdateButton"),
  closeOfflineLogButton: document.querySelector("#closeOfflineLogButton"),
  resetButton: document.querySelector("#resetButton"),
  moveUpButton: document.querySelector("#moveUpButton"),
  moveLeftButton: document.querySelector("#moveLeftButton"),
  moveDownButton: document.querySelector("#moveDownButton"),
  moveRightButton: document.querySelector("#moveRightButton")
};

// ===== アプリ状態 =====
let visitedTiles = loadVisitedTiles();
let osmCache = loadOsmCache();
let buildings = loadBuildings();
let inventory = loadInventory();
let homeGridId = localStorage.getItem(WORLDORIA_HOME_GRID_KEY) || null;
let eventLogs = loadEventLogs();
let watchId = null;
let gpsPosition = null;
let debugMode = false;
let debugGrid = { ...DEBUG_START_GRID };
let selectedGridId = null;
let lastRecordedGridId = null;
let lastRecordedAt = 0;
let lastKnownGridId = localStorage.getItem("worldoriaLastGridId") || null;
let stayGridId = null;
let stayStartedAt = Date.now();
let currentOsmGridId = null;
let currentOsmResult = null;
let currentOsmStatus = "未取得";
let osmRequestSerial = 0;

// ===== localStorage =====
function loadVisitedTiles() {
  try {
    const saved = localStorage.getItem(WORLDORIA_TILES_KEY) || localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
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
      placeName: tile.placeName || generatePlaceName(gridId),
      stayTimeMs: Number(tile.stayTimeMs) || 0,
      lastStayStartedAt: Number(tile.lastStayStartedAt) || null,
      building: tile.building || null,
      osmCategory: tile.osmCategory || null,
      osmCategoryLabel: tile.osmCategoryLabel || null,
      osmRpgName: tile.osmRpgName || null,
      revealedByIdle: Boolean(tile.revealedByIdle)
    };
  }
  return normalized;
}

function saveVisitedTiles() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(visitedTiles));
  localStorage.setItem(WORLDORIA_TILES_KEY, JSON.stringify(visitedTiles));
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

function loadBuildings() {
  try {
    return JSON.parse(localStorage.getItem(WORLDORIA_BUILDINGS_KEY)) || {};
  } catch (error) {
    console.warn("建物データの読み込みに失敗しました。", error);
    return {};
  }
}

function saveBuildings() {
  localStorage.setItem(WORLDORIA_BUILDINGS_KEY, JSON.stringify(buildings));
}

function loadInventory() {
  try {
    return { ...DEFAULT_INVENTORY, ...(JSON.parse(localStorage.getItem(WORLDORIA_INVENTORY_KEY)) || {}) };
  } catch (error) {
    console.warn("所持品データの読み込みに失敗しました。", error);
    return { ...DEFAULT_INVENTORY };
  }
}

function saveInventory() {
  localStorage.setItem(WORLDORIA_INVENTORY_KEY, JSON.stringify(inventory));
}

function loadEventLogs() {
  try {
    return JSON.parse(localStorage.getItem(WORLDORIA_EVENT_LOGS_KEY)) || [];
  } catch (error) {
    console.warn("イベントログの読み込みに失敗しました。", error);
    return [];
  }
}

function saveEventLogs() {
  localStorage.setItem(WORLDORIA_EVENT_LOGS_KEY, JSON.stringify(eventLogs.slice(-80)));
}

function saveLastActiveAt(timestamp = Date.now()) {
  localStorage.setItem(WORLDORIA_LAST_ACTIVE_KEY, String(timestamp));
}

function saveLastKnownGrid(gridId) {
  lastKnownGridId = gridId;
  localStorage.setItem("worldoriaLastGridId", gridId);
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

// ===== 滞在・建物生成 =====
function getBuildingSpawnStayMs() {
  return debugMode ? DEBUG_BUILDING_SPAWN_STAY_MS : BUILDING_SPAWN_STAY_MS;
}

function ensureTile(gridId, now = Date.now()) {
  if (visitedTiles[gridId]) return visitedTiles[gridId];

  visitedTiles[gridId] = {
    visitCount: 1,
    firstVisitedAt: now,
    lastVisitedAt: now,
    placeName: generatePlaceName(gridId),
    stayTimeMs: 0,
    lastStayStartedAt: null,
    building: null,
    revealedByIdle: true
  };
  return visitedTiles[gridId];
}

function updateStayTracking(grid, now = Date.now(), forceAccumulate = false) {
  if (!stayGridId) {
    stayGridId = grid.id;
    stayStartedAt = now;
    ensureTile(grid.id, now).lastStayStartedAt = now;
    return;
  }

  if (stayGridId !== grid.id) {
    addStayTime(stayGridId, now - stayStartedAt);
    stayGridId = grid.id;
    stayStartedAt = now;
    ensureTile(grid.id, now).lastStayStartedAt = now;
    return;
  }

  if (forceAccumulate) {
    addStayTime(stayGridId, now - stayStartedAt);
    stayStartedAt = now;
    ensureTile(stayGridId, now).lastStayStartedAt = now;
  }
}

function addStayTime(gridId, deltaMs) {
  if (deltaMs <= 0) return;

  const tile = ensureTile(gridId);
  tile.stayTimeMs = (Number(tile.stayTimeMs) || 0) + deltaMs;
  maybeSpawnBuilding(gridId);
  saveVisitedTiles();
}

function getCurrentStayTime(gridId) {
  const tile = visitedTiles[gridId];
  const base = tile ? Number(tile.stayTimeMs) || 0 : 0;
  if (stayGridId === gridId) {
    return base + Math.max(0, Date.now() - stayStartedAt);
  }
  return base;
}

function maybeSpawnBuilding(gridId) {
  const tile = visitedTiles[gridId];
  if (!tile || tile.building || buildings[gridId]) return;
  if ((Number(tile.stayTimeMs) || 0) < getBuildingSpawnStayMs()) return;

  const building = createRandomBuilding(gridId);
  attachBuildingToGrid(gridId, building);
  addEventLog(`${tile.placeName} に ${building.name} が生まれました。`);
}

function createRandomBuilding(gridId) {
  const type = BUILDING_TYPES[hashString(`${gridId}:${Date.now()}`) % BUILDING_TYPES.length];
  return {
    ...type,
    createdAt: Date.now(),
    gridId
  };
}

function attachBuildingToGrid(gridId, building) {
  const tile = ensureTile(gridId);
  tile.building = building;
  buildings[gridId] = building;
  saveVisitedTiles();
  saveBuildings();
}

function setCurrentGridAsHome() {
  const grid = getCurrentGrid();
  const now = Date.now();
  homeGridId = grid.id;
  localStorage.setItem(WORLDORIA_HOME_GRID_KEY, homeGridId);

  const tile = ensureTile(grid.id, now);
  tile.visitCount = Math.max(1, tile.visitCount || 0);
  tile.lastVisitedAt = now;
  tile.placeName = "旅立ちの故郷";
  attachBuildingToGrid(grid.id, { ...HOME_BUILDING, createdAt: now, gridId: grid.id });
  selectedGridId = grid.id;
  saveLastKnownGrid(grid.id);
  addEventLog(`${tile.placeName} を自宅に設定しました。`);
  setStatus("現在地を自宅に設定しました");
  render();
}

function addDebugStayTime() {
  const grid = getCurrentGrid();
  ensureTile(grid.id);
  addStayTime(grid.id, BUILDING_SPAWN_STAY_MS);
  selectedGridId = grid.id;
  setStatus("現在地の滞在時間を30分加算しました");
  render();
}

function syncBuildingsFromTiles() {
  for (const [gridId, tile] of Object.entries(visitedTiles)) {
    if (tile.building && !buildings[gridId]) {
      buildings[gridId] = tile.building;
    }
  }
  for (const [gridId, building] of Object.entries(buildings)) {
    const tile = ensureTile(gridId);
    if (!tile.building) tile.building = building;
  }
  saveVisitedTiles();
  saveBuildings();
}

// ===== 放置システム =====
function processOfflineEvents() {
  const now = Date.now();
  const lastActiveAt = Number(localStorage.getItem(WORLDORIA_LAST_ACTIVE_KEY)) || now;
  const offlineMs = Math.max(0, now - lastActiveAt);
  const eventCount = Math.min(Math.floor(offlineMs / IDLE_EVENT_INTERVAL_MS), MAX_IDLE_EVENTS);

  if (eventCount <= 0) {
    saveLastActiveAt(now);
    return [];
  }

  const logs = runIdleEvents(eventCount);
  saveLastActiveAt(now);
  if (logs.length > 0) showOfflineLogs(logs);
  return logs;
}

function runIdleEvents(eventCount = 1) {
  const logs = [];
  for (let i = 0; i < eventCount; i += 1) {
    const target = findIdleTargetGrid();
    if (!target) break;

    const log = applyIdleBuildingEffect(target.gridId, target.building);
    if (log) logs.push(log);
  }

  if (logs.length > 0) {
    saveVisitedTiles();
    saveBuildings();
    saveInventory();
    saveEventLogs();
    render();
  }

  return logs;
}

function findIdleTargetGrid() {
  const candidates = [];
  if (lastKnownGridId) candidates.push(lastKnownGridId);
  if (lastKnownGridId) candidates.push(...getNeighborGridIds(lastKnownGridId, 1));
  if (homeGridId) candidates.push(homeGridId);
  candidates.push(...Object.keys(buildings));

  for (const gridId of [...new Set(candidates)]) {
    const building = buildings[gridId] || visitedTiles[gridId]?.building;
    if (building) return { gridId, building };
  }

  return null;
}

function applyIdleBuildingEffect(gridId, building) {
  const tile = ensureTile(gridId);
  const name = tile.placeName || generatePlaceName(gridId);

  if (building.effect === "idle_explore") {
    const revealed = revealNearbyTile(gridId, 1);
    const log = revealed
      ? `${building.name}の旅人が周辺を調査し、${directionFromTo(gridId, revealed)}の霧を晴らしました。`
      : `${building.name}の旅人が${name}の周辺を見回りました。`;
    addEventLog(log);
    return log;
  }

  if (building.effect === "idle_items") {
    const item = ITEM_TYPES[hashString(`${gridId}:${Date.now()}:${eventLogs.length}`) % ITEM_TYPES.length];
    const amount = 1 + (hashString(`${item.id}:${Date.now()}`) % 3);
    inventory[item.id] += amount;
    const log = `${building.name}で${item.name}を${amount}個入手しました。`;
    addEventLog(log);
    return log;
  }

  if (building.effect === "idle_reveal") {
    const revealed = revealNearbyTile(gridId, 2);
    const log = revealed
      ? `${building.name}が${directionFromTo(gridId, revealed)}の霧を少し晴らしました。`
      : `${building.name}が遠くの霧を見張っています。`;
    addEventLog(log);
    return log;
  }

  if (building.effect === "idle_knowledge" || building.effect === "home_base") {
    inventory.knowledge += 1;
    const log = `${building.name}で探索記録が整理され、知識を1得ました。`;
    addEventLog(log);
    return log;
  }

  return null;
}

function revealNearbyTile(originGridId, radius) {
  const candidates = getNeighborGridIds(originGridId, radius).filter((gridId) => !visitedTiles[gridId]);
  if (candidates.length === 0) return null;

  const chosen = candidates[hashString(`${originGridId}:${Date.now()}:${candidates.length}`) % candidates.length];
  const now = Date.now();
  const tile = ensureTile(chosen, now);
  tile.visitCount = Math.max(1, tile.visitCount || 0);
  tile.firstVisitedAt = tile.firstVisitedAt || now;
  tile.lastVisitedAt = now;
  tile.revealedByIdle = true;
  return chosen;
}

function getNeighborGridIds(gridId, radius) {
  const { x, y } = parseGridId(gridId);
  const ids = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      ids.push(createGridId(x + dx, y + dy));
    }
  }
  return ids;
}

function directionFromTo(fromGridId, toGridId) {
  const from = parseGridId(fromGridId);
  const to = parseGridId(toGridId);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "東" : "西";
  if (dy !== 0) return dy > 0 ? "北" : "南";
  return "近く";
}

function addEventLog(message) {
  const entry = {
    id: `${Date.now()}_${eventLogs.length}`,
    message,
    createdAt: Date.now()
  };
  eventLogs.push(entry);
  eventLogs = eventLogs.slice(-80);
  saveEventLogs();
}

function showOfflineLogs(logs) {
  elements.offlineLogPanel.classList.remove("hidden");
  elements.offlineLogTitle.textContent = `${logs.length}件の出来事`;
  elements.offlineLogList.innerHTML = "";
  for (const log of logs) {
    const item = document.createElement("li");
    item.textContent = log;
    elements.offlineLogList.appendChild(item);
  }
  setStatus(`🌙 不在中に${logs.length}件の出来事`);
}

function hideOfflineLogs() {
  elements.offlineLogPanel.classList.add("hidden");
}

function switchTab(tabName) {
  for (const view of elements.tabViews) {
    view.classList.toggle("active", view.dataset.tabPanel === tabName);
  }

  for (const button of elements.tabButtons) {
    button.classList.toggle("active", button.dataset.tab === tabName);
  }

  if (tabName !== "map") {
    hideTileDetail();
  }
}

function debugBackdateLastActive() {
  saveLastActiveAt(Date.now() - 1000 * 60 * 60 * 2);
  setStatus("lastActiveAtを2時間前にしました");
}

function debugRunIdleEvent() {
  const logs = runIdleEvents(1);
  if (logs.length > 0) {
    showOfflineLogs(logs);
    setStatus("放置イベントを実行しました");
  } else {
    setStatus("放置イベントの起点になる建物がありません");
  }
}

function showTileDetail(gridId) {
  selectedGridId = gridId;
  elements.selectedTileText.textContent = formatTileInfo(gridId);
  elements.tileDetailSheet.classList.remove("hidden");
  renderMap(getCurrentGrid());
}

function hideTileDetail() {
  elements.tileDetailSheet.classList.add("hidden");
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
  updateStayTracking(currentGrid, now);
  const isSameGrid = currentGrid.id === lastRecordedGridId;
  const isCoolingDown = now - lastRecordedAt < VISIT_COOLDOWN_MS;

  // GPS更新が連続しても、同じマスではクールダウン中に増やしません。
  if (!force && isSameGrid && isCoolingDown) {
    setStatus("同じ場所を見渡しています");
    return false;
  }

  const existing = visitedTiles[currentGrid.id];
  visitedTiles[currentGrid.id] = {
    ...(existing || {}),
    visitCount: existing ? existing.visitCount + 1 : 1,
    firstVisitedAt: existing ? existing.firstVisitedAt : now,
    lastVisitedAt: now,
    placeName: existing ? existing.placeName : generatePlaceName(currentGrid.id),
    stayTimeMs: existing ? Number(existing.stayTimeMs) || 0 : 0,
    lastStayStartedAt: existing ? existing.lastStayStartedAt : now,
    building: existing ? existing.building : null
  };

  lastRecordedGridId = currentGrid.id;
  lastRecordedAt = now;
  selectedGridId = currentGrid.id;
  saveLastKnownGrid(currentGrid.id);
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
  buildings = {};
  inventory = { ...DEFAULT_INVENTORY };
  homeGridId = null;
  eventLogs = [];
  selectedGridId = null;
  lastRecordedGridId = null;
  lastRecordedAt = 0;
  lastKnownGridId = null;
  stayGridId = null;
  stayStartedAt = Date.now();
  currentOsmGridId = null;
  currentOsmResult = null;
  currentOsmStatus = "未取得";
  osmCache = {};
  saveVisitedTiles();
  saveBuildings();
  saveInventory();
  saveEventLogs();
  saveOsmCache();
  localStorage.removeItem(WORLDORIA_HOME_GRID_KEY);
  localStorage.removeItem("worldoriaLastGridId");
  saveLastActiveAt();
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
  const buildingText = tile.building ? ` / 建物 ${tile.building.symbol}${tile.building.name}` : "";
  return `${tile.placeName} / ${level.name}${osmText}${buildingText} / 滞在 ${formatDuration(getCurrentStayTime(gridId))} / 訪問 ${tile.visitCount} / 道の接続 ${connections} / 最終 ${formatTime(tile.lastVisitedAt)}`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}時間${minutes}分`;
  return `${minutes}分`;
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
  renderCurrentTilePanel(currentGrid);
  renderInventory();
  renderEventLogList();
  renderOsmPanel(currentGrid);

  renderMap(currentGrid);
  renderSelectedTile(currentGrid);
}

function renderCurrentTilePanel(currentGrid) {
  const tile = visitedTiles[currentGrid.id];
  const building = tile?.building || buildings[currentGrid.id] || null;
  elements.stayTimeText.textContent = formatDuration(getCurrentStayTime(currentGrid.id));
  elements.buildingText.textContent = building ? `${building.symbol} ${building.name}` : "なし";
  elements.buildingEffectText.textContent = building ? `${building.effect}` : "--";
}

function renderInventory() {
  elements.inventoryText.textContent = [
    `${ITEM_TYPES[0].name}: ${inventory.wood}`,
    `${ITEM_TYPES[1].name}: ${inventory.stone}`,
    `${ITEM_TYPES[2].name}: ${inventory.herb}`,
    `${ITEM_TYPES[3].name}: ${inventory.coin}`,
    `知識: ${inventory.knowledge}`
  ].join(" / ");
}

function renderEventLogList() {
  elements.eventLogList.innerHTML = "";
  const logs = eventLogs.slice(-30).reverse();
  if (logs.length === 0) {
    const item = document.createElement("li");
    item.textContent = "まだ出来事はありません。";
    elements.eventLogList.appendChild(item);
    return;
  }

  for (const log of logs) {
    const item = document.createElement("li");
    item.textContent = `${formatTime(log.createdAt)} / ${log.message}`;
    elements.eventLogList.appendChild(item);
  }
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
        const buildingClass = tileData.building ? "has-building" : "";
        tileButton.className = ["tile", level.className, osmClass, buildingClass, ...getConnectionClasses(x, y)].filter(Boolean).join(" ");
        tileButton.textContent = tileData.building ? tileData.building.symbol : OSM_SYMBOLS[tileData.osmCategory] || level.symbol;
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
        showTileDetail(gridId);
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
  const quietMessages = ["Worldoria", "静かな世界", "同じ場所を見渡しています"];
  elements.notificationBar.classList.toggle("has-notice", !quietMessages.includes(message));
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
elements.startButton.addEventListener("click", startWatchingPosition);
elements.stopButton.addEventListener("click", () => {
  stopWatchingPosition();
  render();
});
elements.recordButton.addEventListener("click", () => recordCurrentTile({ force: true }));
elements.boostButton.addEventListener("click", () => recordCurrentTile({ force: true }));
elements.setHomeButton.addEventListener("click", setCurrentGridAsHome);
elements.debugStayButton.addEventListener("click", addDebugStayTime);
elements.debugIdleButton.addEventListener("click", debugRunIdleEvent);
elements.debugBackdateButton.addEventListener("click", debugBackdateLastActive);
elements.closeOfflineLogButton.addEventListener("click", hideOfflineLogs);
elements.closeTileDetailButton.addEventListener("click", hideTileDetail);
elements.notificationBar.addEventListener("click", () => switchTab("log"));
for (const button of elements.tabButtons) {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
}
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

window.addEventListener("beforeunload", () => {
  updateStayTracking(getCurrentGrid(), Date.now(), true);
  saveLastActiveAt();
});

// 初期表示ではGPS未取得なら疑似座標を中心にマップを出し、すぐ触れる状態にします。
syncBuildingsFromTiles();
processOfflineEvents();
render();
// GPSはボタン操作なしで同期開始します。許可されない環境では疑似移動だけで遊べます。
startWatchingPosition();

setInterval(() => {
  updateStayTracking(getCurrentGrid(), Date.now(), true);
  saveLastActiveAt();
  render();
}, STAY_TICK_MS);
