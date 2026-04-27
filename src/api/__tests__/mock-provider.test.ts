import { describe, it, expect, beforeEach } from "vitest";
import {
  createMockProvider,
  MOCK_PROJECTS,
  MOCK_TASKS,
  MOCK_EMPLOYEE,
  type EntryStore,
} from "../mock-core";
import type { ApiProvider } from "../provider";
import type { TimeEntry } from "../types";

function createInMemoryStore(): EntryStore {
  let entries: TimeEntry[] = [];
  return {
    async getEntries() {
      return [...entries];
    },
    async setEntries(newEntries: TimeEntry[]) {
      entries = [...newEntries];
    },
  };
}

function makeEntry(overrides: Partial<TimeEntry> = {}): Omit<TimeEntry, "id" | "syncStatus"> {
  return {
    description: "test work",
    projectId: "p1",
    date: "2026-04-24",
    startTime: "2026-04-24T09:00:00.000Z",
    endTime: "2026-04-24T10:00:00.000Z",
    minutes: 60,
    status: "SAVED",
    ...overrides,
  };
}

let provider: ApiProvider;
let store: EntryStore;

beforeEach(() => {
  store = createInMemoryStore();
  provider = createMockProvider(store, MOCK_PROJECTS, MOCK_TASKS, MOCK_EMPLOYEE);
});

// --- AC-38: Every ApiProvider method has tests for success and error ---

describe("getCurrentEmployee", () => {
  it("returns the mock employee", async () => {
    const employee = await provider.getCurrentEmployee();
    expect(employee).toEqual(MOCK_EMPLOYEE);
    expect(employee.id).toBe("emp1");
    expect(employee.email).toBe("test@qte.se");
  });
});

// --- AC-40: getProjects only returns projects ---

describe("getProjects", () => {
  it("returns all mock projects", async () => {
    const projects = await provider.getProjects();
    expect(projects).toHaveLength(5);
    expect(projects.map((p) => p.name)).toEqual([
      "Fokus",
      "DHL - PIL",
      "maverick",
      "KBV",
      "QTE - möten",
    ]);
  });

  it("every project has required fields", async () => {
    const projects = await provider.getProjects();
    for (const p of projects) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.color).toBeTruthy();
    }
  });

  it("does not return tasks, entries, or employees", async () => {
    const projects = await provider.getProjects();
    for (const p of projects) {
      expect(p).not.toHaveProperty("billable");
      expect(p).not.toHaveProperty("minutes");
      expect(p).not.toHaveProperty("email");
    }
  });
});

// --- AC-45: getTasks only returns tasks for the requested project ---

describe("getTasks", () => {
  it("returns tasks for a specific project", async () => {
    const tasks = await provider.getTasks("p1");
    expect(tasks).toHaveLength(3);
    for (const t of tasks) {
      expect(t.projectId).toBe("p1");
    }
  });

  it("does not return tasks from other projects", async () => {
    const tasks = await provider.getTasks("p2");
    expect(tasks).toHaveLength(2);
    for (const t of tasks) {
      expect(t.projectId).toBe("p2");
      expect(t.projectId).not.toBe("p1");
    }
  });

  it("returns empty array for unknown project", async () => {
    const tasks = await provider.getTasks("nonexistent");
    expect(tasks).toEqual([]);
  });

  it("every task has required fields", async () => {
    const tasks = await provider.getTasks("p1");
    for (const t of tasks) {
      expect(t.id).toBeTruthy();
      expect(t.projectId).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(typeof t.billable).toBe("boolean");
      expect(typeof t.active).toBe("boolean");
    }
  });
});

// --- AC-41: getTimeEntries filters strictly by date range ---

describe("getTimeEntries", () => {
  beforeEach(async () => {
    // Seed entries across different dates
    await provider.createTimeEntry("emp1", makeEntry({ date: "2026-04-22" }));
    await provider.createTimeEntry("emp1", makeEntry({ date: "2026-04-23" }));
    await provider.createTimeEntry("emp1", makeEntry({ date: "2026-04-24" }));
    await provider.createTimeEntry("emp1", makeEntry({ date: "2026-04-25" }));
    await provider.createTimeEntry("emp1", makeEntry({ date: "2026-04-26" }));
  });

  it("returns only entries within the date range", async () => {
    const entries = await provider.getTimeEntries("emp1", "2026-04-23", "2026-04-25");
    expect(entries).toHaveLength(3);
    for (const e of entries) {
      expect(e.date >= "2026-04-23").toBe(true);
      expect(e.date <= "2026-04-25").toBe(true);
    }
  });

  it("excludes entries before the start date", async () => {
    const entries = await provider.getTimeEntries("emp1", "2026-04-24", "2026-04-26");
    const dates = entries.map((e) => e.date);
    expect(dates).not.toContain("2026-04-22");
    expect(dates).not.toContain("2026-04-23");
  });

  it("excludes entries after the end date", async () => {
    const entries = await provider.getTimeEntries("emp1", "2026-04-22", "2026-04-23");
    const dates = entries.map((e) => e.date);
    expect(dates).not.toContain("2026-04-24");
    expect(dates).not.toContain("2026-04-25");
    expect(dates).not.toContain("2026-04-26");
  });

  it("returns empty array when no entries in range", async () => {
    const entries = await provider.getTimeEntries("emp1", "2026-05-01", "2026-05-31");
    expect(entries).toEqual([]);
  });

  it("returns entries for exact single-day range", async () => {
    const entries = await provider.getTimeEntries("emp1", "2026-04-24", "2026-04-24");
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe("2026-04-24");
  });
});

// --- AC-42: createTimeEntry requires mandatory fields and rejects incomplete input ---

describe("createTimeEntry", () => {
  it("creates an entry with all fields", async () => {
    const input = makeEntry();
    const created = await provider.createTimeEntry("emp1", input);

    expect(created.id).toBeTruthy();
    expect(created.description).toBe("test work");
    expect(created.projectId).toBe("p1");
    expect(created.date).toBe("2026-04-24");
    expect(created.minutes).toBe(60);
    expect(created.status).toBe("SAVED");
    expect(created.syncStatus).toBe("synced");
  });

  it("generates a unique ID for each entry", async () => {
    const a = await provider.createTimeEntry("emp1", makeEntry());
    const b = await provider.createTimeEntry("emp1", makeEntry());
    expect(a.id).not.toBe(b.id);
  });

  it("persists the entry to the store", async () => {
    await provider.createTimeEntry("emp1", makeEntry());
    const entries = await store.getEntries();
    expect(entries).toHaveLength(1);
  });

  it("does not modify other existing entries", async () => {
    const first = await provider.createTimeEntry("emp1", makeEntry({ description: "first" }));
    await provider.createTimeEntry("emp1", makeEntry({ description: "second" }));
    const entries = await store.getEntries();
    const firstInStore = entries.find((e) => e.id === first.id);
    expect(firstInStore?.description).toBe("first");
  });
});

// --- AC-43: updateTimeEntry only modifies the specified entry ---

describe("updateTimeEntry", () => {
  it("updates only the specified entry", async () => {
    const a = await provider.createTimeEntry("emp1", makeEntry({ description: "entry A" }));
    const b = await provider.createTimeEntry("emp1", makeEntry({ description: "entry B" }));

    await provider.updateTimeEntry("emp1", a.id, { description: "updated A" });

    const entries = await store.getEntries();
    const updatedA = entries.find((e) => e.id === a.id);
    const untouchedB = entries.find((e) => e.id === b.id);

    expect(updatedA?.description).toBe("updated A");
    expect(untouchedB?.description).toBe("entry B");
  });

  it("returns the updated entry", async () => {
    const created = await provider.createTimeEntry("emp1", makeEntry());
    const updated = await provider.updateTimeEntry("emp1", created.id, {
      description: "new desc",
      minutes: 120,
    });

    expect(updated.description).toBe("new desc");
    expect(updated.minutes).toBe(120);
    expect(updated.id).toBe(created.id);
  });

  it("preserves fields not included in the update", async () => {
    const created = await provider.createTimeEntry(
      "emp1",
      makeEntry({
        description: "original",
        projectId: "p1",
        minutes: 60,
      })
    );

    const updated = await provider.updateTimeEntry("emp1", created.id, {
      description: "changed",
    });

    expect(updated.projectId).toBe("p1");
    expect(updated.minutes).toBe(60);
  });

  it("throws for non-existent entry ID", async () => {
    await expect(
      provider.updateTimeEntry("emp1", "nonexistent-id", { description: "x" })
    ).rejects.toThrow("Entry nonexistent-id not found");
  });

  it("does not create a new entry on update", async () => {
    const created = await provider.createTimeEntry("emp1", makeEntry());
    await provider.updateTimeEntry("emp1", created.id, { description: "updated" });
    const entries = await store.getEntries();
    expect(entries).toHaveLength(1);
  });
});

// --- AC-44: deleteTimeEntry only removes specified IDs ---

describe("deleteTimeEntry", () => {
  it("deletes only the specified entry", async () => {
    const a = await provider.createTimeEntry("emp1", makeEntry({ description: "keep" }));
    const b = await provider.createTimeEntry("emp1", makeEntry({ description: "delete" }));

    await provider.deleteTimeEntry([b.id]);

    const entries = await store.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(a.id);
    expect(entries[0].description).toBe("keep");
  });

  it("deletes multiple entries by IDs", async () => {
    const a = await provider.createTimeEntry("emp1", makeEntry({ description: "del1" }));
    const b = await provider.createTimeEntry("emp1", makeEntry({ description: "keep" }));
    const c = await provider.createTimeEntry("emp1", makeEntry({ description: "del2" }));

    await provider.deleteTimeEntry([a.id, c.id]);

    const entries = await store.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(b.id);
  });

  it("does not delete entries with non-matching IDs", async () => {
    await provider.createTimeEntry("emp1", makeEntry());
    await provider.createTimeEntry("emp1", makeEntry());

    await provider.deleteTimeEntry(["nonexistent-id"]);

    const entries = await store.getEntries();
    expect(entries).toHaveLength(2);
  });

  it("handles empty ID array gracefully", async () => {
    await provider.createTimeEntry("emp1", makeEntry());
    await provider.deleteTimeEntry([]);
    const entries = await store.getEntries();
    expect(entries).toHaveLength(1);
  });
});

// --- AC-46: No provider method exposes data from other employees ---

describe("data isolation", () => {
  it("getCurrentEmployee returns only the configured employee", async () => {
    const emp = await provider.getCurrentEmployee();
    expect(emp.id).toBe("emp1");
    // Should not return a list or other employees' data
    expect(Array.isArray(emp)).toBe(false);
  });

  it("entries created by one employeeId are visible to all (mock limitation)", async () => {
    // In mock mode, employeeId is ignored for simplicity.
    // This test documents the behavior and ensures the real provider
    // will need to enforce scoping.
    await provider.createTimeEntry("emp1", makeEntry());
    const entries = await provider.getTimeEntries("emp2", "2026-04-01", "2026-04-30");
    // Mock doesn't filter by employeeId — this is expected.
    // The real AgileDay provider filters server-side.
    expect(entries).toHaveLength(1);
  });
});

// --- AC-47: Error handling — failed calls throw properly ---

describe("error handling", () => {
  it("updateTimeEntry throws on missing entry", async () => {
    await expect(provider.updateTimeEntry("emp1", "bad-id", {})).rejects.toThrow();
  });

  it("updateTimeEntry error does not corrupt store", async () => {
    const created = await provider.createTimeEntry("emp1", makeEntry());

    try {
      await provider.updateTimeEntry("emp1", "bad-id", {});
    } catch {
      // expected
    }

    const entries = await store.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(created.id);
    expect(entries[0].description).toBe("test work");
  });

  it("createTimeEntry with store failure propagates error", async () => {
    const failingStore: EntryStore = {
      async getEntries() {
        return [];
      },
      async setEntries() {
        throw new Error("Store write failed");
      },
    };
    const failProvider = createMockProvider(failingStore, MOCK_PROJECTS, MOCK_TASKS, MOCK_EMPLOYEE);

    await expect(failProvider.createTimeEntry("emp1", makeEntry())).rejects.toThrow(
      "Store write failed"
    );
  });

  it("deleteTimeEntry with store failure propagates error", async () => {
    const failingStore: EntryStore = {
      async getEntries() {
        return [];
      },
      async setEntries() {
        throw new Error("Store write failed");
      },
    };
    const failProvider = createMockProvider(failingStore, MOCK_PROJECTS, MOCK_TASKS, MOCK_EMPLOYEE);

    await expect(failProvider.deleteTimeEntry(["any-id"])).rejects.toThrow("Store write failed");
  });
});
