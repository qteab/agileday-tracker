import { describe, it, expect, beforeEach, vi } from "vitest";
import type { GlobalTaskFetch } from "../global-tasks";
import { createGlobalDefaultTaskLoader, GLOBAL_TASK_PAGE_SIZE } from "../global-tasks";

type RawPage = {
  data: Array<Record<string, unknown>>;
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

function page(
  data: Array<Record<string, unknown>>,
  pageNumber: number,
  totalPages: number
): RawPage {
  return {
    data,
    pagination: {
      page: pageNumber,
      pageSize: GLOBAL_TASK_PAGE_SIZE,
      totalItems: totalPages * GLOBAL_TASK_PAGE_SIZE,
      totalPages,
    },
  };
}

const GLOBAL_DEV = {
  id: "27717b20",
  name: "Development",
  projectId: null,
  active: false,
  billable: true,
  defaultTemplate: true,
};

// A template that is NOT a default — must be ignored.
const GLOBAL_QA = {
  id: "df1942e0",
  name: "QA",
  projectId: null,
  active: false,
  billable: true,
  defaultTemplate: false,
};

// defaultTemplate:true but owned by a project — must be ignored. 314 of these
// exist in the real tenant, so filtering on defaultTemplate alone is wrong.
const PROJECT_OWNED_DEFAULT = {
  id: "9abbf7e9",
  name: "Backend Development",
  projectId: "some-other-project",
  active: true,
  billable: true,
  defaultTemplate: true,
};

describe("createGlobalDefaultTaskLoader", () => {
  let apiFetch: ReturnType<typeof vi.fn<GlobalTaskFetch>>;

  beforeEach(() => {
    apiFetch = vi.fn<GlobalTaskFetch>();
  });

  it("issues no request until it is called", () => {
    createGlobalDefaultTaskLoader(apiFetch);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("keeps only tasks with projectId === null && defaultTemplate === true", async () => {
    apiFetch.mockResolvedValueOnce(page([GLOBAL_DEV, GLOBAL_QA, PROJECT_OWNED_DEFAULT], 1, 1));

    const load = createGlobalDefaultTaskLoader(apiFetch);
    const tasks = await load();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "27717b20",
      name: "Development",
      defaultTemplate: true,
      billable: true,
    });
  });

  it("preserves a global default whose active flag is false", async () => {
    apiFetch.mockResolvedValueOnce(page([GLOBAL_DEV], 1, 1));

    const tasks = await createGlobalDefaultTaskLoader(apiFetch)();

    // The only real template is active:false and AgileDay's web UI still
    // offers it — active must not gate global defaults.
    expect(tasks).toHaveLength(1);
    expect(tasks[0].active).toBe(true);
  });

  it("pages through every page, fetching pages after the first in parallel", async () => {
    apiFetch
      .mockResolvedValueOnce(page([GLOBAL_QA], 1, 3))
      .mockResolvedValueOnce(page([PROJECT_OWNED_DEFAULT], 2, 3))
      .mockResolvedValueOnce(page([GLOBAL_DEV], 3, 3));

    const tasks = await createGlobalDefaultTaskLoader(apiFetch)();

    expect(apiFetch).toHaveBeenCalledTimes(3);
    const paths = apiFetch.mock.calls.map((c) => c[0] as string);
    expect(paths[0]).toContain(`limit=${GLOBAL_TASK_PAGE_SIZE}&offset=0`);
    expect(paths[1]).toContain(`offset=${GLOBAL_TASK_PAGE_SIZE}`);
    expect(paths[2]).toContain(`offset=${GLOBAL_TASK_PAGE_SIZE * 2}`);
    expect(tasks.map((t) => t.id)).toEqual(["27717b20"]);
  });

  it("deduplicates a task that appears on more than one page", async () => {
    // /v2/task has no deterministic sort (sortBy is ignored by the API) and the
    // pages are fetched in parallel, so a row can shift between pages and land
    // in two responses. Without dedupe React sees duplicate keys.
    apiFetch
      .mockResolvedValueOnce(page([GLOBAL_DEV], 1, 2))
      .mockResolvedValueOnce(page([GLOBAL_DEV], 2, 2));

    const tasks = await createGlobalDefaultTaskLoader(apiFetch)();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("27717b20");
  });

  it("deduplicates duplicates within a single page", async () => {
    apiFetch.mockResolvedValueOnce(page([GLOBAL_DEV, GLOBAL_DEV], 1, 1));

    const tasks = await createGlobalDefaultTaskLoader(apiFetch)();

    expect(tasks).toHaveLength(1);
  });

  it("keeps distinct global defaults when several exist", async () => {
    const other = { ...GLOBAL_DEV, id: "other-global", name: "Consulting" };
    apiFetch.mockResolvedValueOnce(page([GLOBAL_DEV, other], 1, 1));

    const tasks = await createGlobalDefaultTaskLoader(apiFetch)();

    expect(tasks.map((t) => t.id)).toEqual(["27717b20", "other-global"]);
  });

  it("memoises across callers — two concurrent callers share one request burst", async () => {
    apiFetch.mockResolvedValue(page([GLOBAL_DEV], 1, 1));

    const load = createGlobalDefaultTaskLoader(apiFetch);
    const [a, b] = await Promise.all([load(), load()]);

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("memoises across sequential callers", async () => {
    apiFetch.mockResolvedValue(page([GLOBAL_DEV], 1, 1));

    const load = createGlobalDefaultTaskLoader(apiFetch);
    await load();
    await load();

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("resolves to [] and never throws when /v2/task fails", async () => {
    apiFetch.mockRejectedValueOnce(new Error("500 Internal Server Error"));

    await expect(createGlobalDefaultTaskLoader(apiFetch)()).resolves.toEqual([]);
  });

  it("resolves to [] when the envelope has an unexpected shape", async () => {
    apiFetch.mockResolvedValueOnce({ unexpected: true });

    await expect(createGlobalDefaultTaskLoader(apiFetch)()).resolves.toEqual([]);
  });

  it("resolves to [] when a later page fails, keeping the failure contained", async () => {
    apiFetch
      .mockResolvedValueOnce(page([GLOBAL_DEV], 1, 2))
      .mockRejectedValueOnce(new Error("boom"));

    await expect(createGlobalDefaultTaskLoader(apiFetch)()).resolves.toEqual([]);
  });

  it("allows a retry after a failed attempt", async () => {
    apiFetch
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(page([GLOBAL_DEV], 1, 1));

    const load = createGlobalDefaultTaskLoader(apiFetch);
    expect(await load()).toEqual([]);
    expect(await load()).toHaveLength(1);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
