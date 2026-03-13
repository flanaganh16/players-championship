const http = require("http");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { URL } = require("url");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, ".env");
const LEGACY_STATE_PATH = path.join(ROOT, "game-state.json");
const DB_PATH = process.env.STATE_DB_PATH || path.join(ROOT, "game-state.db");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

loadDotEnv(ENV_PATH);

const config = {
  dataGolfKey: (process.env.DATAGOLF_API_KEY || "").trim(),
  dataGolfBaseUrl: (process.env.DATAGOLF_BASE_URL || "https://feeds.datagolf.com").replace(/\/$/, ""),
  dataGolfTour: process.env.DATAGOLF_TOUR || "pga",
  adminRoute: normalizeAdminRoute(process.env.ADMIN_ROUTE || "/admin"),
  serverAutoRefreshSeconds: Number(process.env.SERVER_AUTO_REFRESH_SECONDS || 300) || 0
};
const DATAGOLF_DASHBOARD_STATS = "sg_total,sg_t2g,sg_ott,sg_app,sg_arg,sg_putt,gir,accuracy,distance,scrambling";
const sharedStateDb = initializeSharedStateDb(DB_PATH);
let sharedStateStore = loadSharedStateStore(sharedStateDb);
let serverAutoRefreshHandle = null;
let serverAutoRefreshInFlight = false;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveIndex(response, "viewer");
    }

    if (url.pathname === config.adminRoute) {
      return serveIndex(response, "admin");
    }

    if (url.pathname === "/api/state") {
      if (request.method === "GET") {
        return writeJson(response, 200, sharedStateStore);
      }

      if (request.method === "PUT") {
        ensureAdminRequest(request);
        return await handleSharedStateUpdate(request, response);
      }

      return writeJson(response, 405, { error: "Method not allowed." });
    }

    if (url.pathname === "/api/live/status") {
      return writeJson(response, 200, {
        available: true,
        configured: Boolean(config.dataGolfKey),
        provider: "Data Golf",
        tournamentLookupConfigured: false
      });
    }

    if (url.pathname === "/api/datagolf/in-play") {
      return await handleDataGolfInPlay(url, response);
    }

    if (url.pathname === "/api/datagolf/live-stats") {
      return await handleDataGolfLiveStats(url, response);
    }

    if (url.pathname === "/api/datagolf/import") {
      return await handleDataGolfImport(url, response);
    }

    if (url.pathname === "/api/live/import") {
      return await handleDataGolfImport(url, response);
    }

    if (url.pathname === "/api/live/field") {
      ensureAdminRequest(request);
      return await handleDataGolfField(url, response);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    logServerError(error);
    return writeJson(response, error.statusCode || 500, {
      error: error.message || "Unexpected server error.",
      details: error.details || null
    });
  }
});

server.listen(PORT, () => {
  console.log(`Players Championship Fantasy Draft server running at http://localhost:${PORT}`);
  startServerAutoRefresh();
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try another port or stop the app already using it.`);
    process.exit(1);
  }

  console.error(error.message || "Server failed to start.");
  process.exit(1);
});

async function handleSharedStateUpdate(request, response) {
  const payload = await readJsonBody(request);
  if (!payload || typeof payload !== "object" || !payload.state || typeof payload.state !== "object") {
    return writeJson(response, 400, {
      error: "Request body must include a state object."
    });
  }

  sharedStateStore = {
    state: payload.state,
    meta: {
      updatedAt: new Date().toISOString(),
      updatedBy: String(payload.clientId || "unknown")
    }
  };

  saveSharedStateStore(sharedStateStore);
  return writeJson(response, 200, sharedStateStore);
}

async function handleDataGolfInPlay(url, response) {
  ensureDataGolfConfigured();

  const tour = url.searchParams.get("tour") || config.dataGolfTour;
  const payload = await fetchDataGolfJson("/preds/in-play", {
    tour,
    dead_heat: url.searchParams.get("dead_heat") || "no",
    odds_format: url.searchParams.get("odds_format") || "percent",
    file_format: "json"
  }, "in-play predictions");

  const players = extractDataGolfPlayers(payload);
  if (!Array.isArray(players) || !players.length) {
    const error = new Error("Data Golf in-play response did not contain player rows.");
    error.statusCode = 502;
    error.details = {
      responseKeys: payload && typeof payload === "object" ? Object.keys(payload) : typeof payload
    };
    throw error;
  }

  return writeJson(response, 200, {
    tournament: extractDataGolfTournament(payload, tour),
    players: players.map(normalizeDataGolfPlayer).filter((player) => player.name)
  });
}

async function handleDataGolfLiveStats(url, response) {
  ensureDataGolfConfigured();

  const tour = url.searchParams.get("tour") || config.dataGolfTour;
  const payload = await fetchDataGolfJson("/preds/live-tournament-stats", {
    stats: url.searchParams.get("stats") || DATAGOLF_DASHBOARD_STATS,
    round: url.searchParams.get("round") || "event_cumulative",
    display: url.searchParams.get("display") || "value",
    file_format: "json"
  }, "live tournament stats");

  const players = extractDataGolfLiveStatsPlayers(payload);
  if (!Array.isArray(players) || !players.length) {
    const error = new Error("Data Golf live tournament stats response did not contain player rows.");
    error.statusCode = 502;
    error.details = {
      responseKeys: payload && typeof payload === "object" ? Object.keys(payload) : typeof payload
    };
    throw error;
  }

  return writeJson(response, 200, {
    tournament: extractDataGolfLiveStatsTournament(payload, tour),
    players: players.map(normalizeDataGolfLiveStatsPlayer).filter((player) => player.name)
  });
}

async function handleDataGolfImport(url, response) {
  const tour = url.searchParams.get("tour") || config.dataGolfTour;
  const payload = await fetchDataGolfImportPayload(tour);

  return writeJson(response, 200, {
    tournament: payload.tournament,
    liveStats: payload.liveStats,
    inPlay: payload.inPlay
  });
}

async function handleDataGolfField(url, response) {
  ensureDataGolfConfigured();

  const tour = url.searchParams.get("tour") || config.dataGolfTour;
  const payload = await fetchDataGolfJson("/preds/live-tournament-stats", {
    stats: url.searchParams.get("stats") || DATAGOLF_DASHBOARD_STATS,
    round: url.searchParams.get("round") || "event_cumulative",
    display: url.searchParams.get("display") || "value",
    file_format: "json"
  }, "live tournament stats");

  const players = extractDataGolfLiveStatsPlayers(payload);
  if (!Array.isArray(players) || !players.length) {
    const error = new Error("Data Golf live tournament stats response did not contain player rows.");
    error.statusCode = 502;
    error.details = {
      responseKeys: payload && typeof payload === "object" ? Object.keys(payload) : typeof payload
    };
    throw error;
  }

  const golfers = Array.from(
    new Set(
      players
        .map((player) => normalizeDataGolfLiveStatsPlayer(player).name)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  return writeJson(response, 200, {
    tournament: extractDataGolfLiveStatsTournament(payload, tour),
    golfers
  });
}

async function fetchDataGolfImportPayload(tour) {
  ensureDataGolfConfigured();

  const [statsPayload, inPlayPayload] = await Promise.all([
    fetchDataGolfJson("/preds/live-tournament-stats", {
      stats: DATAGOLF_DASHBOARD_STATS,
      round: "event_cumulative",
      display: "value",
      file_format: "json"
    }, "live tournament stats"),
    fetchDataGolfJson("/preds/in-play", {
      tour,
      dead_heat: "no",
      odds_format: "percent",
      file_format: "json"
    }, "in-play predictions")
  ]);

  const statsPlayers = extractDataGolfLiveStatsPlayers(statsPayload);
  const predictionPlayers = extractDataGolfPlayers(inPlayPayload);

  if (!Array.isArray(statsPlayers) || !statsPlayers.length) {
    const error = new Error("Data Golf live tournament stats response did not contain player rows.");
    error.statusCode = 502;
    error.details = {
      responseKeys: statsPayload && typeof statsPayload === "object" ? Object.keys(statsPayload) : typeof statsPayload
    };
    throw error;
  }

  return {
    tournament: extractDataGolfLiveStatsTournament(statsPayload, tour),
    liveStats: statsPlayers.map(normalizeDataGolfLiveStatsPlayer).filter((player) => player.name),
    inPlay: Array.isArray(predictionPlayers) ? predictionPlayers.map(normalizeDataGolfPlayer).filter((player) => player.name) : []
  };
}

function startServerAutoRefresh() {
  if (serverAutoRefreshHandle) {
    clearInterval(serverAutoRefreshHandle);
    serverAutoRefreshHandle = null;
  }

  if (!config.serverAutoRefreshSeconds || !config.dataGolfKey) {
    return;
  }

  serverAutoRefreshHandle = setInterval(() => {
    runServerAutoRefresh();
  }, config.serverAutoRefreshSeconds * 1000);

  setTimeout(() => {
    runServerAutoRefresh();
  }, 5000);
}

async function runServerAutoRefresh() {
  if (serverAutoRefreshInFlight || !sharedStateStore?.state || !config.dataGolfKey) {
    return;
  }

  const state = sharedStateStore.state;
  const hasRelevantState = Boolean(
    (state.draftStarted || Object.keys(state.draftedGolfers || {}).length || (state.golfers || []).length)
  );

  if (!hasRelevantState) {
    return;
  }

  serverAutoRefreshInFlight = true;

  try {
    const payload = await fetchDataGolfImportPayload(config.dataGolfTour);
    const nextState = applyDataGolfPayloadToSharedState(state, payload);

    sharedStateStore = {
      state: nextState,
      meta: {
        updatedAt: new Date().toISOString(),
        updatedBy: "server-auto-refresh"
      }
    };

    saveSharedStateStore(sharedStateStore);
  } catch (error) {
    logServerError(error);
  } finally {
    serverAutoRefreshInFlight = false;
  }
}

function applyDataGolfPayloadToSharedState(state, payload) {
  const nextState = JSON.parse(JSON.stringify(state || {}));
  const liveStats = Array.isArray(payload.liveStats) ? payload.liveStats : [];
  const inPlay = Array.isArray(payload.inPlay) ? payload.inPlay : [];
  const feedByName = new Map(liveStats.map((player) => [normalizeText(player.name), player]));

  nextState.livePlayers = liveStats.map((player) => ({
    ...player,
    position: player.position || "-",
    score: player.score || "E",
    todayScore: player.todayScore || "E",
    money: Number(player.money) || 0,
    madeCut: player.madeCut !== false,
    thru: player.thru || "",
    teeTime: player.teeTime || ""
  }));

  nextState.dataGolfPlayers = inPlay.map((player) => ({
    ...player,
    win: normalizePercentDisplayValue(player.win),
    top5: normalizePercentDisplayValue(player.top5),
    top10: normalizePercentDisplayValue(player.top10),
    top20: normalizePercentDisplayValue(player.top20),
    makeCut: normalizePercentDisplayValue(player.makeCut)
  }));

  nextState.scores = nextState.scores && typeof nextState.scores === "object" ? nextState.scores : {};
  Object.keys(nextState.draftedGolfers || {}).forEach((golfer) => {
    const incoming = feedByName.get(normalizeText(golfer));
    if (!incoming) {
      return;
    }

    nextState.scores[golfer] = normalizeSharedGolferState({
      ...(nextState.scores[golfer] || {}),
      position: incoming.position,
      score: incoming.score,
      todayScore: incoming.todayScore,
      money: String(incoming.money ?? 0),
      madeCut: incoming.madeCut
    });
  });

  nextState.liveSettings = nextState.liveSettings && typeof nextState.liveSettings === "object" ? nextState.liveSettings : {};
  nextState.liveSettings.lastSyncAt = new Date().toISOString();
  nextState.liveSettings.lastTournamentName = payload.tournament?.name || nextState.liveSettings.lastTournamentName || "";
  nextState.liveSettings.lastSyncSummary = `Server auto-refresh loaded Data Golf live stats for ${nextState.livePlayers.length} golfers.`;
  nextState.scoreHistory = Array.isArray(nextState.scoreHistory) ? nextState.scoreHistory : [];

  recordSharedStateSnapshot(nextState, "Server auto-refresh");
  return nextState;
}

function ensureDataGolfConfigured() {
  if (!config.dataGolfKey) {
    const error = new Error("DATAGOLF_API_KEY is missing.");
    error.statusCode = 500;
    error.details = {
      configured: false,
      envFile: ENV_PATH,
      expectedVariable: "DATAGOLF_API_KEY"
    };
    throw error;
  }
}

async function fetchDataGolfJson(endpointPath, params, label) {
  const requestUrl = new URL(`${config.dataGolfBaseUrl}${endpointPath}`);
  Object.entries({
    ...params,
    key: config.dataGolfKey
  }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      requestUrl.searchParams.set(key, String(value));
    }
  });

  try {
    const response = await fetch(requestUrl, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`Data Golf ${label} request failed.`);
      error.statusCode = 502;
      error.details = {
        url: requestUrl.toString().replace(config.dataGolfKey, "[redacted]"),
        status: response.status,
        body: body.slice(0, 300)
      };
      throw error;
    }

    return await response.json();
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    const networkError = new Error(`Data Golf ${label} request failed.`);
    networkError.statusCode = 502;
    networkError.details = {
      url: requestUrl.toString().replace(config.dataGolfKey, "[redacted]"),
      status: "NETWORK_ERROR",
      body: error.message
    };
    throw networkError;
  }
}

function extractDataGolfPlayers(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (Array.isArray(payload.players)) {
    return payload.players;
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  const arrayEntry = Object.values(payload).find((value) => Array.isArray(value));
  return Array.isArray(arrayEntry) ? arrayEntry : null;
}

function extractDataGolfLiveStatsPlayers(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (Array.isArray(payload.live_stats)) {
    return payload.live_stats;
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  return null;
}

function extractDataGolfTournament(payload, fallbackTour) {
  const rawName = pickFirst(payload || {}, ["event_name", "tournament_name", "name", "event"]);
  return {
    id: fallbackTour,
    name: rawName || `${String(fallbackTour || "pga").toUpperCase()} in-play predictions`
  };
}

function extractDataGolfLiveStatsTournament(payload, fallbackTour) {
  return {
    id: fallbackTour,
    name: pickFirst(payload || {}, ["event_name", "tournament_name", "name"]) || `${String(fallbackTour || "pga").toUpperCase()} live stats`
  };
}

function normalizeDataGolfPlayer(raw) {
  const name = pickFirst(raw, ["player_name", "name", "player", "golfer"]);
  return {
    name,
    win: normalizePercentValue(pickFirst(raw, ["win", "win_pct", "win_prob", "outright"])),
    top5: normalizePercentValue(pickFirst(raw, ["top_5", "top5", "top_5_pct", "top5_pct"])),
    top10: normalizePercentValue(pickFirst(raw, ["top_10", "top10", "top_10_pct", "top10_pct"])),
    top20: normalizePercentValue(pickFirst(raw, ["top_20", "top20", "top_20_pct", "top20_pct"])),
    makeCut: normalizePercentValue(pickFirst(raw, ["make_cut", "makecut", "mc", "make_cut_pct"])),
    position: pickFirst(raw, ["position", "pos", "rank", "place"]) || "-",
    score: normalizeScoreValue(pickFirst(raw, ["score", "total", "to_par", "tot"])),
    todayScore: normalizeScoreValue(pickFirst(raw, ["today", "today_score", "round_score", "round"])),
    thru: pickFirst(raw, ["thru", "holes_completed", "holes"]) || "",
    madeCut: true,
    money: 0
  };
}

function normalizeDataGolfLiveStatsPlayer(raw) {
  return {
    name: pickFirst(raw, ["player_name", "name", "player", "golfer"]),
    position: pickFirst(raw, ["position", "pos", "rank", "place"]) || "-",
    score: normalizeScoreValue(pickFirst(raw, ["total", "score", "to_par"])),
    todayScore: normalizeScoreValue(pickFirst(raw, ["round", "today", "round_score"])),
    thru: pickFirst(raw, ["thru", "holes_completed", "holes"]) || "",
    teeTime: pickFirst(raw, ["tee_time", "teetime", "tee", "start_time", "tee_time_local"]) || "",
    money: 0,
    madeCut: true,
    sgTotal: pickFirst(raw, ["sg_total"]),
    sgT2g: pickFirst(raw, ["sg_t2g"]),
    sgOtt: pickFirst(raw, ["sg_ott"]),
    sgApp: pickFirst(raw, ["sg_app"]),
    sgArg: pickFirst(raw, ["sg_arg"]),
    sgPutt: pickFirst(raw, ["sg_putt"]),
    gir: pickFirst(raw, ["gir"]),
    accuracy: pickFirst(raw, ["accuracy"]),
    distance: pickFirst(raw, ["distance"]),
    scrambling: pickFirst(raw, ["scrambling"])
  };
}

function normalizePercentValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeScoreValue(value) {
  if (value === undefined || value === null || value === "") {
    return "E";
  }

  const stringValue = String(value).trim().toUpperCase();
  if (["E", "EVEN", "EV"].includes(stringValue)) {
    return "E";
  }

  const parsed = Number(stringValue.replace(/[^0-9+-.]/g, ""));
  if (!Number.isFinite(parsed)) {
    return "E";
  }

  return parsed > 0 ? `+${parsed}` : `${parsed}`;
}

function normalizeMoneyValue(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickFirst(source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return undefined;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizePercentDisplayValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed > 0 && parsed <= 1) {
    return parsed * 100;
  }

  return parsed;
}

function normalizeSharedGolferState(value) {
  if (!value || typeof value !== "object") {
    return {
      score: "E",
      todayScore: "E",
      position: "-",
      money: "0",
      madeCut: true
    };
  }

  return {
    score: value.score === undefined || value.score === null || value.score === "" ? "E" : String(value.score).trim(),
    todayScore: value.todayScore === undefined || value.todayScore === null || value.todayScore === "" ? "E" : String(value.todayScore).trim(),
    position: value.position === undefined || value.position === null || value.position === "" ? "-" : String(value.position).trim(),
    money: value.money === undefined || value.money === null || value.money === "" ? "0" : String(value.money).trim(),
    madeCut: value.madeCut !== false
  };
}

function recordSharedStateSnapshot(state, label = "", force = false) {
  const standings = getSharedProjectedStandings(state);
  const managers = standings.map((entry) => entry.manager);
  if (!managers.length) {
    return;
  }

  const scores = standings.reduce((accumulator, entry) => {
    accumulator[entry.manager] = entry.countingScore;
    return accumulator;
  }, {});

  const lastSnapshot = Array.isArray(state.scoreHistory) && state.scoreHistory.length
    ? state.scoreHistory[state.scoreHistory.length - 1]
    : null;

  if (!force && lastSnapshot && areSharedSnapshotsEqual(lastSnapshot.scores, scores)) {
    return;
  }

  state.scoreHistory = [...(state.scoreHistory || []), {
    timestamp: new Date().toISOString(),
    label,
    scores
  }].slice(-240);
}

function areSharedSnapshotsEqual(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && Number(left[key]) === Number(right[key]));
}

function getSharedProjectedStandings(state) {
  const managers = ((state.draftOrder || []).length ? state.draftOrder : state.managers || []).filter(Boolean);
  return managers
    .map((manager) => summarizeSharedTeam(state, manager))
    .sort(compareSharedTeams);
}

function summarizeSharedTeam(state, manager) {
  const roster = Object.keys(state.draftedGolfers || {}).filter((golfer) => state.draftedGolfers[golfer] === manager);
  if (!roster.length) {
    return {
      manager,
      rosterSize: 0,
      droppedGolfer: null,
      countingScore: 0,
      countingTodayScore: 0,
      totalMoney: 0,
      golfers: []
    };
  }

  const golferDetails = roster.map((golfer) => ({ golfer, ...getSharedGolferDisplay(state, golfer) }));
  const sortedByWorst = [...golferDetails].sort((a, b) => b.effectiveScore - a.effectiveScore);
  const dropped = golferDetails.length > 3 ? sortedByWorst[0] : null;
  const countingGolfers = dropped ? golferDetails.filter((entry) => entry.golfer !== dropped.golfer) : golferDetails;

  return {
    manager,
    rosterSize: roster.length,
    droppedGolfer: dropped ? dropped.golfer : null,
    countingScore: countingGolfers.reduce((sum, entry) => sum + entry.effectiveScore, 0),
    countingTodayScore: countingGolfers.reduce((sum, entry) => sum + normalizeSharedScore(entry.rawTodayScore), 0),
    totalMoney: golferDetails.reduce((sum, entry) => sum + entry.money, 0),
    golfers: golferDetails
  };
}

function compareSharedTeams(a, b) {
  if (a.rosterSize !== b.rosterSize) {
    return b.rosterSize - a.rosterSize;
  }
  if (a.countingScore !== b.countingScore) {
    return a.countingScore - b.countingScore;
  }
  if (a.totalMoney !== b.totalMoney) {
    return b.totalMoney - a.totalMoney;
  }
  return String(a.manager || "").localeCompare(String(b.manager || ""));
}

function getSharedGolferDisplay(state, golfer) {
  const golferState = getSharedMergedGolferState(state, golfer);
  const cutLineScore = getSharedCutLineScore(state);
  const enteredScore = normalizeSharedScore(golferState.score);
  const effectiveScore = golferState.madeCut ? enteredScore : cutLineScore;

  return {
    rawScore: golferState.score,
    rawTodayScore: golferState.todayScore,
    rawMoney: golferState.money,
    position: golferState.position,
    madeCut: golferState.madeCut,
    money: normalizeMoneyValue(golferState.money),
    enteredScore,
    effectiveScore
  };
}

function getSharedMergedGolferState(state, golfer) {
  const normalizedGolfer = normalizeText(golfer);
  const liveMatch = (state.livePlayers || []).find((player) => normalizeText(player.name) === normalizedGolfer) || null;
  const storedState = state.scores && typeof state.scores === "object" ? state.scores[golfer] || {} : {};

  return normalizeSharedGolferState({
    ...storedState,
    position: liveMatch?.position ?? storedState.position,
    score: liveMatch?.score ?? storedState.score,
    todayScore: liveMatch?.todayScore ?? storedState.todayScore,
    money: liveMatch?.money ?? storedState.money,
    madeCut: liveMatch?.madeCut ?? storedState.madeCut
  });
}

function getSharedCutLineScore(state) {
  const madeCutScores = Object.keys(state.draftedGolfers || {})
    .map((golfer) => getSharedMergedGolferState(state, golfer))
    .filter((details) => details.madeCut)
    .map((details) => normalizeSharedScore(details.score));

  if (!madeCutScores.length) {
    return 0;
  }

  return Math.max(...madeCutScores);
}

function normalizeSharedScore(rawScore) {
  if (rawScore === undefined || rawScore === null || rawScore === "") {
    return 0;
  }

  const value = String(rawScore).trim().toUpperCase();
  if (value === "E") {
    return 0;
  }

  const parsed = Number(value.replace(/[^0-9+-.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const unquoted = rawValue.replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) {
      process.env[key] = unquoted;
    }
  }
}

function initializeSharedStateDb(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT,
      updated_at TEXT,
      updated_by TEXT
    );
  `);

  migrateLegacyStateIfNeeded(db);
  return db;
}

function loadSharedStateStore(db) {
  const row = db.prepare("SELECT state_json, updated_at, updated_by FROM app_state WHERE id = 1").get();
  if (!row) {
    return emptySharedStateStore();
  }

  try {
    return {
      state: row.state_json ? JSON.parse(row.state_json) : null,
      meta: {
        updatedAt: row.updated_at || "",
        updatedBy: row.updated_by || ""
      }
    };
  } catch {
    return emptySharedStateStore();
  }
}

function saveSharedStateStore(store) {
  sharedStateDb.prepare(`
    INSERT INTO app_state (id, state_json, updated_at, updated_by)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    JSON.stringify(store.state || null),
    store.meta?.updatedAt || "",
    store.meta?.updatedBy || ""
  );
}

function migrateLegacyStateIfNeeded(db) {
  const existing = db.prepare("SELECT 1 FROM app_state WHERE id = 1").get();
  if (existing || !fs.existsSync(LEGACY_STATE_PATH)) {
    return;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(LEGACY_STATE_PATH, "utf8"));
    const migrated = {
      state: parsed?.state && typeof parsed.state === "object" ? parsed.state : null,
      meta: {
        updatedAt: parsed?.meta?.updatedAt || "",
        updatedBy: parsed?.meta?.updatedBy || ""
      }
    };
    db.prepare(`
      INSERT INTO app_state (id, state_json, updated_at, updated_by)
      VALUES (1, ?, ?, ?)
    `).run(
      JSON.stringify(migrated.state || null),
      migrated.meta.updatedAt,
      migrated.meta.updatedBy
    );
  } catch {
    // Ignore legacy migration errors and start fresh.
  }
}

function emptySharedStateStore() {
  return {
    state: null,
    meta: {
      updatedAt: "",
      updatedBy: ""
    }
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large."));
      }
    });

    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error("Request body must be valid JSON.");
        error.statusCode = 400;
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function serveStatic(pathname, response) {
  const resolvedPath = pathname;
  const filePath = path.join(ROOT, path.normalize(resolvedPath));

  if (!filePath.startsWith(ROOT)) {
    return writeJson(response, 403, { error: "Forbidden." });
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Server error");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream"
    });
    response.end(data);
  });
}

function serveIndex(response, mode) {
  const filePath = path.join(ROOT, "index.html");

  fs.readFile(filePath, "utf8", (error, html) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Server error");
      return;
    }

    const injected = html.replace(
      "</head>",
      `<script>window.APP_CONFIG=${JSON.stringify({ mode, adminRoute: config.adminRoute })};</script></head>`
    );

    const cookieValue = mode === "admin" ? "admin" : "viewer";
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": `players_mode=${cookieValue}; Path=/; SameSite=Lax`
    });
    response.end(injected);
  });
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function logServerError(error) {
  console.error("[datagolf]", error.message || "Unexpected server error.");
  if (error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
}

function parseCookies(headerValue) {
  return String(headerValue || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const equalsIndex = entry.indexOf("=");
      if (equalsIndex === -1) {
        return cookies;
      }
      const key = entry.slice(0, equalsIndex).trim();
      const value = entry.slice(equalsIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function ensureAdminRequest(request) {
  const cookies = parseCookies(request.headers.cookie);
  const headerMode = String(request.headers["x-app-mode"] || "").trim().toLowerCase();
  const cookieMode = String(cookies.players_mode || "").trim().toLowerCase();

  if (headerMode === "admin" && cookieMode === "admin") {
    return;
  }

  const error = new Error("This action is only available from the admin URL.");
  error.statusCode = 403;
  error.details = {
    adminRoute: config.adminRoute
  };
  throw error;
}

function normalizeAdminRoute(value) {
  const trimmed = String(value || "/admin").trim();
  if (!trimmed || trimmed === "/") {
    return "/admin";
  }
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") || "/admin" : `/${trimmed.replace(/\/+$/, "")}`;
}


