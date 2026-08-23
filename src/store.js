const KEYS = Object.freeze({
  sessions: "smart-marketing-assistant:sessions:v1",
  activeTask: "smart-marketing-assistant:active-task:v1",
  draft: "smart-marketing-assistant:draft:v1",
  mockTasks: "smart-marketing-assistant:mock-tasks:v1"
});

function safeParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function storageAvailable() {
  try {
    const key = "__storage_test__";
    localStorage.setItem(key, key);
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

const canStore = typeof localStorage !== "undefined" && storageAvailable();

export const store = {
  keys: KEYS,

  getSessions() {
    if (!canStore) return [];
    const value = safeParse(localStorage.getItem(KEYS.sessions), []);
    return Array.isArray(value) ? value : [];
  },

  saveSessions(sessions) {
    if (!canStore) return;
    localStorage.setItem(KEYS.sessions, JSON.stringify(sessions));
  },

  getActiveTask() {
    if (!canStore) return null;
    return safeParse(localStorage.getItem(KEYS.activeTask), null);
  },

  saveActiveTask(task) {
    if (!canStore) return;
    if (!task) localStorage.removeItem(KEYS.activeTask);
    else localStorage.setItem(KEYS.activeTask, JSON.stringify(task));
  },

  getDraft() {
    if (!canStore) return null;
    return safeParse(localStorage.getItem(KEYS.draft), null);
  },

  saveDraft(draft) {
    if (!canStore) return;
    localStorage.setItem(KEYS.draft, JSON.stringify(draft));
  },

  getMockTasks() {
    if (!canStore) return {};
    return safeParse(localStorage.getItem(KEYS.mockTasks), {});
  },

  saveMockTasks(tasks) {
    if (!canStore) return;
    localStorage.setItem(KEYS.mockTasks, JSON.stringify(tasks));
  },

  clearAll() {
    if (!canStore) return;
    Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
  },

  /**
   * Keep the two starter demo sessions at the front of history, as if already generated.
   * Always refreshes demo payloads so asset/path updates apply for returning users.
   */
  ensureDemoSessions(demoSessions) {
    const demos = Array.isArray(demoSessions) ? demoSessions : [];
    if (!demos.length) return this.getSessions();
    const demoIds = new Set(demos.map((item) => item.sessionId));
    const others = this.getSessions().filter((item) => !demoIds.has(item.sessionId) && !String(item.sessionId || "").startsWith("demo-session-"));
    const next = [...demos, ...others];
    this.saveSessions(next);
    return next;
  }
};
