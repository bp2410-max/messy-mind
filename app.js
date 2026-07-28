const STORE_KEY = "proof-window-state-v2";
const DAY_MS = 24 * 60 * 60 * 1000;
const GOOGLE_CLIENT_ID = "59689340247-5hps84egdnhoaoihm39s0e4546i4qlnt.apps.googleusercontent.com";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GOOGLE_DISCOVERY_ORIGIN = "https://www.googleapis.com/calendar/v3";

let googleTokenClient = null;
let googleAccessToken = null;

const demoEvents = [
  {
    title: "Wake up",
    time: "08:00",
    prompt: "Photo proof: brushing teeth or standing at the sink.",
  },
  {
    title: "Morning walk",
    time: "08:45",
    prompt: "Photo proof: shoes outside, route view, or step counter.",
  },
  {
    title: "Gym",
    time: "12:30",
    prompt: "Photo proof: gym entrance, equipment, or post-workout selfie.",
  },
  {
    title: "Lunch",
    time: "13:30",
    prompt: "Photo proof: plate before eating.",
  },
  {
    title: "Evening review",
    time: "20:30",
    prompt: "Photo proof: journal, desk, or checklist.",
  },
];

const defaultState = {
  settings: {
    windowMinutes: 15,
    retentionHours: 24,
    onlyTaggedEvents: true,
  },
  tasks: [],
  history: [],
  selectedDateKey: null,
  weekStartKey: null,
  calendarConnected: false,
  calendarLastSyncedAt: null,
};

let state = loadState();

const els = {
  addEventButton: document.querySelector("#addEventButton"),
  bestStreak: document.querySelector("#bestStreak"),
  calendarStatus: document.querySelector("#calendarStatus"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  completedCount: document.querySelector("#completedCount"),
  connectCalendarButton: document.querySelector("#connectCalendarButton"),
  currentDateLabel: document.querySelector("#currentDateLabel"),
  dailyProgressDate: document.querySelector("#dailyProgressDate"),
  dailyProgressPercent: document.querySelector("#dailyProgressPercent"),
  eventDialog: document.querySelector("#eventDialog"),
  eventForm: document.querySelector("#eventForm"),
  eventPrompt: document.querySelector("#eventPrompt"),
  eventTime: document.querySelector("#eventTime"),
  eventTitle: document.querySelector("#eventTitle"),
  historyList: document.querySelector("#historyList"),
  missedCount: document.querySelector("#missedCount"),
  navItems: document.querySelectorAll(".nav-item"),
  onlyTaggedEvents: document.querySelector("#onlyTaggedEvents"),
  openCount: document.querySelector("#openCount"),
  retentionHours: document.querySelector("#retentionHours"),
  seedTodayButton: document.querySelector("#seedTodayButton"),
  syncCalendarButton: document.querySelector("#syncCalendarButton"),
  taskListTitle: document.querySelector("#taskListTitle"),
  taskList: document.querySelector("#taskList"),
  views: document.querySelectorAll(".view"),
  weekStrip: document.querySelector("#weekStrip"),
  windowMinutes: document.querySelector("#windowMinutes"),
};

function loadState() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return structuredClone(defaultState);

  try {
    return { ...structuredClone(defaultState), ...JSON.parse(raw) };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value;
}

function weekStart(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const day = value.getDay();
  value.setDate(value.getDate() - day);
  return value;
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateAtTime(time, date = new Date()) {
  const [hours, minutes] = time.split(":").map(Number);
  const value = new Date(date);
  value.setHours(hours, minutes, 0, 0);
  return value;
}

function formatTime(date) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDate(date) {
  return new Intl.DateTimeFormat([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function seedWeek(force = false) {
  const start = weekStart();
  const weekKey = todayKey(start);
  if (!force && state.weekStartKey === weekKey && state.tasks.length) return;

  state.tasks = [];
  for (let day = 0; day < 7; day += 1) {
    const date = addDays(start, day);
    demoEvents.forEach((event, index) => {
      state.tasks.push(createTask({ ...event, source: "demo" }, index, date));
    });
  }

  state.weekStartKey = weekKey;
  state.selectedDateKey = todayKey();
  saveState();
}

function createTask(event, index = Date.now(), date = selectedDate()) {
  const start = dateAtTime(event.time, date);
  const due = new Date(start.getTime() + state.settings.windowMinutes * 60 * 1000);
  const dateKey = todayKey(start);

  return {
    id: crypto.randomUUID(),
    calendarEventId: `demo-${dateKey}-${index}`,
    title: event.title,
    prompt: event.prompt || "Upload a photo that proves it happened.",
    startAt: start.toISOString(),
    dueAt: due.toISOString(),
    dateKey,
    completedAt: null,
    status: "upcoming",
    proofImage: null,
    proofUploadedAt: null,
    imageExpiresAt: null,
    skippedAt: null,
    source: event.source || "manual",
  };
}

function createTaskFromCalendarEvent(event, priorTask = null) {
  const startValue = event.start?.dateTime || event.start?.date;
  const start = event.start?.dateTime ? new Date(startValue) : dateAtTime("09:00", new Date(`${startValue}T00:00:00`));
  const due = new Date(start.getTime() + state.settings.windowMinutes * 60 * 1000);
  const dateKey = todayKey(start);

  return {
    id: priorTask?.id || crypto.randomUUID(),
    calendarEventId: event.id,
    title: event.summary || "Calendar event",
    prompt: event.description || "Upload a photo that proves it happened.",
    startAt: start.toISOString(),
    dueAt: due.toISOString(),
    dateKey,
    completedAt: priorTask?.completedAt || null,
    status: priorTask?.status || "upcoming",
    proofImage: priorTask?.proofImage || null,
    proofUploadedAt: priorTask?.proofUploadedAt || null,
    imageExpiresAt: priorTask?.imageExpiresAt || null,
    skippedAt: priorTask?.skippedAt || null,
    source: "google-calendar",
  };
}

function statusForTask(task, now = new Date()) {
  if (task.skippedAt) return "skipped";
  if (task.completedAt) {
    return new Date(task.completedAt) <= new Date(task.dueAt) ? "completed" : "late";
  }

  const start = new Date(task.startAt);
  const due = new Date(task.dueAt);
  if (now < start) return "upcoming";
  if (now <= due) return "open";
  return "missed";
}

function refreshStatuses() {
  state.tasks = state.tasks.map((task) => ({
    ...task,
    status: statusForTask(task),
  }));
}

function expireOldImages() {
  const now = Date.now();
  let changed = false;

  state.tasks = state.tasks.map((task) => {
    if (task.imageExpiresAt && new Date(task.imageExpiresAt).getTime() <= now && task.proofImage) {
      changed = true;
      return { ...task, proofImage: null };
    }
    return task;
  });

  if (changed) saveState();
}

function render() {
  refreshStatuses();
  expireOldImages();
  saveState();

  if (!state.selectedDateKey) state.selectedDateKey = todayKey();
  els.currentDateLabel.textContent = "7 day mobile trial";
  els.taskListTitle.textContent = formatDate(selectedDate());
  els.windowMinutes.value = String(state.settings.windowMinutes);
  els.retentionHours.value = String(state.settings.retentionHours);
  els.onlyTaggedEvents.checked = state.settings.onlyTaggedEvents;
  els.connectCalendarButton.textContent = state.calendarConnected ? "Sync Google Calendar" : "Connect Google Calendar";
  if (els.calendarStatus) {
    els.calendarStatus.textContent = state.calendarConnected ? calendarStatusText() : "Week trial";
  }

  renderStats();
  renderDailyProgress();
  renderWeekStrip();
  renderTasks();
  renderHistory();
}

function calendarStatusText() {
  if (!state.calendarLastSyncedAt) return "Calendar connected";
  return `Synced ${formatTime(new Date(state.calendarLastSyncedAt))}`;
}

function renderStats() {
  const dayTasks = tasksForSelectedDay();
  const completed = completedCount(dayTasks);
  const open = dayTasks.filter((task) => task.status === "open").length;
  const missed = dayTasks.filter((task) => task.status === "missed" || task.status === "skipped").length;

  els.completedCount.textContent = completed;
  els.openCount.textContent = open;
  if (els.missedCount) els.missedCount.textContent = missed;
  if (els.bestStreak) els.bestStreak.textContent = calculateBestStreak();
}

function completedCount(tasks) {
  return tasks.filter((task) => task.status === "completed" || task.status === "late").length;
}

function progressForTasks(tasks) {
  if (!tasks.length) return 0;
  return Math.round((completedCount(tasks) / tasks.length) * 100);
}

function renderDailyProgress() {
  const dayTasks = tasksForSelectedDay();
  const complete = completedCount(dayTasks);
  const percent = progressForTasks(dayTasks);
  const date = selectedDate();

  if (els.dailyProgressDate) els.dailyProgressDate.textContent = formatDate(date);
  els.dailyProgressPercent.textContent = `${percent}%`;
  els.dailyProgressPercent.closest(".progress-ring")?.style.setProperty("--progress", `${percent}%`);
}

function selectedDate() {
  return dateFromKey(state.selectedDateKey || todayKey());
}

function tasksForWeek() {
  const start = dateFromKey(state.weekStartKey || todayKey(weekStart()));
  const end = addDays(start, 7);
  return state.tasks.filter((task) => {
    const startAt = new Date(task.startAt);
    return startAt >= start && startAt < end;
  });
}

function tasksForSelectedDay() {
  return state.tasks.filter((task) => task.dateKey === state.selectedDateKey);
}

function renderWeekStrip() {
  const start = dateFromKey(state.weekStartKey || todayKey(weekStart()));
  els.weekStrip.innerHTML = "";

  for (let day = 0; day < 7; day += 1) {
    const date = addDays(start, day);
    const key = todayKey(date);
    const dayTasks = state.tasks.filter((task) => task.dateKey === key);
    const complete = completedCount(dayTasks);
    const isDone = dayTasks.length > 0 && complete === dayTasks.length;
    const isStarted = complete > 0 && !isDone;
    const button = document.createElement("button");
    button.className = "day-pill";
    button.classList.toggle("active", key === state.selectedDateKey);
    button.dataset.dateKey = key;
    button.innerHTML = `
      <span>${new Intl.DateTimeFormat([], { weekday: "short" }).format(date)}</span>
      <strong>${date.getDate()}</strong>
      <small class="${isDone ? "done" : isStarted ? "started" : ""}">${isDone ? "✓" : isStarted ? "•" : "○"}</small>
    `;
    els.weekStrip.appendChild(button);
  }
}

function calculateBestStreak() {
  const byTitle = new Map();

  for (const item of state.history) {
    if (item.status !== "completed" && item.status !== "late") continue;
    byTitle.set(item.title, (byTitle.get(item.title) || 0) + 1);
  }

  return Math.max(0, ...byTitle.values());
}

function renderTasks() {
  const tasks = [...tasksForSelectedDay()].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

  if (!tasks.length) {
    els.taskList.innerHTML = `<div class="empty-state">No proof windows for this day. Add one tiny promise when you are ready.</div>`;
    return;
  }

  els.taskList.innerHTML = "";
  for (const task of tasks) {
    const card = document.createElement("article");
    card.className = "task-card";
    card.dataset.id = task.id;

    const start = new Date(task.startAt);
    const due = new Date(task.dueAt);
    const status = task.status;

    card.innerHTML = `
      <div class="time-block">
        <strong>${formatTime(start)}</strong>
        <span>Due ${formatTime(due)}</span>
        <span class="status-pill status-${status}">${status}</span>
      </div>
      <div class="task-main">
        <h3>${escapeHtml(task.title)}</h3>
        <p>${escapeHtml(task.prompt)}</p>
        <p class="task-meta">${windowText(task)}</p>
      </div>
      <div class="photo-surface photo-${cardPhotoClass(task.title)}">
        ${task.proofImage ? `<img src="${task.proofImage}" alt="${escapeHtml(task.title)} proof" />` : ""}
      </div>
      <div class="card-footer">
        <span>${task.status === "open" ? "15 min left" : statusLabel(task)}</span>
        <i></i>
      </div>
    `;

    els.taskList.appendChild(card);
  }
}

function mergeCalendarTasks(calendarEvents) {
  const priorByCalendarId = new Map(state.tasks.map((task) => [task.calendarEventId, task]));
  const calendarTasks = calendarEvents
    .filter((event) => event.status !== "cancelled")
    .filter((event) => event.start?.dateTime || event.start?.date)
    .map((event) => createTaskFromCalendarEvent(event, priorByCalendarId.get(event.id)));

  const manualTasks = state.tasks.filter((task) => task.source !== "google-calendar" && task.source !== "demo");
  state.tasks = [...manualTasks, ...calendarTasks];
  state.calendarConnected = true;
  state.calendarLastSyncedAt = new Date().toISOString();
  saveState();
}

function cardPhotoClass(title) {
  const text = title.toLowerCase();
  if (text.includes("lunch") || text.includes("food")) return "food";
  if (text.includes("walk")) return "walk";
  if (text.includes("gym")) return "gym";
  if (text.includes("wake")) return "wake";
  return "calm";
}

function statusLabel(task) {
  if (task.status === "completed") return "complete";
  if (task.status === "late") return "late proof";
  if (task.status === "missed") return "missed";
  if (task.status === "skipped") return "skipped";
  return "proof due";
}

function windowText(task) {
  if (task.completedAt) {
    const completedAt = formatTime(new Date(task.completedAt));
    const expires = task.imageExpiresAt ? formatTime(new Date(task.imageExpiresAt)) : "soon";
    return `Completed at ${completedAt}. Photo expires at ${expires}.`;
  }
  if (task.status === "open") return "Proof window is open right now.";
  if (task.status === "missed") return "Window closed without photo proof.";
  if (task.status === "skipped") return "Skipped manually.";
  return `Window opens at ${formatTime(new Date(task.startAt))}.`;
}

function renderHistory() {
  if (!state.history.length) {
    els.historyList.innerHTML = `<div class="empty-state">Completed, late, skipped, and missed records will appear here.</div>`;
    return;
  }

  els.historyList.innerHTML = "";
  for (const item of [...state.history].reverse()) {
    const row = document.createElement("article");
    row.className = "history-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${formatDate(new Date(item.recordedAt))} · ${item.detail}</span>
      </div>
      <span class="status-pill status-${item.status}">${item.status}</span>
    `;
    els.historyList.appendChild(row);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function setView(viewName, activeItem = null) {
  els.navItems.forEach((item) => item.classList.toggle("active", item === activeItem || (!activeItem && item.dataset.view === viewName)));
  els.views.forEach((view) => view.classList.toggle("active", view.id === `${viewName}View`));
}

async function uploadProof(taskId, file) {
  if (!file) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;

  const image = await fileToDataUrl(file);
  const now = new Date();
  const expires = new Date(now.getTime() + state.settings.retentionHours * 60 * 60 * 1000);
  const completedStatus = now <= new Date(task.dueAt) ? "completed" : "late";

  Object.assign(task, {
    completedAt: now.toISOString(),
    proofImage: image,
    proofUploadedAt: now.toISOString(),
    imageExpiresAt: expires.toISOString(),
    skippedAt: null,
    status: completedStatus,
  });

  addHistory(task, completedStatus, `Photo uploaded at ${formatTime(now)}`);
  saveState();
  render();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function skipOrUndo(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;

  if (task.completedAt || task.skippedAt) {
    Object.assign(task, {
      completedAt: null,
      proofImage: null,
      proofUploadedAt: null,
      imageExpiresAt: null,
      skippedAt: null,
      status: statusForTask({ ...task, completedAt: null }),
    });
  } else {
    task.skippedAt = new Date().toISOString();
    task.status = "skipped";
    addHistory(task, "skipped", "Skipped manually");
  }

  saveState();
  render();
}

function addHistory(task, status, detail) {
  state.history.push({
    id: crypto.randomUUID(),
    taskId: task.id,
    calendarEventId: task.calendarEventId,
    title: task.title,
    status,
    detail,
    scheduledAt: task.startAt,
    dueAt: task.dueAt,
    recordedAt: new Date().toISOString(),
  });
}

function initializeGoogleCalendar() {
  if (!window.google?.accounts?.oauth2 || googleTokenClient) return Boolean(googleTokenClient);

  googleTokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_CALENDAR_SCOPE,
    callback: async (response) => {
      if (response.error) {
        showCalendarError(response.error);
        return;
      }

      googleAccessToken = response.access_token;
      await syncCalendarEvents();
    },
  });

  return true;
}

function requestGoogleCalendarAccess() {
  if (!initializeGoogleCalendar()) {
    showCalendarError("Google sign-in is still loading. Try again in a moment.");
    return;
  }

  googleTokenClient.requestAccessToken({ prompt: googleAccessToken ? "" : "consent" });
}

async function syncCalendar() {
  if (!googleAccessToken) {
    requestGoogleCalendarAccess();
    return;
  }

  await syncCalendarEvents();
}

async function syncCalendarEvents() {
  try {
    setCalendarBusy(true);
    const start = dateFromKey(state.weekStartKey || todayKey(weekStart()));
    const end = addDays(start, 7);
    const events = await fetchCalendarEvents(start, end);
    mergeCalendarTasks(events);
    render();
  } catch (error) {
    showCalendarError(error.message || "Calendar sync failed.");
  } finally {
    setCalendarBusy(false);
  }
}

async function fetchCalendarEvents(start, end) {
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    maxResults: "100",
  });

  const response = await fetch(`${GOOGLE_DISCOVERY_ORIGIN}/calendars/primary/events?${params}`, {
    headers: {
      Authorization: `Bearer ${googleAccessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Could not fetch Google Calendar.");
  }

  return data.items || [];
}

function setCalendarBusy(isBusy) {
  els.connectCalendarButton.disabled = isBusy;
  els.syncCalendarButton.disabled = isBusy;
  els.connectCalendarButton.textContent = isBusy ? "Syncing..." : state.calendarConnected ? "Sync Google Calendar" : "Connect Google Calendar";
}

function showCalendarError(message) {
  if (els.calendarStatus) els.calendarStatus.textContent = "Calendar error";
  els.connectCalendarButton.textContent = "Try Google Calendar again";
  alert(message);
}

els.navItems.forEach((item) => {
  if (item.dataset.view) item.addEventListener("click", () => setView(item.dataset.view, item));
});
els.seedTodayButton.addEventListener("click", () => {
  seedWeek(true);
  render();
});
els.syncCalendarButton.addEventListener("click", syncCalendar);
els.connectCalendarButton.addEventListener("click", requestGoogleCalendarAccess);
function promptForProofUpload() {
  const task = tasksForSelectedDay().find((item) => !item.completedAt && !item.skippedAt) || tasksForSelectedDay()[0];
  if (!task) return;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.capture = "environment";
  input.addEventListener("change", () => uploadProof(task.id, input.files[0]), { once: true });
  input.click();
}

document.querySelectorAll("[data-upload-proof]").forEach((button) => {
  button.addEventListener("click", promptForProofUpload);
});
els.eventForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter?.value === "cancel") {
    els.eventDialog.close();
    return;
  }

  state.tasks.push(createTask({
    title: els.eventTitle.value.trim(),
    time: els.eventTime.value,
    prompt: els.eventPrompt.value.trim(),
  }, Date.now(), selectedDate()));
  saveState();
  els.eventDialog.close();
  render();
});
els.weekStrip.addEventListener("click", (event) => {
  const button = event.target.closest("[data-date-key]");
  if (!button) return;
  state.selectedDateKey = button.dataset.dateKey;
  saveState();
  render();
});
els.taskList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-upload]");
  if (input) uploadProof(input.dataset.upload, input.files[0]);
});
els.taskList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-skip]");
  if (button) skipOrUndo(button.dataset.skip);
});
els.windowMinutes.addEventListener("change", () => {
  state.settings.windowMinutes = Number(els.windowMinutes.value);
  state.tasks = state.tasks.map((task) => {
    const dueAt = new Date(new Date(task.startAt).getTime() + state.settings.windowMinutes * 60 * 1000).toISOString();
    return { ...task, dueAt };
  });
  saveState();
  render();
});
els.retentionHours.addEventListener("change", () => {
  state.settings.retentionHours = Number(els.retentionHours.value);
  saveState();
});
els.onlyTaggedEvents.addEventListener("change", () => {
  state.settings.onlyTaggedEvents = els.onlyTaggedEvents.checked;
  saveState();
});
els.clearHistoryButton.addEventListener("click", () => {
  state.history = [];
  saveState();
  render();
});

seedWeek();
render();
setInterval(render, 60 * 1000);
window.addEventListener("load", initializeGoogleCalendar);
