import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useApp, useApi } from "../store/context";

export function useTimer() {
  const { state, dispatch } = useApp();
  const api = useApi();
  const { timer, employee } = state;
  const [elapsed, setElapsed] = useState(0); // seconds
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Local counter for the in-app timer view. The tray clock is driven by Rust
  // because WebKit throttles setInterval when the window is hidden.
  useEffect(() => {
    if (timer.isRunning && timer.startTime) {
      const updateElapsed = () => {
        const start = new Date(timer.startTime!).getTime();
        setElapsed(Math.floor((Date.now() - start) / 1000));
      };
      updateElapsed();
      intervalRef.current = setInterval(updateElapsed, 1000);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
    setElapsed(0);
  }, [timer.isRunning, timer.startTime]);

  /** Stop the running timer and save elapsed minutes to the entry. */
  const stop = useCallback(async () => {
    if (!timer.isRunning || !timer.startTime || !employee) return;

    const { projectId, taskId, startTime } = timer;
    const endTime = new Date().toISOString();
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const minutes = Math.max(1, Math.round((endMs - startMs) / 60000));
    const startLocal = new Date(startMs);
    const date = `${startLocal.getFullYear()}-${String(startLocal.getMonth() + 1).padStart(2, "0")}-${String(startLocal.getDate()).padStart(2, "0")}`;
    const project = state.projects.find((p) => p.id === projectId);
    const openingId = projectId ? state.projectOpeningMap[projectId] : undefined;

    // Reset timer immediately so user can start a new one
    dispatch({ type: "RESET_TIMER" });

    // Find the existing entry for this card — it should exist since we only
    // show play buttons on cards that already have an entry.
    const existing = state.entries.find(
      (e) => e.projectId === projectId && (e.taskId ?? null) === (taskId ?? null) && e.date === date
    );

    let workingId: string;
    const description = existing?.description ?? "";

    if (existing) {
      workingId = existing.id;
      dispatch({
        type: "UPDATE_ENTRY",
        payload: {
          id: existing.id,
          updates: {
            minutes: existing.minutes + minutes,
            endTime,
            syncStatus: "pending",
          },
        },
      });
    } else {
      // Edge case: entry was deleted while timer was running
      workingId = crypto.randomUUID();
      dispatch({
        type: "ADD_ENTRY",
        payload: {
          id: workingId,
          description,
          projectId: projectId!,
          projectName: project?.name,
          openingId,
          taskId: taskId ?? undefined,
          date,
          startTime,
          endTime,
          minutes,
          status: "SAVED",
          syncStatus: "pending",
        },
      });
    }

    try {
      const created = await api.createTimeEntry(employee.id, {
        description,
        projectId: projectId!,
        projectName: project?.name,
        openingId,
        taskId: taskId ?? undefined,
        date,
        startTime,
        endTime,
        minutes,
        status: "SAVED",
      });
      dispatch({
        type: "UPDATE_ENTRY",
        payload: {
          id: workingId,
          updates: {
            id: created.id,
            description: created.description,
            minutes: created.minutes,
            status: created.status,
            syncStatus: "synced",
          },
        },
      });
    } catch (err) {
      dispatch({
        type: "UPDATE_ENTRY",
        payload: { id: workingId, updates: { syncStatus: "unsaved" } },
      });
      const reason = err instanceof Error ? err.message : "Unknown error";
      dispatch({
        type: "SET_ERROR",
        payload: `Failed to save time entry: ${reason}. Entry saved locally — use retry to sync.`,
      });
    }
  }, [timer, employee, state.projects, state.projectOpeningMap, state.entries, dispatch, api]);

  // Use a ref so startForCard always invokes the latest stop closure
  const stopRef = useRef(stop);
  stopRef.current = stop;

  /** Start the timer for a specific card (projectId + taskId). Stops any running timer first. */
  const startForCard = useCallback(
    async (projectId: string, taskId: string) => {
      // Stop any currently running timer before starting a new one
      await stopRef.current();
      dispatch({
        type: "SET_TIMER",
        payload: {
          projectId,
          taskId,
          isRunning: true,
          startTime: new Date().toISOString(),
        },
      });
    },
    [dispatch]
  );

  const continueLastTask = useCallback(() => {
    if (timer.isRunning) return;
    const latest = state.entries.reduce<(typeof state.entries)[number] | null>(
      (best, e) => (best === null || e.startTime > best.startTime ? e : best),
      null
    );
    if (!latest || !latest.taskId) return;
    dispatch({
      type: "SET_TIMER",
      payload: {
        projectId: latest.projectId,
        taskId: latest.taskId,
        isRunning: true,
        startTime: new Date().toISOString(),
      },
    });
  }, [dispatch, state.entries, timer.isRunning]);

  // Tray menu Continue/Stop buttons emit these events; keep refs so we register
  // the listeners only once but always invoke the latest closure.
  const continueLastRef = useRef(continueLastTask);
  continueLastRef.current = continueLastTask;

  useEffect(() => {
    const unlistenStop = listen("tray-stop-timer", () => {
      void stopRef.current();
    });
    const unlistenContinue = listen("tray-continue-last", () => {
      continueLastRef.current();
    });
    return () => {
      unlistenStop.then((fn) => fn()).catch(() => {});
      unlistenContinue.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return {
    isRunning: timer.isRunning,
    projectId: timer.projectId,
    taskId: timer.taskId,
    elapsed,
    startForCard,
    stop,
  };
}

export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}:00`;
}
