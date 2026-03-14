const STORAGE_KEY = "players-championship-fantasy-state";
const CLIENT_ID_KEY = "players-championship-client-id";
const MIN_MANAGERS = 2;
const PICKS_PER_MANAGER = 4;
const SHARED_STATE_POLL_MS = 4000;
const APP_CONFIG = window.APP_CONFIG || { mode: "admin", adminRoute: "/admin" };
const DEFAULT_EVENT_ID = "players-championship-pool";
const EVENT_STATE_KEYS = [
  "eventName",
  "managers",
  "draftOrder",
  "golfers",
  "draftedGolfers",
  "livePlayers",
  "dataGolfPlayers",
  "scores",
  "scoreHistory",
  "scoreChartCollapsed",
  "scoreChartSelectedIndex",
  "teamDetailsOpen",
  "draftStarted",
  "currentPick",
  "pickHistory",
  "liveSettings"
];

const defaultGolferState = () => ({
  score: "E",
  todayScore: "E",
  position: "-",
  money: "0",
  madeCut: true
});

const initialState = {
  eventName: "Players Championship Pool",
  managers: ["", "", "", ""],
  draftOrder: [],
  golfers: [],
  draftedGolfers: {},
  livePlayers: [],
  dataGolfPlayers: [],
  scores: {},
  scoreHistory: [],
  scoreChartCollapsed: false,
  scoreChartSelectedIndex: null,
  teamDetailsOpen: {},
  draftStarted: false,
  currentPick: 0,
  pickHistory: [],
  currentEventId: DEFAULT_EVENT_ID,
  eventOrder: [DEFAULT_EVENT_ID],
  eventSnapshots: {},
  activeTab: "tournament",
  liveSettings: {
    autoRefreshSeconds: 0,
    lastSyncAt: "",
    lastTournamentName: "",
    lastSyncSummary: ""
  }
};

const elements = {
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  draftTab: document.getElementById("draftTab"),
  tournamentTab: document.getElementById("tournamentTab"),
  fullLeaderboardTab: document.getElementById("fullLeaderboardTab"),
  liveTab: document.getElementById("liveTab"),
  eventSelect: document.getElementById("eventSelect"),
  newEventNameInput: document.getElementById("newEventNameInput"),
  createEventButton: document.getElementById("createEventButton"),
  settingsForm: document.getElementById("settingsForm"),
  eventName: document.getElementById("eventName"),
  managerCountPill: document.getElementById("managerCountPill"),
  managerList: document.getElementById("managerList"),
  addManagerButton: document.getElementById("addManagerButton"),
  removeManagerButton: document.getElementById("removeManagerButton"),
  playerPoolInput: document.getElementById("playerPoolInput"),
  randomizeOrderButton: document.getElementById("randomizeOrderButton"),
  startDraftButton: document.getElementById("startDraftButton"),
  draftOrderCard: document.getElementById("draftOrderCard"),
  draftStatusPill: document.getElementById("draftStatusPill"),
  availablePlayers: document.getElementById("availablePlayers"),
  teamBoard: document.getElementById("teamBoard"),
  draftedLeaderboard: document.getElementById("draftedLeaderboard"),
  draftedLeaderboardModePill: document.getElementById("draftedLeaderboardModePill"),
  leaderboard: document.getElementById("leaderboard"),
  leaderboardModePill: document.getElementById("leaderboardModePill"),
  scoreChart: document.getElementById("scoreChart"),
  toggleScoreChartButton: document.getElementById("toggleScoreChartButton"),
  teamCardTemplate: document.getElementById("teamCardTemplate"),
  availableGolferOptions: document.getElementById("availableGolferOptions"),
  turnCard: document.getElementById("turnCard"),
  playerSearchInput: document.getElementById("playerSearchInput"),
  resetAppButton: document.getElementById("resetAppButton"),
  autoRefreshSelect: document.getElementById("autoRefreshSelect"),
  syncDataGolfButton: document.getElementById("syncDataGolfButton"),
  loadFieldButton: document.getElementById("loadFieldButton"),
  csvFileInput: document.getElementById("csvFileInput"),
  importCsvButton: document.getElementById("importCsvButton"),
  downloadCsvTemplateButton: document.getElementById("downloadCsvTemplateButton"),
  csvTextInput: document.getElementById("csvTextInput"),
  csvLoadFieldToggle: document.getElementById("csvLoadFieldToggle"),
  importCsvTextButton: document.getElementById("importCsvTextButton"),
  liveStatusCard: document.getElementById("liveStatusCard")
};

let state = loadState();
let liveStatus = {
  available: false,
  configured: false,
  provider: "Data Golf",
  error: "",
  details: null
};
let autoRefreshHandle = null;
let fieldLoadInFlight = false;
let sharedStateAvailable = false;
let sharedStateMeta = {
  updatedAt: "",
  updatedBy: ""
};
let sharedStatePollHandle = null;
let sharedSaveHandle = null;
let isApplyingRemoteState = false;
let readOnlyNoticeTimeout = null;
const clientId = loadClientId();

bindEvents();
syncFormFromState();
setupAutoRefresh();
render();
initializeApp();

function bindEvents() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });
  elements.settingsForm.addEventListener("submit", handleStartDraft);
  elements.randomizeOrderButton.addEventListener("click", handleRandomizeOrder);
  elements.playerSearchInput.addEventListener("input", renderAvailablePlayers);
  elements.resetAppButton.addEventListener("click", resetState);
  elements.addManagerButton.addEventListener("click", addManager);
  elements.removeManagerButton.addEventListener("click", removeManager);
  elements.syncDataGolfButton.addEventListener("click", syncLiveData);
  elements.loadFieldButton.addEventListener("click", loadTournamentField);
  elements.importCsvButton.addEventListener("click", importCsvLeaderboard);
  elements.downloadCsvTemplateButton.addEventListener("click", downloadCsvTemplate);
  elements.importCsvTextButton.addEventListener("click", importPastedCsvLeaderboard);
  elements.eventName.addEventListener("input", handleFormChange);
  elements.playerPoolInput.addEventListener("input", handleFormChange);
  elements.autoRefreshSelect.addEventListener("change", handleLiveSettingsChange);
  elements.toggleScoreChartButton.addEventListener("click", toggleScoreChart);
  elements.eventSelect?.addEventListener("change", handleEventSelectionChange);
  elements.createEventButton?.addEventListener("click", handleCreateEvent);
}

async function initializeApp() {
  document.body.dataset.appMode = isAdminMode() ? "admin" : "viewer";
  applyAccessMode();
  await hydrateFromSharedState();
  await checkLiveStatus();
}

function isAdminMode() {
  return APP_CONFIG.mode === "admin";
}

function applyAccessMode() {
  elements.tabButtons.forEach((button) => {
    if (["draft", "live"].includes(button.dataset.tab)) {
      button.hidden = !isAdminMode();
    }
  });
  if (elements.eventSelect) {
    elements.eventSelect.disabled = !isAdminMode();
  }
  if (elements.newEventNameInput) {
    elements.newEventNameInput.disabled = !isAdminMode();
  }
  if (elements.createEventButton) {
    elements.createEventButton.disabled = !isAdminMode();
  }
}

function buildRequestHeaders(extraHeaders = {}) {
  return {
    ...extraHeaders,
    "X-App-Mode": isAdminMode() ? "admin" : "viewer"
  };
}

function handleReadOnlyAction() {
  const message = `This page is view-only. Use ${APP_CONFIG.adminRoute} to make edits.`;
  state.liveSettings.lastSyncSummary = message;
  renderLiveStatus();
  if (readOnlyNoticeTimeout) {
    window.clearTimeout(readOnlyNoticeTimeout);
  }
  readOnlyNoticeTimeout = window.setTimeout(() => {
    if (state.liveSettings.lastSyncSummary === message) {
      state.liveSettings.lastSyncSummary = "";
      renderLiveStatus();
    }
  }, 4000);
  console.info(message);
}

function handleFormChange() {
  if (!isAdminMode()) {
    return;
  }
  state.eventName = elements.eventName.value.trim() || initialState.eventName;
  state.managers = getManagerInputs().map((input) => input.value.trim());
  state.golfers = parseGolfers(elements.playerPoolInput.value);

  if (!state.draftStarted) {
    persist();
    renderStaticViews();
  }
}

function handleLiveSettingsChange() {
  if (!isAdminMode()) {
    return;
  }
  state.liveSettings.autoRefreshSeconds = Number(elements.autoRefreshSelect.value) || 0;
  persist();
  setupAutoRefresh();
  renderLiveStatus();
}

function handleRandomizeOrder() {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  const managers = getManagerInputs().map((input) => input.value.trim()).filter(Boolean);

  if (managers.length !== currentManagerCount()) {
    window.alert("Fill in every manager name before randomizing the draft order.");
    return;
  }

  state.managers = managers;
  state.draftOrder = shuffle([...managers]);
  persist();
  render();
}

function handleStartDraft(event) {
  event.preventDefault();
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }

  const managers = getManagerInputs().map((input) => input.value.trim());
  const golfers = parseGolfers(elements.playerPoolInput.value);

  if (managers.some((name) => !name)) {
    window.alert("Add every manager name to start the draft.");
    return;
  }

  if (golfers.length < totalPicksNeeded()) {
    window.alert(`Add at least ${totalPicksNeeded()} golfers so everyone can draft ${PICKS_PER_MANAGER}.`);
    return;
  }

  state.eventName = elements.eventName.value.trim() || initialState.eventName;
  state.managers = managers;
  state.golfers = golfers;
  state.draftOrder = state.draftOrder.length === currentManagerCount() ? state.draftOrder : shuffle([...managers]);
  state.draftedGolfers = {};
  state.scores = {};
  state.pickHistory = [];
  state.currentPick = 0;
  state.draftStarted = true;

  if (Array.isArray(state.scoreHistory) && state.scoreHistory.length) {
    const shouldClearHistory = window.confirm("Clear the existing team score graph history for this new draft?");
    if (shouldClearHistory) {
      state.scoreHistory = [];
    }
  } else {
    state.scoreHistory = [];
  }

  recordScoreSnapshot("Draft started", true);

  persist();
  render();
}

function resetState() {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  const confirmed = window.confirm("Reset the event, clear drafted teams, and remove saved scores?");
  if (!confirmed) {
    return;
  }

  replaceCurrentEvent(buildFreshEventSnapshot(state.eventName || initialState.eventName));
  syncFormFromState();
  setupAutoRefresh();
  persist();
  render();
}

function syncFormFromState() {
  elements.eventName.value = state.eventName || initialState.eventName;
  elements.playerPoolInput.value = state.golfers.join("\n");
  renderManagerInputs();
  elements.autoRefreshSelect.value = String(state.liveSettings.autoRefreshSeconds || 0);
  renderEventSelector();
}

function render() {
  renderStaticViews();
  renderManagerInputs();
  renderTabs();
}

function renderStaticViews() {
  document.title = `${state.eventName} | Fantasy Golf Draft`;
  renderEventSelector();
  renderDraftOrder();
  renderTurnCard();
  renderAvailablePlayers();
  renderAvailableGolferOptions();
  renderTeams();
  renderLeaderboard();
  renderScoreChart();
  renderStatus();
  renderLiveStatus();
}

function toggleScoreChart() {
  state.scoreChartCollapsed = !state.scoreChartCollapsed;
  persist();
  renderScoreChart();
}

function renderTabs() {
  const activeTab = state.activeTab || "tournament";
  const safeTab = !isAdminMode() && ["draft", "live"].includes(activeTab) ? "tournament" : activeTab;
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === safeTab);
  });
  elements.draftTab.classList.toggle("is-active", safeTab === "draft");
  elements.tournamentTab.classList.toggle("is-active", safeTab === "tournament");
  elements.fullLeaderboardTab.classList.toggle("is-active", safeTab === "fullLeaderboard");
  elements.liveTab.classList.toggle("is-active", safeTab === "live");
}

function setActiveTab(tabName) {
  const allowedTabs = isAdminMode()
    ? ["draft", "tournament", "fullLeaderboard", "live"]
    : ["tournament", "fullLeaderboard"];
  state.activeTab = allowedTabs.includes(tabName) ? tabName : "tournament";
  persist();
  render();
}

function renderEventSelector() {
  if (!elements.eventSelect) {
    return;
  }

  const order = Array.isArray(state.eventOrder) && state.eventOrder.length
    ? state.eventOrder
    : [state.currentEventId || DEFAULT_EVENT_ID];

  elements.eventSelect.innerHTML = order
    .map((eventId) => {
      const snapshot = state.eventSnapshots?.[eventId];
      const label = snapshot?.eventName || prettifyEventId(eventId);
      return `<option value="${escapeAttribute(eventId)}"${eventId === state.currentEventId ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function handleEventSelectionChange() {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }

  const nextEventId = elements.eventSelect?.value;
  if (!nextEventId || nextEventId === state.currentEventId) {
    return;
  }

  syncCurrentEventSnapshot(state);
  state.currentEventId = nextEventId;
  replaceCurrentEvent(getEventSnapshot(nextEventId));
  syncFormFromState();
  setupAutoRefresh();
  persist();
  render();
}

function handleCreateEvent() {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }

  const name = String(elements.newEventNameInput?.value || "").trim();
  if (!name) {
    window.alert("Add an event name first.");
    return;
  }

  syncCurrentEventSnapshot(state);
  const nextEventId = createEventId(name, state.eventOrder || []);
  state.currentEventId = nextEventId;
  state.eventOrder = [...(state.eventOrder || []), nextEventId];
  state.eventSnapshots = {
    ...(state.eventSnapshots || {}),
    [nextEventId]: buildFreshEventSnapshot(name)
  };
  replaceCurrentEvent(getEventSnapshot(nextEventId));
  if (elements.newEventNameInput) {
    elements.newEventNameInput.value = "";
  }
  syncFormFromState();
  setupAutoRefresh();
  persist();
  render();
}

function renderManagerInputs() {
  elements.managerList.innerHTML = state.managers
    .map((manager, index) => `
      <label>
        Manager ${index + 1}
        <input class="manager-input" data-index="${index}" type="text" maxlength="40" placeholder="Manager ${index + 1}" value="${escapeAttribute(manager || "")}" required />
      </label>
    `)
    .join("");

  getManagerInputs().forEach((input) => {
    input.addEventListener("input", handleFormChange);
  });

  elements.managerCountPill.textContent = `${currentManagerCount()} managers`;
  elements.removeManagerButton.disabled = currentManagerCount() <= MIN_MANAGERS;
}

function getManagerInputs() {
  return Array.from(document.querySelectorAll(".manager-input"));
}

function addManager() {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  if (state.draftStarted) {
    window.alert("Reset the event before changing the number of managers.");
    return;
  }

  state.managers.push("");
  persist();
  render();
}

function removeManager() {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  if (state.draftStarted) {
    window.alert("Reset the event before changing the number of managers.");
    return;
  }

  if (currentManagerCount() <= MIN_MANAGERS) {
    return;
  }

  state.managers = state.managers.slice(0, -1);
  state.draftOrder = state.draftOrder.filter((manager) => state.managers.includes(manager));
  persist();
  render();
}

function currentManagerCount() {
  return state.managers.length;
}

function totalPicksNeeded() {
  return currentManagerCount() * PICKS_PER_MANAGER;
}

function renderDraftOrder() {
  if (!state.draftOrder.length) {
    elements.draftOrderCard.className = "draft-order-card empty-state";
    elements.draftOrderCard.textContent = "Randomize the names and start the draft to build the board.";
    return;
  }

  const roundOne = state.draftOrder;
  const roundTwo = [...state.draftOrder].reverse();
  const roundThree = state.draftOrder;
  const roundFour = [...state.draftOrder].reverse();

  elements.draftOrderCard.className = "draft-order-card";
  elements.draftOrderCard.innerHTML = [
    `<strong>${escapeHtml(state.eventName)}</strong>`,
    ...roundOne.map((manager, index) => `
      <div class="order-row">
        <span>Pick ${index + 1}</span>
        <strong>${escapeHtml(manager)}</strong>
      </div>
    `),
    `<div class="order-row"><span>Rounds 2-4</span><strong>${escapeHtml(roundTwo.join(" -> "))} | ${escapeHtml(roundThree.join(" -> "))} | ${escapeHtml(roundFour.join(" -> "))}</strong></div>`
  ].join("");
}

function renderTurnCard() {
  if (!state.draftStarted || isDraftComplete()) {
    elements.turnCard.classList.add("hidden");
    elements.turnCard.innerHTML = "";
    return;
  }

  const manager = managerForPick(state.currentPick);
  const direction = draftDirectionForPick(state.currentPick);
  const round = Math.floor(state.currentPick / currentManagerCount()) + 1;
  const teamSize = golfersForManager(manager).length;

  elements.turnCard.classList.remove("hidden");
  elements.turnCard.innerHTML = `
    <p class="panel-kicker">On the clock</p>
    <h3>${escapeHtml(manager)}</h3>
    <p>Round ${round} of ${PICKS_PER_MANAGER} • ${direction === "forward" ? "Forward order" : "Snake reverse"}</p>
    <p>${teamSize} of ${PICKS_PER_MANAGER} golfers drafted</p>
  `;
}

function renderAvailablePlayers() {
  const available = remainingGolfers();
  const query = elements.playerSearchInput.value.trim().toLowerCase();
  const filtered = available.filter((golfer) => golfer.toLowerCase().includes(query));

  if (!state.draftStarted) {
    elements.availablePlayers.className = "player-pool empty-state";
    elements.availablePlayers.textContent = "Add golfers and start the draft to pick teams.";
    return;
  }

  if (isDraftComplete()) {
    elements.availablePlayers.className = "player-pool empty-state";
    elements.availablePlayers.textContent = `Draft complete. Each manager has ${PICKS_PER_MANAGER} golfers.`;
    return;
  }

  if (!filtered.length) {
    elements.availablePlayers.className = "player-pool empty-state";
    elements.availablePlayers.textContent = available.length ? "No golfers match that search." : "All needed golfers have been drafted.";
    return;
  }

  const nextManager = managerForPick(state.currentPick);
  elements.availablePlayers.className = "player-pool";
  elements.availablePlayers.innerHTML = filtered
    .map((golfer) => `
      <article class="player-pill">
        <div>
          <h3>${escapeHtml(golfer)}</h3>
          <p class="player-meta">Available for selection</p>
        </div>
        <button data-golfer="${escapeAttribute(golfer)}">Draft to ${escapeHtml(nextManager)}</button>
      </article>
    `)
    .join("");

  elements.availablePlayers.querySelectorAll("button[data-golfer]").forEach((button) => {
    button.addEventListener("click", () => draftGolfer(button.dataset.golfer));
  });
}

function renderLiveStatus() {
  const settings = state.liveSettings;
  const statusLines = [];

  if (!liveStatus.available) {
    elements.liveStatusCard.className = "empty-state";
    elements.liveStatusCard.textContent = "Live sync server is not reachable. Open the app through the local Node server to enable Data Golf integration.";
    return;
  }

  if (!liveStatus.configured) {
    elements.liveStatusCard.className = "empty-state";
    elements.liveStatusCard.textContent = "Server is running, but DATAGOLF_API_KEY is missing. Add it to .env and restart the server.";
    return;
  }

  statusLines.push(state.livePlayers.length && settings.lastSyncSummary.startsWith("Imported") ? "CSV leaderboard loaded." : "Data Golf connected.");

  if (settings.lastTournamentName) {
    statusLines.push(`Selected tournament: ${escapeHtml(settings.lastTournamentName)}`);
  }

  if (settings.lastSyncAt) {
    statusLines.push(`Last sync: ${escapeHtml(new Date(settings.lastSyncAt).toLocaleString())}`);
  }

  if (settings.lastSyncSummary) {
    statusLines.push(escapeHtml(settings.lastSyncSummary));
  }

  if (liveStatus.error) {
    statusLines.push(`Status error: ${escapeHtml(liveStatus.error)}`);
  }

  if (liveStatus.details) {
    statusLines.push(renderDebugDetails(liveStatus.details));
  }

  elements.liveStatusCard.className = "projection-summary";
  elements.liveStatusCard.innerHTML = `<div class="stack-form">${statusLines.map((line) => `<p>${line}</p>`).join("")}</div>`;
}

function draftGolfer(golfer) {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  if (!state.draftStarted || isDraftComplete()) {
    return;
  }

  const manager = managerForPick(state.currentPick);
  if (golfersForManager(manager).length >= PICKS_PER_MANAGER) {
    return;
  }

  state.draftedGolfers[golfer] = manager;
  state.pickHistory.push({ pick: state.currentPick + 1, golfer, manager });
  state.currentPick += 1;
  state.scores[golfer] = normalizeGolferState(state.scores[golfer]);

  persist();
  render();
}

function renderTeams() {
  elements.teamBoard.innerHTML = "";

  if (!state.managers.filter(Boolean).length) {
    elements.teamBoard.innerHTML = `<div class="empty-state">Add manager names to create the team board.</div>`;
    return;
  }

  const standings = getProjectedStandings();
  const standingsMap = new Map(standings.map((entry) => [entry.manager, entry]));
  const draftSlotMap = new Map((state.draftOrder.length ? state.draftOrder : state.managers.filter(Boolean)).map((manager, index) => [manager, index + 1]));
  const boardOrder = standings.length ? standings.map((entry) => entry.manager) : state.managers.filter(Boolean);
  const performanceBuckets = getDailyPerformanceBuckets();

  boardOrder.forEach((manager, index) => {
    const teamCard = elements.teamCardTemplate.content.firstElementChild.cloneNode(true);
    const roster = golfersForManager(manager);
    const summary = standingsMap.get(manager) || emptyTeamSummary(manager);
    const draftSlot = draftSlotMap.get(manager);
    const teamInput = teamCard.querySelector(".team-player-input");
    const teamButton = teamCard.querySelector(".team-player-button");
    const teamToggleButton = teamCard.querySelector(".team-toggle-button");
    const teamBody = teamCard.querySelector(".team-card-body");
    const teamAssign = teamCard.querySelector(".team-assign");
    const teamFull = roster.length >= PICKS_PER_MANAGER;
    const isOpen = isTeamDetailsOpen(manager, index);

    teamCard.querySelector(".team-order").textContent = `${formatStanding(index + 1)} place${draftSlot ? ` • Draft slot ${draftSlot}` : ""}`;
    teamCard.querySelector(".team-name").textContent = manager;
    teamCard.querySelector(".team-total").textContent = formatScore(summary.countingScore);
    teamCard.querySelector(".team-today").textContent = `Today ${formatScore(summary.countingTodayScore)}`;
    teamCard.classList.toggle("is-collapsed", !isOpen);
    teamBody.classList.toggle("is-collapsed", !isOpen);
    teamBody.hidden = !isOpen;
    teamToggleButton.textContent = isOpen ? "Hide details" : "Show details";

    teamInput.dataset.manager = manager;
    teamInput.disabled = teamFull;
    teamButton.dataset.manager = manager;
    teamButton.disabled = teamFull;
    teamToggleButton.dataset.manager = manager;
    teamAssign.hidden = teamFull || !isAdminMode();
    teamAssign.classList.toggle("hidden", teamFull || !isAdminMode());

    if (teamFull) {
      teamInput.value = "";
    }

    const rosterList = teamCard.querySelector(".roster-list");

    if (!roster.length) {
      rosterList.innerHTML = `<li><span class="roster-meta">No golfers drafted yet.</span></li>`;
    } else {
      rosterList.innerHTML = roster
        .map((golfer) => renderRosterLine(golfer, summary.droppedGolfer, performanceBuckets))
        .join("");
    }

    elements.teamBoard.appendChild(teamCard);

    teamToggleButton.addEventListener("click", () => toggleTeamDetails(manager, index));
    teamButton.addEventListener("click", () => handleTeamAssign(teamInput.dataset.manager, teamInput));
    teamInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleTeamAssign(teamInput.dataset.manager, teamInput);
      }
    });
  });
}

function isTeamDetailsOpen(manager, index) {
  if (state.teamDetailsOpen && Object.prototype.hasOwnProperty.call(state.teamDetailsOpen, manager)) {
    return state.teamDetailsOpen[manager];
  }

  return index === 0;
}

function toggleTeamDetails(manager, index) {
  state.teamDetailsOpen = {
    ...(state.teamDetailsOpen || {}),
    [manager]: !isTeamDetailsOpen(manager, index)
  };
  persist();
  renderTeams();
}

function renderRosterLine(golfer, droppedGolfer, performanceBuckets = getDailyPerformanceBuckets()) {
  const details = getGolferDisplay(golfer);
  const livePlayer = findLivePlayer(golfer);
  const dgPlayer = getDataGolfPlayer(golfer);
  const statusTag = golfer === droppedGolfer ? "Dropped" : (details.madeCut ? "Counting" : "Missed cut");
  const statusClass = normalizeName(statusTag).replaceAll(" ", "-");
  const performanceEmoji = getDailyPerformanceEmoji(golfer, performanceBuckets);
  const thruLabel = formatThruDisplay(livePlayer) || "-";
  const todayDisplay = formatScore(details.effectiveTodayScore);
  const winLabel = dgPlayer?.win !== null && dgPlayer?.win !== undefined ? formatPercent(dgPlayer.win) : "--";
  const cutLabel = dgPlayer?.makeCut !== null && dgPlayer?.makeCut !== undefined ? formatPercent(dgPlayer.makeCut) : "--";
  const winStyle = dgPlayer?.win !== null && dgPlayer?.win !== undefined
    ? ` style="${escapeAttribute(buildProbabilityStyle(dgPlayer.win, getProbabilityRange(state.dataGolfPlayers, "win")))}"`
    : "";
  const cutStyle = dgPlayer?.makeCut !== null && dgPlayer?.makeCut !== undefined
    ? ` style="${escapeAttribute(buildProbabilityStyle(dgPlayer.makeCut, getProbabilityRange(state.dataGolfPlayers, "makeCut")))}"`
    : "";

  return `
    <li>
      <div class="roster-line roster-table-row">
        <div class="roster-player-cell">
          <strong class="roster-player-name roster-player-name-${escapeAttribute(statusClass)}">${escapeHtml(performanceEmoji ? `${performanceEmoji} ${golfer}` : golfer)}</strong>
        </div>
        <span class="roster-cell">${escapeHtml(details.position)}</span>
        <span class="roster-cell">${escapeHtml(formatScore(details.effectiveScore))}</span>
        <span class="roster-cell">${escapeHtml(thruLabel)}</span>
        <span class="roster-cell">${escapeHtml(todayDisplay)}</span>
        <span class="roster-cell roster-probability"${winStyle}>${escapeHtml(winLabel)}</span>
        <span class="roster-cell roster-probability"${cutStyle}>${escapeHtml(cutLabel)}</span>
        <span class="roster-tag roster-tag-${escapeAttribute(statusClass)}">${escapeHtml(statusTag)}</span>
      </div>
    </li>
  `;
}

function getDataGolfPlayer(golfer) {
  const normalizedGolfer = normalizeName(golfer);
  return state.dataGolfPlayers.find((player) => normalizeName(player.name) === normalizedGolfer) || null;
}

function renderLeaderboard() {
  renderDraftedLeaderboard();

  if (state.livePlayers.length) {
    renderLiveLeaderboard();
    return;
  }

  const draftedGolfers = Object.keys(state.draftedGolfers);
  elements.leaderboardModePill.textContent = "Manual updates";

  if (!draftedGolfers.length) {
    elements.leaderboard.className = "leaderboard empty-state";
    elements.leaderboard.textContent = "Draft golfers first, then update each golfer's position, score, round today, and cut status.";
    return;
  }

  const sorted = draftedGolfers.sort((a, b) => getGolferDisplay(a).effectiveScore - getGolferDisplay(b).effectiveScore);

  elements.leaderboard.className = "leaderboard";
  elements.leaderboard.innerHTML = sorted
    .map((golfer) => {
      const owner = state.draftedGolfers[golfer];
      const details = getGolferDisplay(golfer);
      return `
        <article class="score-row">
          <div>
            <h3>${escapeHtml(golfer)}</h3>
            <p class="score-meta">Rostered by ${escapeHtml(owner)}</p>
          </div>
          <div class="score-grid">
            <label>
              Position
              <input class="small-input" data-field="position" data-golfer="${escapeAttribute(golfer)}" type="text" value="${escapeAttribute(details.position)}" placeholder="T6" />
            </label>
            <label>
              Score to par
              <input class="small-input" data-field="score" data-golfer="${escapeAttribute(golfer)}" type="text" value="${escapeAttribute(details.rawScore)}" placeholder="-7" />
            </label>
            <label>
              Round today
              <input class="small-input" data-field="todayScore" data-golfer="${escapeAttribute(golfer)}" type="text" value="${escapeAttribute(details.rawTodayScore)}" placeholder="-2" />
            </label>
          </div>
          <label class="cut-toggle">
            <input data-field="madeCut" data-golfer="${escapeAttribute(golfer)}" type="checkbox" ${details.madeCut ? "checked" : ""} />
            Made the cut
          </label>
        </article>
      `;
    })
    .join("");

  elements.leaderboard.querySelectorAll("input[data-golfer]").forEach((input) => {
    const eventName = input.type === "checkbox" ? "change" : "input";
    input.addEventListener(eventName, handleScoreChange);
    if (input.type !== "checkbox") {
      input.addEventListener("blur", handleScoreChange);
    }
  });
}

function renderDraftedLeaderboard() {
  const draftedGolfers = Object.keys(state.draftedGolfers);

  if (state.livePlayers.length) {
    renderDraftedLiveLeaderboard();
    return;
  }

  elements.draftedLeaderboardModePill.textContent = "Manual updates";

  if (!draftedGolfers.length) {
    elements.draftedLeaderboard.className = "leaderboard empty-state";
    elements.draftedLeaderboard.textContent = "Drafted golfers will appear here.";
    return;
  }

  const sorted = draftedGolfers.sort((a, b) => getGolferDisplay(a).effectiveScore - getGolferDisplay(b).effectiveScore);

  elements.draftedLeaderboard.className = "leaderboard drafted-leaderboard";
  elements.draftedLeaderboard.innerHTML = [
    renderDraftedLeaderboardHeader(false),
    ...sorted
    .map((golfer) => {
      const owner = state.draftedGolfers[golfer];
      const details = getGolferDisplay(golfer);
      const todayDisplay = details.madeCut ? formatScore(normalizeScore(details.rawTodayScore)) : "-";
      return `
        <article class="score-row drafted-score-row">
          <div class="drafted-inline-row">
            <strong class="drafted-player-name">${escapeHtml(golfer)}</strong>
            <span class="score-meta drafted-player-meta">${escapeHtml(owner)}</span>
            <span class="score-display live-stat-value">${escapeHtml(details.position)}</span>
            <span class="score-display live-stat-value">${escapeHtml(formatScore(details.effectiveScore))}</span>
            <span class="score-display live-stat-value">--</span>
            <span class="score-display live-stat-value">${escapeHtml(todayDisplay)}</span>
            <span class="score-display live-stat-value">--</span>
            <span class="score-display live-stat-value">--</span>
          </div>
        </article>
      `;
    })
  ].join("");
}

function renderDraftedLiveLeaderboard() {
  const draftedNames = new Set(Object.keys(state.draftedGolfers).map((name) => normalizeName(name)));
  const dgMap = new Map(state.dataGolfPlayers.map((player) => [normalizeName(player.name), player]));
  const winRange = getProbabilityRange(state.dataGolfPlayers, "win");
  const cutRange = getProbabilityRange(state.dataGolfPlayers, "makeCut");
  const performanceBuckets = getDailyPerformanceBuckets();
  const draftedPlayers = state.livePlayers
    .filter((player) => draftedNames.has(normalizeName(player.name)))
    .sort(compareLivePlayers);

  elements.draftedLeaderboardModePill.textContent = state.dataGolfPlayers.length ? "Live + Data Golf" : "Live sync";

  if (!draftedPlayers.length) {
    elements.draftedLeaderboard.className = "leaderboard empty-state";
    elements.draftedLeaderboard.textContent = "Drafted golfers will appear here after the draft starts.";
    return;
  }

  elements.draftedLeaderboard.className = "leaderboard drafted-leaderboard";
  elements.draftedLeaderboard.innerHTML = [
    renderDraftedLeaderboardHeader(true),
    ...draftedPlayers
    .map((player) => {
      const owner = state.draftedGolfers[player.name];
      const dgPlayer = dgMap.get(normalizeName(player.name));
      const todayDisplay = player.madeCut === false ? "-" : formatScore(normalizeScore(player.todayScore));
      const performanceEmoji = getDailyPerformanceEmoji(player.name, performanceBuckets);
      const winLabel = dgPlayer?.win !== null && dgPlayer?.win !== undefined ? formatPercent(dgPlayer.win) : "--";
      const cutProbLabel = dgPlayer?.makeCut !== null && dgPlayer?.makeCut !== undefined ? formatPercent(dgPlayer.makeCut) : "--";
      const winStyle = dgPlayer?.win !== null && dgPlayer?.win !== undefined ? ` style="${escapeAttribute(buildProbabilityStyle(dgPlayer.win, winRange))}"` : "";
      const cutStyle = dgPlayer?.makeCut !== null && dgPlayer?.makeCut !== undefined ? ` style="${escapeAttribute(buildProbabilityStyle(dgPlayer.makeCut, cutRange))}"` : "";

      return `
        <article class="score-row live-score-row drafted-score-row is-drafted">
          <div class="drafted-inline-row">
            <strong class="drafted-player-name">${escapeHtml(performanceEmoji ? `${performanceEmoji} ${player.name}` : player.name)}</strong>
            <span class="score-meta drafted-player-meta">${escapeHtml(owner)}</span>
            <span class="score-display live-stat-value">${escapeHtml(player.position || "-")}</span>
            <span class="score-display live-stat-value">${escapeHtml(formatScore(normalizeScore(player.score)))}</span>
            <span class="score-display live-stat-value">${escapeHtml(player.thru || "-")}</span>
            <span class="score-display live-stat-value">${escapeHtml(todayDisplay)}</span>
            <span class="score-display live-stat-value"${winStyle}>${escapeHtml(winLabel)}</span>
            <span class="score-display live-stat-value"${cutStyle}>${escapeHtml(cutProbLabel)}</span>
          </div>
        </article>
      `;
    })
  ].join("");
}

function renderDraftedLeaderboardHeader(includeProbabilities) {
  return `
    <div class="drafted-header-row">
      <span>Player</span>
      <span>Manager</span>
      <span>Pos</span>
      <span>Total</span>
      <span>Thru</span>
      <span>Today</span>
      <span>${includeProbabilities ? "Win" : "-"}</span>
      <span>${includeProbabilities ? "MC" : "-"}</span>
    </div>
  `;
}

function renderLiveLeaderboard() {
  const sorted = [...state.livePlayers].sort(compareLivePlayers);
  elements.leaderboardModePill.textContent = state.dataGolfPlayers.length ? "Live + Data Golf" : "Live sync";
  const dgMap = new Map(state.dataGolfPlayers.map((player) => [normalizeName(player.name), player]));
  const winRange = getProbabilityRange(state.dataGolfPlayers, "win");
  const cutRange = getProbabilityRange(state.dataGolfPlayers, "makeCut");
  const performanceBuckets = getDailyPerformanceBuckets();

  if (!sorted.length) {
    elements.leaderboard.className = "leaderboard empty-state";
    elements.leaderboard.textContent = "No live leaderboard data is available yet.";
    return;
  }

  elements.leaderboard.className = "leaderboard leaderboard-dashboard";
  elements.leaderboard.innerHTML = [
    `<div class="leaderboard-dashboard-header">
      <span>Player</span>
      <span>Pos</span>
      <span>Total</span>
      <span>Thru</span>
      <span>Today</span>
      <span>Win</span>
      <span>Top 5</span>
      <span>Top 10</span>
      <span>SG Tot</span>
      <span>OTT</span>
      <span>APP</span>
      <span>ARG</span>
      <span>PUTT</span>
      <span>T2G</span>
      <span>GIR</span>
      <span>Acc</span>
      <span>Scr</span>
    </div>`,
    ...sorted
    .map((player) => {
        const owner = state.draftedGolfers[player.name];
        const performanceEmoji = getDailyPerformanceEmoji(player.name, performanceBuckets);
        const thruLabel = formatThruDisplay(player);
        const dgPlayer = dgMap.get(normalizeName(player.name));
        const winLabel = dgPlayer?.win !== null && dgPlayer?.win !== undefined ? formatPercent(dgPlayer.win) : "--";
        const winStyle = dgPlayer?.win !== null && dgPlayer?.win !== undefined ? ` style="${escapeAttribute(buildProbabilityStyle(dgPlayer.win, winRange))}"` : "";
        const todayLabel = player.madeCut === false ? "-" : formatScore(normalizeScore(player.todayScore));
        const thruDisplay = player.madeCut === false ? "Missed cut" : (thruLabel || "-");

        return `
          <article class="leaderboard-dashboard-row${owner ? " is-drafted" : ""}">
            <span class="dashboard-player-cell">
              <strong>${escapeHtml(performanceEmoji ? `${performanceEmoji} ${player.name}` : player.name)}</strong>
              <small>${escapeHtml(owner || "Not drafted")}</small>
            </span>
            <span>${escapeHtml(player.position || "-")}</span>
            <span>${escapeHtml(formatScore(normalizeScore(player.score)))}</span>
            <span>${escapeHtml(thruDisplay)}</span>
            <span>${escapeHtml(todayLabel)}</span>
            <span class="dashboard-probability"${winStyle}>${escapeHtml(winLabel)}</span>
            <span>${escapeHtml(formatDashboardMetric(dgPlayer?.top5, true))}</span>
            <span>${escapeHtml(formatDashboardMetric(dgPlayer?.top10, true))}</span>
            <span>${escapeHtml(formatDashboardMetric(player.sgTotal))}</span>
            <span>${escapeHtml(formatDashboardMetric(player.sgOtt))}</span>
            <span>${escapeHtml(formatDashboardMetric(player.sgApp))}</span>
            <span>${escapeHtml(formatDashboardMetric(player.sgArg))}</span>
            <span>${escapeHtml(formatDashboardMetric(player.sgPutt))}</span>
            <span>${escapeHtml(formatDashboardMetric(player.sgT2g))}</span>
            <span>${escapeHtml(formatDashboardMetric(player.gir, true))}</span>
            <span>${escapeHtml(formatDashboardMetric(player.accuracy, true))}</span>
            <span>${escapeHtml(formatDashboardMetric(player.scrambling, true))}</span>
          </article>
        `;
      })
  ].join("");
}

function formatDashboardMetric(value, isPercent = false) {
  if (value === undefined || value === null || value === "") {
    return "--";
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return String(value);
  }

  if (isPercent) {
    return formatPercent(parsed);
  }

  return parsed > 0 ? `+${parsed.toFixed(2)}` : parsed.toFixed(2);
}

function formatThruDisplay(player) {
  const thru = String(player?.thru || "").trim();
  if (thru && thru !== "-" && thru !== "0" && thru.toUpperCase() !== "NOT STARTED") {
    return thru;
  }

  return "";
}

function getDailyPerformanceBuckets() {
  const startedPlayers = state.livePlayers
    .filter((player) => player.madeCut !== false && hasStartedRound(player))
    .map((player) => ({
      name: player.name,
      today: normalizeScore(player.todayScore)
    }));

  if (!startedPlayers.length) {
    return {
      hot: new Set(),
      cold: new Set()
    };
  }

  const bucketSize = Math.max(1, Math.ceil(startedPlayers.length * 0.1));
  const sortedByToday = [...startedPlayers].sort((a, b) => {
    if (a.today !== b.today) {
      return a.today - b.today;
    }
    return a.name.localeCompare(b.name);
  });

  const hot = new Set(sortedByToday.slice(0, bucketSize).map((player) => normalizeName(player.name)));
  const cold = new Set(sortedByToday.slice(-bucketSize).map((player) => normalizeName(player.name)));

  hot.forEach((name) => {
    if (cold.has(name)) {
      hot.delete(name);
      cold.delete(name);
    }
  });

  return { hot, cold };
}

function hasStartedRound(player) {
  const thru = String(player?.thru || "").trim().toUpperCase();
  return Boolean(thru && thru !== "-" && thru !== "0" && thru !== "NOT STARTED");
}

function getDailyPerformanceEmoji(golfer, buckets = getDailyPerformanceBuckets()) {
  const normalized = normalizeName(golfer);
  if (buckets.hot.has(normalized)) {
    return "🔥";
  }
  if (buckets.cold.has(normalized)) {
    return "🧊";
  }
  return "";
}

function renderScoreChart() {
  elements.toggleScoreChartButton.textContent = state.scoreChartCollapsed ? "Show graph" : "Hide graph";

  if (state.scoreChartCollapsed) {
    elements.scoreChart.className = "score-chart hidden";
    elements.scoreChart.innerHTML = "";
    return;
  }

  const managers = (state.draftOrder.length ? state.draftOrder : state.managers).filter(Boolean);
  const history = Array.isArray(state.scoreHistory) ? state.scoreHistory : [];

  if (!managers.length || !history.length) {
    elements.scoreChart.className = "score-chart empty-state";
    elements.scoreChart.textContent = "Sync live data or update scores to build the tournament progression graph.";
    return;
  }

  const snapshots = history.filter((entry) => entry && entry.scores && Object.keys(entry.scores).length);
  if (!snapshots.length) {
    elements.scoreChart.className = "score-chart empty-state";
    elements.scoreChart.textContent = "Sync live data or update scores to build the tournament progression graph.";
    return;
  }

  const isMobileChart = window.matchMedia("(max-width: 640px)").matches;
  const chartWidth = 820;
  const chartHeight = isMobileChart ? 336 : 188;
  const padding = isMobileChart
    ? { top: 20, right: 138, bottom: 38, left: 44 }
    : { top: 14, right: 118, bottom: 28, left: 42 };
  const values = snapshots.flatMap((snapshot) =>
    managers
      .map((manager) => snapshot.scores[manager])
      .filter((value) => Number.isFinite(value))
  );
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 0;
  const spread = Math.max(2, maxValue - minValue || 2);
  const yMin = minValue - 1;
  const yMax = maxValue + 1;
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  const yTicks = buildYAxisTicks(yMin, yMax, 5);
  const tournamentWindow = buildTournamentWindow(snapshots);
  const xDateLabels = buildXAxisDateLabels(tournamentWindow, chartWidth, padding);
  const latest = snapshots[snapshots.length - 1];
  const first = snapshots[0];
  const selectedSnapshotIndex = Math.min(
    snapshots.length - 1,
    Math.max(0, Number.isFinite(state.scoreChartSelectedIndex) ? state.scoreChartSelectedIndex : snapshots.length - 1)
  );
  const selectedSnapshot = snapshots[selectedSnapshotIndex];
  const selectedX = padding.left + innerWidth * getSnapshotXRatio(selectedSnapshot, tournamentWindow);

  const chartLines = managers.map((manager, index) => {
    const color = chartColorForIndex(index, managers.length);
    const points = snapshots.map((snapshot, snapshotIndex) => {
      const score = Number(snapshot.scores[manager] ?? 0);
      const x = padding.left + innerWidth * getSnapshotXRatio(snapshot, tournamentWindow);
      const y = padding.top + ((score - yMin) / (yMax - yMin || 1)) * innerHeight;
      return { x, y, score, snapshotIndex };
    });
    const linePath = buildSmoothChartPath(points);
    const selectedPoint = points[selectedSnapshotIndex] || points[points.length - 1];
    const latestPoint = points[points.length - 1];
    const labelX = Math.min(chartWidth - 6, latestPoint.x + 8);
    const labelY = Math.max(12, Math.min(chartHeight - 10, latestPoint.y + 4));
    const labelFontSize = isMobileChart ? 18 : 13;
    const pointRadius = isMobileChart ? 4.8 : 3.5;

    return `
      <g>
        <path d="${linePath}" fill="none" stroke="${color}" stroke-opacity="0.95" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path>
        <circle cx="${selectedPoint.x.toFixed(1)}" cy="${selectedPoint.y.toFixed(1)}" r="${pointRadius}" fill="${color}" stroke="rgba(255,255,255,0.92)" stroke-width="1.8"></circle>
        <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" fill="${color}" font-size="${labelFontSize}" font-weight="700" font-family="Space Grotesk, sans-serif">${escapeHtml(`${manager} ${formatScore(Number(latestPoint.score) || 0)}`)}</text>
      </g>
    `;
  }).join("");

  const selectedLegend = managers.map((manager, index) => {
    const color = chartColorForIndex(index, managers.length);
    const selectedScore = Number(selectedSnapshot.scores?.[manager] ?? 0);
    return `
      <span class="score-chart-legend-item">
        <span class="score-chart-legend-swatch" style="background:${escapeAttribute(color)}"></span>
        <span class="score-chart-legend-name">${escapeHtml(manager)}</span>
        <strong class="score-chart-legend-score">${escapeHtml(formatScore(selectedScore))}</strong>
      </span>
    `;
  }).join("");

  elements.scoreChart.className = "score-chart";
  elements.scoreChart.innerHTML = `
    <div class="score-chart-shell">
      <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="score-chart-svg" role="img" aria-label="Team score progression graph">
        ${yTicks.map((tick) => {
          const y = padding.top + ((tick - yMin) / (yMax - yMin || 1)) * innerHeight;
          return `
            <g>
              <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${chartWidth - padding.right}" y2="${y.toFixed(1)}" stroke="rgba(19, 33, 44, 0.10)" stroke-dasharray="4 4"></line>
              <text x="${padding.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="rgba(19, 33, 44, 0.72)" font-size="10" font-family="Space Grotesk, sans-serif">${escapeHtml(formatScore(tick))}</text>
            </g>
          `;
        }).join("")}
        <line x1="${padding.left}" y1="${chartHeight - padding.bottom}" x2="${chartWidth - padding.right}" y2="${chartHeight - padding.bottom}" stroke="rgba(19, 33, 44, 0.24)"></line>
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${chartHeight - padding.bottom}" stroke="rgba(19, 33, 44, 0.24)"></line>
        ${chartLines}
        ${xDateLabels.map((label) => `
          <text x="${label.x.toFixed(1)}" y="${chartHeight - 8}" text-anchor="${label.anchor}" fill="rgba(19, 33, 44, 0.72)" font-size="10" font-family="Space Grotesk, sans-serif">${label.text}</text>
        `).join("")}
      </svg>
      <div class="score-chart-legend">${selectedLegend}</div>
      <div class="score-chart-meta">
        <span>Last refreshed ${escapeHtml(formatSnapshotDateTime(latest))}</span>
      </div>
    </div>
  `;
  const chartSvg = elements.scoreChart.querySelector(".score-chart-svg");
  chartSvg?.addEventListener("click", (event) => {
    const bounds = chartSvg.getBoundingClientRect();
    if (!bounds.width) {
      return;
    }
    const relativeX = Math.max(padding.left, Math.min(chartWidth - padding.right, ((event.clientX - bounds.left) / bounds.width) * chartWidth));
    const nearestIndex = snapshots.reduce((bestIndex, snapshot, index) => {
      const snapshotX = padding.left + innerWidth * getSnapshotXRatio(snapshot, tournamentWindow);
      const bestX = padding.left + innerWidth * getSnapshotXRatio(snapshots[bestIndex], tournamentWindow);
      return Math.abs(snapshotX - relativeX) < Math.abs(bestX - relativeX) ? index : bestIndex;
    }, selectedSnapshotIndex);
    state.scoreChartSelectedIndex = nearestIndex;
    renderScoreChart();
  });
}

function recordScoreSnapshot(label = "", force = false) {
  const standings = getProjectedStandings();
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

  if (!force && lastSnapshot && areScoreSnapshotsEqual(lastSnapshot.scores, scores)) {
    return;
  }

  const snapshot = {
    timestamp: new Date().toISOString(),
    label,
    scores
  };

  state.scoreHistory = [...(state.scoreHistory || []), snapshot].slice(-240);
}

function areScoreSnapshotsEqual(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && Number(left[key]) === Number(right[key]));
}

function chartColorForIndex(index, total) {
  const hue = Math.round((index / Math.max(1, total)) * 300);
  return `hsl(${hue}, 68%, 42%)`;
}

function buildSmoothChartPath(points) {
  if (!points.length) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = ((current.x + next.x) / 2).toFixed(1);

    path += ` C ${midX} ${current.y.toFixed(1)}, ${midX} ${next.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }

  return path;
}

function buildYAxisTicks(min, max, count) {
  const ticks = [];
  const step = (max - min) / Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    ticks.push(Math.round((min + step * index) * 10) / 10);
  }
  return ticks;
}

function buildXAxisDateLabels(tournamentWindow, chartWidth, padding) {
  const width = chartWidth - padding.left - padding.right;
  const labels = Array.from({ length: 4 }, (_, index) => {
    const date = new Date(tournamentWindow.start.getTime());
    date.setDate(date.getDate() + index);
    return {
      text: date.toLocaleDateString([], {
        month: "numeric",
        day: "numeric"
      }),
      x: padding.left + (width * (index / 3)),
      anchor: index === 0 ? "start" : index === 3 ? "end" : "middle"
    };
  });

  return labels;
}

function buildTournamentWindow(snapshots) {
  const latestSnapshot = snapshots[snapshots.length - 1];
  const baseDate = latestSnapshot?.timestamp ? new Date(latestSnapshot.timestamp) : new Date();
  const safeBaseDate = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  const start = new Date(safeBaseDate);
  const day = start.getDay();
  const daysSinceThursday = (day + 7 - 4) % 7;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysSinceThursday);

  const end = new Date(start);
  end.setDate(end.getDate() + 3);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function getSnapshotXRatio(snapshot, tournamentWindow) {
  const timestamp = snapshot?.timestamp ? new Date(snapshot.timestamp) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    return 0;
  }

  const total = tournamentWindow.end.getTime() - tournamentWindow.start.getTime();
  if (total <= 0) {
    return 0;
  }

  const elapsed = timestamp.getTime() - tournamentWindow.start.getTime();
  return Math.max(0, Math.min(1, elapsed / total));
}

function formatSnapshotLabel(snapshot) {
  const date = snapshot?.timestamp ? new Date(snapshot.timestamp) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return snapshot?.label || "Update";
  }

  const timeLabel = date.toLocaleDateString([], {
      month: "numeric",
      day: "numeric"
  });

  return snapshot?.label ? `${snapshot.label} • ${timeLabel}` : timeLabel;
}

function formatSnapshotDateTime(snapshot) {
  const date = snapshot?.timestamp ? new Date(snapshot.timestamp) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderAvailableGolferOptions() {
  const golfers = remainingGolfers();
  elements.availableGolferOptions.innerHTML = golfers
    .map((golfer) => `<option value="${escapeAttribute(golfer)}"></option>`)
    .join("");
}

function handleTeamAssign(manager, input) {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  const golfer = String(input.value || "").trim();
  if (!golfer) {
    return;
  }

  assignGolferToManager(manager, golfer);
  input.value = "";
}

function assignGolferToManager(manager, golfer) {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  const roster = golfersForManager(manager);
  if (roster.length >= PICKS_PER_MANAGER) {
    window.alert(`${manager} already has ${PICKS_PER_MANAGER} golfers.`);
    return;
  }

  const availableMatch = remainingGolfers().find((entry) => normalizeName(entry) === normalizeName(golfer));
  if (!availableMatch) {
    window.alert("Pick a golfer from the available pool.");
    return;
  }

  state.draftedGolfers[availableMatch] = manager;
  state.scores[availableMatch] = normalizeGolferState(state.scores[availableMatch]);
  state.pickHistory.push({
    pick: Object.keys(state.draftedGolfers).length,
    golfer: availableMatch,
    manager
  });
  state.currentPick = Object.keys(state.draftedGolfers).length;
  if (!state.draftStarted) {
    state.draftStarted = true;
    state.draftOrder = state.draftOrder.length ? state.draftOrder : state.managers.filter(Boolean);
  }

  persist();
  render();
}

function handleScoreChange(event) {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  const golfer = event.target.dataset.golfer;
  const field = event.target.dataset.field;
  const current = normalizeGolferState(state.scores[golfer]);

  current[field] = field === "madeCut" ? event.target.checked : event.target.value.trim();
  state.scores[golfer] = normalizeGolferState(current);
  recordScoreSnapshot("Manual score update");
  persist();
  render();
}

function renderStatus() {
  const totalPicks = Object.keys(state.draftedGolfers).length;
  const remaining = totalPicksNeeded() - totalPicks;

  if (!state.draftStarted) {
    elements.draftStatusPill.textContent = "Waiting to start";
    return;
  }

  if (isDraftComplete()) {
    elements.draftStatusPill.textContent = "Draft complete";
    return;
  }

  elements.draftStatusPill.textContent = `${remaining} picks left`;
}

async function checkLiveStatus() {
  try {
    const response = await fetch("/api/live/status", {
      headers: buildRequestHeaders()
    });
    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }

    liveStatus = await readJsonResponse(response, "Unable to read live status.");
  } catch (error) {
    liveStatus = {
      available: false,
      configured: false,
      provider: "Data Golf",
      error: error.message,
      details: null,
      tournamentLookupConfigured: false
    };
  }

  renderLiveStatus();
  if (isAdminMode()) {
    maybeAutoLoadField();
  }
}

async function syncLiveData(options = {}) {
  const {
    allowViewer = false,
    persistShared = isAdminMode(),
    showReadOnlyAlert = true
  } = options;

  if (!isAdminMode() && !allowViewer) {
    if (showReadOnlyAlert) {
      handleReadOnlyAction();
    }
    return;
  }
  await checkLiveStatus();
  if (!liveStatus.available || !liveStatus.configured) {
    renderLiveStatus();
    return;
  }

  setLiveBusy(true, "Syncing Data Golf live feed...");

  try {
    const params = new URLSearchParams({
      tour: "pga"
    });
    const response = await fetch(`/api/live/import?${params.toString()}`, {
      headers: buildRequestHeaders()
    });
    const payload = await readJsonResponse(response, "Unable to read Data Golf response.");

    if (!response.ok) {
      throw buildClientError(payload, "Unable to sync Data Golf live feed.");
    }

    applyDataGolfImport(payload);
    liveStatus.error = "";
    liveStatus.details = null;
    if (persistShared) {
      persist();
    } else {
      syncCurrentEventSnapshot(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    render();
  } catch (error) {
    state.liveSettings.lastSyncSummary = formatClientError(error);
    if (persistShared) {
      persist();
    } else {
      syncCurrentEventSnapshot(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    renderLiveStatus();
  } finally {
    setLiveBusy(false);
  }
}

async function loadTournamentField(options = {}) {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  const { skipStatusCheck = false, allowDraftReset = true, silent = false } = options;

  if (fieldLoadInFlight) {
    return;
  }

  if (!skipStatusCheck) {
    await checkLiveStatus();
  }

  if (!liveStatus.available || !liveStatus.configured) {
    renderLiveStatus();
    return;
  }

  const hasExistingDraft = state.draftStarted || Object.keys(state.draftedGolfers).length;

  if (hasExistingDraft && !allowDraftReset) {
    return;
  }

  if (hasExistingDraft && allowDraftReset) {
    const confirmed = window.confirm("Loading the tournament field will replace the current golfer pool. Continue?");
    if (!confirmed) {
      return;
    }
  }

  fieldLoadInFlight = true;
  setLiveBusy(true, silent ? "" : "Loading Data Golf field...");

  try {
    const params = new URLSearchParams({ tour: "pga" });

    const response = await fetch(`/api/live/field?${params.toString()}`, {
      headers: buildRequestHeaders()
    });
    const payload = await readJsonResponse(response, "Unable to read tournament field response.");

    if (!response.ok) {
      throw buildClientError(payload, "Unable to load tournament field.");
    }

    if (hasExistingDraft) {
      state.draftedGolfers = {};
      state.scores = {};
      state.pickHistory = [];
      state.currentPick = 0;
      state.draftStarted = false;
    }

    state.golfers = payload.golfers;
    state.liveSettings.lastTournamentName = payload.tournament?.name || "Data Golf field";
    state.liveSettings.lastSyncSummary = `Loaded ${payload.golfers.length} golfers from ${state.liveSettings.lastTournamentName}.`;
    liveStatus.error = "";
    liveStatus.details = null;
    persist();
    syncFormFromState();
    render();
  } catch (error) {
    state.liveSettings.lastSyncSummary = formatClientError(error);
    persist();
    renderLiveStatus();
  } finally {
    fieldLoadInFlight = false;
    setLiveBusy(false);
  }
}

async function importCsvLeaderboard() {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  const [file] = elements.csvFileInput.files || [];
  if (!file) {
    window.alert("Choose a CSV file first.");
    return;
  }

  try {
    const text = await file.text();
    importCsvContent(text, file.name);
    elements.csvFileInput.value = "";
    persist();
    render();
  } catch (error) {
    state.liveSettings.lastSyncSummary = error.message || "Unable to import CSV leaderboard.";
    persist();
    renderLiveStatus();
  }
}

function importPastedCsvLeaderboard() {
  if (!isAdminMode()) {
    handleReadOnlyAction();
    return;
  }
  const text = elements.csvTextInput.value.trim();
  if (!text) {
    window.alert("Paste CSV text first.");
    return;
  }

  try {
    importCsvContent(text, "pasted CSV");
    elements.csvTextInput.value = "";
    persist();
    render();
  } catch (error) {
    state.liveSettings.lastSyncSummary = error.message || "Unable to import pasted CSV leaderboard.";
    persist();
    renderLiveStatus();
  }
}

function importCsvContent(text, sourceLabel) {
  const importedPlayers = parseLeaderboardCsv(text);

  if (!importedPlayers.length) {
    throw new Error("No golfers were found in that CSV. Make sure it includes a name/player column.");
  }

  if (elements.csvLoadFieldToggle.checked && !state.draftStarted && !Object.keys(state.draftedGolfers).length) {
    state.golfers = Array.from(new Set(importedPlayers.map((player) => player.name))).sort((a, b) => a.localeCompare(b));
    syncFormFromState();
  }

  applyCsvImport(importedPlayers, sourceLabel);
}

function downloadCsvTemplate() {
  const template = [
    "Player,Pos,Total,Today,Money,Status",
    "J.J. Spaun,1,E,E,0,Made",
    "Rory McIlroy,T2,-2,-2,0,Made",
    "Scottie Scheffler,T4,-1,-1,0,Made",
    "Shane Lowry,65,+1,+1,0,CUT"
  ].join("\n");

  const blob = new Blob([template], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "players-championship-template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function maybeAutoLoadField() {
  if (!liveStatus.available || !liveStatus.configured || fieldLoadInFlight) {
    return;
  }

  if (state.draftStarted || Object.keys(state.draftedGolfers).length || state.golfers.length) {
    return;
  }

  loadTournamentField({
    skipStatusCheck: true,
    allowDraftReset: false,
    silent: true
  });
}

function applyDataGolfImport(payload) {
  const inPlayByName = new Map((payload.inPlay || []).map((player) => [normalizeName(player.name), player]));

  state.livePlayers = payload.liveStats.map((player) => {
    const inPlayMatch = inPlayByName.get(normalizeName(player.name));
    return ({
    ...player,
    position: player.position || "-",
    score: player.score || "E",
    todayScore: player.todayScore || "E",
    money: Number(player.money) || 0,
    madeCut: player.madeCut !== false,
    thru: player.thru || "",
    teeTime: player.teeTime || inPlayMatch?.teeTime || ""
    });
  });

  state.dataGolfPlayers = payload.inPlay.map((player) => ({
    ...player,
    win: normalizePercentDisplayValue(player.win),
    top5: normalizePercentDisplayValue(player.top5),
    top10: normalizePercentDisplayValue(player.top10),
    top20: normalizePercentDisplayValue(player.top20),
    makeCut: normalizePercentDisplayValue(player.makeCut)
  }));

  const feedByName = new Map(state.livePlayers.map((player) => [normalizeName(player.name), player]));
  Object.keys(state.draftedGolfers).forEach((golfer) => {
    const incoming = feedByName.get(normalizeName(golfer));
    if (!incoming) {
      return;
    }

    state.scores[golfer] = normalizeGolferState({
      position: incoming.position,
      score: incoming.score,
      todayScore: incoming.todayScore,
      money: String(incoming.money ?? 0),
      madeCut: incoming.madeCut
    });
  });

  state.liveSettings.lastSyncAt = new Date().toISOString();
  state.liveSettings.lastTournamentName = payload.tournament?.name || state.liveSettings.lastTournamentName;
  state.liveSettings.lastSyncSummary = `Loaded Data Golf live stats for ${state.livePlayers.length} golfers and in-play predictions for ${state.dataGolfPlayers.length}.`;
  recordScoreSnapshot("Data Golf sync");
}

function applyCsvImport(players, fileName) {
  const draftedNames = Object.keys(state.draftedGolfers);
  const feedByName = new Map(players.map((player) => [normalizeName(player.name), player]));
  const matched = [];
  const unmatched = [];

  state.livePlayers = players;

  draftedNames.forEach((golfer) => {
    const incoming = feedByName.get(normalizeName(golfer));
    if (!incoming) {
      unmatched.push(golfer);
      return;
    }

    state.scores[golfer] = normalizeGolferState({
      position: incoming.position,
      score: incoming.score,
      todayScore: incoming.todayScore,
      money: String(incoming.money ?? 0),
      madeCut: incoming.madeCut
    });
    matched.push(golfer);
  });

  state.liveSettings.lastSyncAt = new Date().toISOString();
  state.liveSettings.lastSyncSummary = `Imported ${players.length} golfers from ${fileName}. Matched ${matched.length} drafted golfers${unmatched.length ? `, unmatched: ${unmatched.join(", ")}` : ""}.`;
  liveStatus.error = "";
  liveStatus.details = null;
  recordScoreSnapshot(`CSV import: ${fileName}`);
}

function compareLivePlayers(a, b) {
  const positionDelta = comparePositions(a.position, b.position);
  if (positionDelta !== 0) {
    return positionDelta;
  }

  const scoreDelta = normalizeScore(a.score) - normalizeScore(b.score);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return a.name.localeCompare(b.name);
}

function comparePositions(left, right) {
  const a = parsePositionValue(left);
  const b = parsePositionValue(right);

  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }

  return a.raw.localeCompare(b.raw);
}

function parsePositionValue(value) {
  const raw = String(value || "-").trim().toUpperCase();
  const match = raw.match(/\d+/);
  if (!match) {
    return {
      rank: Number.POSITIVE_INFINITY,
      raw
    };
  }

  return {
    rank: Number(match[0]),
    raw
  };
}

function setLiveBusy(isBusy, message = "") {
  elements.syncDataGolfButton.disabled = isBusy;
  elements.loadFieldButton.disabled = isBusy;
  if (message) {
    state.liveSettings.lastSyncSummary = message;
    persist();
    renderLiveStatus();
  }
}

function buildClientError(payload, fallbackMessage) {
  const error = new Error(payload?.error || fallbackMessage);
  error.details = payload?.details || null;
  liveStatus.error = error.message;
  liveStatus.details = error.details;
  return error;
}

function parseLeaderboardCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    return [];
  }

  const headerMap = rows[0].map((header) => normalizeHeader(header));

  return rows
    .slice(1)
    .map((row) => buildPlayerFromCsvRow(row, headerMap))
    .filter((player) => player && player.name);
}

function buildPlayerFromCsvRow(row, headerMap) {
  const read = (aliases) => readCsvValue(row, headerMap, aliases);
  const name = read(["player", "playername", "name", "golfer", "golfername"]);

  if (!name) {
    return null;
  }

  const rawScore = read(["score", "total", "totalscore", "scoretopar", "topar", "overallscore", "tournamentscore"]);
  const rawToday = read(["today", "todayscore", "round", "roundscore", "roundscoretopar"]);
  const rawPosition = read(["position", "pos", "rank", "place"]);
  const rawMoney = read(["money", "earnings", "winnings", "purse"]);
  const rawMadeCut = read(["madecut", "cut", "status"]);

  return {
    name,
    position: rawPosition || "-",
    score: normalizeCsvScore(rawScore),
    todayScore: normalizeCsvScore(rawToday),
    money: normalizeMoney(rawMoney),
    madeCut: normalizeCsvMadeCut(rawMadeCut)
  };
}

function readCsvValue(row, headerMap, aliases) {
  const matchIndex = headerMap.findIndex((header) => aliases.includes(header));
  if (matchIndex === -1) {
    return "";
  }
  return String(row[matchIndex] ?? "").trim();
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeCsvScore(value) {
  if (!value) {
    return "E";
  }

  const upper = String(value).trim().toUpperCase();
  if (["E", "EVEN", "EV"].includes(upper)) {
    return "E";
  }

  const parsed = Number(upper.replace(/[^0-9+-.]/g, ""));
  if (!Number.isFinite(parsed)) {
    return "E";
  }

  return parsed > 0 ? `+${parsed}` : `${parsed}`;
}

function normalizeCsvMadeCut(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return true;
  }
  if (["CUT", "MC", "MISSED", "MISSEDCUT", "WD", "DQ", "MDF", "FALSE", "NO", "0"].includes(normalized)) {
    return false;
  }
  return true;
}

function parseCsvRows(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      current.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      current.push(value);
      if (current.some((cell) => String(cell).trim() !== "")) {
        rows.push(current);
      }
      current = [];
      value = "";
      continue;
    }

    value += char;
  }

  current.push(value);
  if (current.some((cell) => String(cell).trim() !== "")) {
    rows.push(current);
  }

  return rows;
}

async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const error = new Error(fallbackMessage);
    error.details = {
      status: response.status,
      body: text.slice(0, 300),
      suggestion: "Restart the local server so it picks up the latest API routes."
    };
    throw error;
  }
}

function formatClientError(error) {
  if (!error?.details) {
    return error?.message || "Unknown live sync error.";
  }

  const attempts = Array.isArray(error.details.attempts) ? error.details.attempts : [];
  if (!attempts.length) {
    return `${error.message} ${JSON.stringify(error.details)}`;
  }

  const summary = attempts
    .map((attempt) => `${attempt.status} ${attempt.url}${attempt.body ? ` :: ${attempt.body}` : ""}`)
    .join(" | ");

  return `${error.message} ${summary}`;
}

function renderDebugDetails(details) {
  if (!details) {
    return "";
  }

  if (Array.isArray(details.attempts)) {
    return details.attempts
      .map((attempt) => escapeHtml(`${attempt.status} ${attempt.url}${attempt.body ? ` :: ${attempt.body}` : ""}`))
      .join("<br>");
  }

  return escapeHtml(JSON.stringify(details));
}

function setupAutoRefresh() {
  if (autoRefreshHandle) {
    window.clearInterval(autoRefreshHandle);
    autoRefreshHandle = null;
  }

  const seconds = Number(state.liveSettings.autoRefreshSeconds) || 0;
  if (!seconds) {
    return;
  }

  autoRefreshHandle = window.setInterval(() => {
    syncLiveData({
      allowViewer: true,
      persistShared: isAdminMode(),
      showReadOnlyAlert: false
    });
  }, seconds * 1000);
}

function managerForPick(pickNumber) {
  const order = state.draftOrder.length ? state.draftOrder : state.managers.filter(Boolean);
  const round = Math.floor(pickNumber / currentManagerCount());
  const pickInRound = pickNumber % currentManagerCount();
  const forward = round % 2 === 0;
  return forward ? order[pickInRound] : order[currentManagerCount() - 1 - pickInRound];
}

function draftDirectionForPick(pickNumber) {
  return Math.floor(pickNumber / currentManagerCount()) % 2 === 0 ? "forward" : "reverse";
}

function golfersForManager(manager) {
  return Object.entries(state.draftedGolfers)
    .filter(([, owner]) => owner === manager)
    .map(([golfer]) => golfer)
    .sort((a, b) => getGolferDisplay(a).effectiveScore - getGolferDisplay(b).effectiveScore);
}

function remainingGolfers() {
  if (isDraftComplete()) {
    return [];
  }
  return state.golfers.filter((golfer) => !state.draftedGolfers[golfer]);
}

function getProjectedStandings() {
  const managers = (state.draftOrder.length ? state.draftOrder : state.managers).filter(Boolean);
  return managers
    .map((manager) => summarizeTeam(manager))
    .sort(compareTeams);
}

function summarizeTeam(manager) {
  const roster = golfersForManager(manager);
  if (!roster.length) {
    return emptyTeamSummary(manager);
  }

  const golferDetails = roster.map((golfer) => ({ golfer, ...getGolferDisplay(golfer) }));
  const sortedByWorst = [...golferDetails].sort((a, b) => b.effectiveScore - a.effectiveScore);
  const dropped = golferDetails.length > 3 ? sortedByWorst[0] : null;
  const countingGolfers = dropped ? golferDetails.filter((entry) => entry.golfer !== dropped.golfer) : golferDetails;
  const countingScore = countingGolfers.reduce((sum, entry) => sum + entry.effectiveScore, 0);
  const countingTodayScore = countingGolfers.reduce((sum, entry) => sum + entry.effectiveTodayScore, 0);
  const totalMoney = golferDetails.reduce((sum, entry) => sum + entry.money, 0);

  return {
    manager,
    rosterSize: roster.length,
    droppedGolfer: dropped ? dropped.golfer : null,
    countingScore,
    countingTodayScore,
    totalMoney,
    golfers: golferDetails
  };
}

function emptyTeamSummary(manager) {
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

function compareTeams(a, b) {
  if (a.rosterSize !== b.rosterSize) {
    return b.rosterSize - a.rosterSize;
  }
  if (a.countingScore !== b.countingScore) {
    return a.countingScore - b.countingScore;
  }
  if (a.totalMoney !== b.totalMoney) {
    return b.totalMoney - a.totalMoney;
  }
  return a.manager.localeCompare(b.manager);
}

function getGolferDisplay(golfer) {
  const golferState = getMergedGolferState(golfer);
  const cutLineScore = getCutLineScore();
  const cutLineTodayScore = getCutLineTodayScore();
  const enteredScore = normalizeScore(golferState.score);
  const effectiveScore = golferState.madeCut ? enteredScore : cutLineScore;
  const enteredTodayScore = normalizeScore(golferState.todayScore);
  const effectiveTodayScore = golferState.madeCut ? enteredTodayScore : cutLineTodayScore;

  return {
    rawScore: golferState.score,
    rawTodayScore: golferState.todayScore,
    rawMoney: golferState.money,
    position: golferState.position,
    madeCut: golferState.madeCut,
    money: normalizeMoney(golferState.money),
    enteredScore,
    effectiveScore,
    enteredTodayScore,
    effectiveTodayScore
  };
}

function findLivePlayer(golfer) {
  const normalizedGolfer = normalizeName(golfer);
  return state.livePlayers.find((player) => normalizeName(player.name) === normalizedGolfer) || null;
}

function getMergedGolferState(golfer) {
  const liveMatch = findLivePlayer(golfer);
  const storedState = state.scores[golfer] || {};

  return normalizeGolferState({
    ...storedState,
    position: liveMatch?.position ?? storedState.position,
    score: liveMatch?.score ?? storedState.score,
    todayScore: liveMatch?.todayScore ?? storedState.todayScore,
    money: liveMatch?.money ?? storedState.money,
    madeCut: liveMatch?.madeCut ?? storedState.madeCut
  });
}

function getCutLineScore() {
  const tournamentScores = state.livePlayers
    .filter((player) => player.madeCut !== false)
    .map((player) => normalizeScore(player.score))
    .filter((score) => Number.isFinite(score));

  if (tournamentScores.length) {
    return Math.max(...tournamentScores);
  }

  const madeCutScores = Object.keys(state.draftedGolfers)
    .map((golfer) => getMergedGolferState(golfer))
    .filter((details) => details.madeCut)
    .map((details) => normalizeScore(details.score));

  if (!madeCutScores.length) {
    return 0;
  }

  return Math.max(...madeCutScores);
}

function getCutLineTodayScore() {
  const fallbackPlayer = getWorstActiveTournamentPlayer();
  if (fallbackPlayer) {
    return normalizeScore(fallbackPlayer.todayScore);
  }

  const madeCutTodayScores = Object.keys(state.draftedGolfers)
    .map((golfer) => getMergedGolferState(golfer))
    .filter((details) => details.madeCut)
    .map((details) => normalizeScore(details.todayScore));

  if (!madeCutTodayScores.length) {
    return 0;
  }

  return Math.max(...madeCutTodayScores);
}

function getWorstActiveTournamentPlayer() {
  const activePlayers = state.livePlayers
    .filter((player) => player.madeCut !== false)
    .map((player) => ({
      ...player,
      normalizedScore: normalizeScore(player.score)
    }))
    .filter((player) => Number.isFinite(player.normalizedScore));

  if (!activePlayers.length) {
    return null;
  }

  return activePlayers.sort((a, b) => {
    if (a.normalizedScore !== b.normalizedScore) {
      return b.normalizedScore - a.normalizedScore;
    }
    return normalizeScore(b.todayScore) - normalizeScore(a.todayScore);
  })[0];
}

function isDraftComplete() {
  return Object.keys(state.draftedGolfers).length >= totalPicksNeeded();
}

function normalizeGolferState(value) {
  if (!value || typeof value !== "object") {
    return defaultGolferState();
  }

  return {
    score: value.score === undefined || value.score === null || value.score === "" ? "E" : String(value.score).trim(),
    todayScore: value.todayScore === undefined || value.todayScore === null || value.todayScore === "" ? "E" : String(value.todayScore).trim(),
    position: value.position === undefined || value.position === null || value.position === "" ? "-" : String(value.position).trim(),
    money: value.money === undefined || value.money === null || value.money === "" ? "0" : String(value.money).trim(),
    madeCut: value.madeCut !== false
  };
}

function normalizeScore(rawScore) {
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

function normalizeMoney(rawMoney) {
  if (rawMoney === undefined || rawMoney === null || rawMoney === "") {
    return 0;
  }

  const parsed = Number(String(rawMoney).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatScore(score) {
  if (!Number.isFinite(score) || score === 0) {
    return "E";
  }
  return score > 0 ? `+${score}` : `${score}`;
}

function formatMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount || 0);
}

function formatPercent(value) {
  return `${Number(value).toFixed(1)}%`;
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

function buildProbabilityStyle(value, range = null) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  const normalized = normalizeProbabilityForStyle(percent, range);
  const hue = Math.round(normalized * 120);
  const backgroundAlpha = 0.14 + normalized * 0.12;
  const borderAlpha = 0.24 + normalized * 0.18;
  return [
    `background: hsla(${hue}, 62%, 55%, ${backgroundAlpha.toFixed(3)})`,
    `border-color: hsla(${hue}, 68%, 34%, ${borderAlpha.toFixed(3)})`,
    `color: hsl(${hue}, 72%, 24%)`
  ].join("; ");
}

function getProbabilityRange(players, key) {
  const values = players
    .map((player) => Number(player?.[key]))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return { min: 0, max: 100 };
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function normalizeProbabilityForStyle(value, range) {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    return value / 100;
  }

  if (range.max <= range.min) {
    return 1;
  }

  return (value - range.min) / (range.max - range.min);
}

function formatStanding(position) {
  const mod10 = position % 10;
  const mod100 = position % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${position}st`;
  }
  if (mod10 === 2 && mod100 !== 12) {
    return `${position}nd`;
  }
  if (mod10 === 3 && mod100 !== 13) {
    return `${position}rd`;
  }
  return `${position}th`;
}

function parseGolfers(value) {
  const seen = new Set();
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((golfer) => {
      const key = golfer.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

async function hydrateFromSharedState() {
  try {
    const response = await fetch("/api/state", {
      headers: buildRequestHeaders()
    });
    if (!response.ok) {
      throw new Error(`Shared state ${response.status}`);
    }

    const payload = await response.json();
    sharedStateAvailable = true;
    sharedStateMeta = payload?.meta || { updatedAt: "", updatedBy: "" };

    if (payload?.state && typeof payload.state === "object") {
      applyRemoteState(payload.state);
    } else {
      persist();
    }

    startSharedStatePolling();
  } catch {
    sharedStateAvailable = false;
  }
}

function applyRemoteState(remoteState) {
  isApplyingRemoteState = true;
  state = hydrateState(remoteState);
  syncFormFromState();
  setupAutoRefresh();
  render();
  isApplyingRemoteState = false;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function startSharedStatePolling() {
  if (sharedStatePollHandle) {
    window.clearInterval(sharedStatePollHandle);
  }

  sharedStatePollHandle = window.setInterval(async () => {
    try {
      const response = await fetch("/api/state", {
        headers: buildRequestHeaders()
      });
      if (!response.ok) {
        throw new Error(`Shared state ${response.status}`);
      }

      const payload = await response.json();
      sharedStateAvailable = true;
      const remoteMeta = payload?.meta || { updatedAt: "", updatedBy: "" };
      const hasNewerState = Boolean(remoteMeta.updatedAt) && remoteMeta.updatedAt !== sharedStateMeta.updatedAt;

      if (hasNewerState && remoteMeta.updatedBy !== clientId && payload?.state && typeof payload.state === "object") {
        sharedStateMeta = remoteMeta;
        applyRemoteState(payload.state);
        return;
      }

      sharedStateMeta = remoteMeta;
    } catch {
      sharedStateAvailable = false;
    }
  }, SHARED_STATE_POLL_MS);
}

function queueSharedSave() {
  if (!isAdminMode()) {
    return;
  }
  if (isApplyingRemoteState) {
    return;
  }

  if (sharedSaveHandle) {
    window.clearTimeout(sharedSaveHandle);
  }

  sharedSaveHandle = window.setTimeout(() => {
    syncSharedState();
  }, 200);
}

async function syncSharedState() {
  sharedSaveHandle = null;

  try {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: buildRequestHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        clientId,
        state
      })
    });

    if (!response.ok) {
      throw new Error(`Shared state ${response.status}`);
    }

    const payload = await response.json();
    sharedStateAvailable = true;
    sharedStateMeta = payload?.meta || sharedStateMeta;
  } catch {
    sharedStateAvailable = false;
  }
}

function ensureEventCollections(nextState) {
  const stateWithEvents = nextState;
  stateWithEvents.currentEventId = stateWithEvents.currentEventId || DEFAULT_EVENT_ID;
  stateWithEvents.eventOrder = Array.isArray(stateWithEvents.eventOrder) && stateWithEvents.eventOrder.length
    ? [...new Set(stateWithEvents.eventOrder)]
    : [stateWithEvents.currentEventId];
  stateWithEvents.eventSnapshots = stateWithEvents.eventSnapshots && typeof stateWithEvents.eventSnapshots === "object"
    ? { ...stateWithEvents.eventSnapshots }
    : {};

  if (!stateWithEvents.eventOrder.includes(stateWithEvents.currentEventId)) {
    stateWithEvents.eventOrder.push(stateWithEvents.currentEventId);
  }

  if (!stateWithEvents.eventSnapshots[stateWithEvents.currentEventId]) {
    stateWithEvents.eventSnapshots[stateWithEvents.currentEventId] = buildEventSnapshotFromState(stateWithEvents);
  }

  return stateWithEvents;
}

function buildEventSnapshotFromState(sourceState) {
  const snapshot = {};
  EVENT_STATE_KEYS.forEach((key) => {
    snapshot[key] = structuredClone(sourceState[key]);
  });
  return snapshot;
}

function buildFreshEventSnapshot(name) {
  const managerSeed = Array.isArray(state?.managers) && state.managers.length
    ? [...state.managers]
    : [...initialState.managers];

  return {
    eventName: name || initialState.eventName,
    managers: managerSeed,
    draftOrder: [],
    golfers: [],
    draftedGolfers: {},
    livePlayers: [],
    dataGolfPlayers: [],
    scores: {},
    scoreHistory: [],
    scoreChartCollapsed: false,
    scoreChartSelectedIndex: null,
    teamDetailsOpen: {},
    draftStarted: false,
    currentPick: 0,
    pickHistory: [],
    liveSettings: structuredClone(initialState.liveSettings)
  };
}

function syncCurrentEventSnapshot(sourceState = state) {
  const nextState = sourceState;
  nextState.eventSnapshots = nextState.eventSnapshots && typeof nextState.eventSnapshots === "object"
    ? nextState.eventSnapshots
    : {};
  nextState.eventSnapshots[nextState.currentEventId || DEFAULT_EVENT_ID] = buildEventSnapshotFromState(nextState);
}

function getEventSnapshot(eventId) {
  const snapshot = state.eventSnapshots?.[eventId];
  return snapshot ? structuredClone(snapshot) : buildFreshEventSnapshot(prettifyEventId(eventId));
}

function replaceCurrentEvent(snapshot) {
  EVENT_STATE_KEYS.forEach((key) => {
    state[key] = structuredClone(snapshot[key]);
  });
}

function createEventId(name, existingIds) {
  const base = normalizeName(name).replace(/\s+/g, "-") || "event";
  let candidate = base;
  let suffix = 2;
  while (existingIds.includes(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function prettifyEventId(eventId) {
  return String(eventId || "Event")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hydrateState(source) {
  const parsed = source && typeof source === "object" ? source : {};
  const hydrated = {
    ...structuredClone(initialState),
    ...parsed,
    activeTab: "tournament",
    scoreChartCollapsed: Boolean(parsed.scoreChartCollapsed),
    teamDetailsOpen: parsed.teamDetailsOpen && typeof parsed.teamDetailsOpen === "object" ? parsed.teamDetailsOpen : {},
    liveSettings: {
      ...structuredClone(initialState.liveSettings),
      ...(parsed.liveSettings || {})
    }
  };
  ensureEventCollections(hydrated);
  const activeSnapshot = hydrated.eventSnapshots[hydrated.currentEventId];
  if (activeSnapshot) {
    EVENT_STATE_KEYS.forEach((key) => {
      hydrated[key] = structuredClone(activeSnapshot[key]);
    });
  }
  return hydrated;
}

function loadClientId() {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const created = `client-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(CLIENT_ID_KEY, created);
  return created;
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return hydrateState(initialState);
  }

  try {
    return hydrateState(JSON.parse(saved));
  } catch {
    return hydrateState(initialState);
  }
}

function persist() {
  syncCurrentEventSnapshot(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueSharedSave();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}






