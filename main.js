"use strict";

// ===== 調整しやすいプロトタイプ定数 =====
const GRID_SIZE = 0.001; // 約100m前後。値を大きくすると1マスが広くなります。
const VISIT_COOLDOWN_MS = 30000; // GPS更新による同一マスの加算は30秒に1回まで。
const MAP_RADIUS = 5; // 5なら現在地中心の11x11マップ。
const STORAGE_KEY = "lifeRpgMap.visitedTiles.v2";
const LEGACY_STORAGE_KEY = "lifeRpgMap.visitedTiles.v1";
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
let watchId = null;
let gpsPosition = null;
let debugMode = false;
let debugGrid = { ...DEBUG_START_GRID };
let selectedGridId = null;
let lastRecordedGridId = null;
let lastRecordedAt = 0;

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
  return true;
}

function resetVisitedTiles() {
  const ok = window.confirm("すべての探索データを削除しますか？");
  if (!ok) return;

  visitedTiles = {};
  selectedGridId = null;
  lastRecordedGridId = null;
  lastRecordedAt = 0;
  saveVisitedTiles();
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
  return `${tile.placeName} / ${level.name} / 訪問 ${tile.visitCount} / 道の接続 ${connections} / 最終 ${formatTime(tile.lastVisitedAt)}`;
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

  renderMap(currentGrid);
  renderSelectedTile(currentGrid);
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
        tileButton.className = ["tile", level.className, ...getConnectionClasses(x, y)].join(" ");
        tileButton.textContent = level.symbol;
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
