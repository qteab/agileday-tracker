import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useApp, useApi } from "../store/context";
import { mergeDescriptions } from "../api/agileday";

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

  const start = useCallback(() => {
    if (!timer.projectId || !timer.taskId) return;
    dispatch({
      type: "SET_TIMER",
      payload: {
        isRunning: true,
        startTime: new Date().toISOString(),
      },
    });
  }, [dispatch, timer.projectId, timer.taskId]);

  const stop = useCallback(async () => {
    if (!timer.isRunning || !timer.startTime || !employee) return;

    // Capture timer state before resetting
    const { description, projectId, taskId, startTime } = timer;
    const endTime = new Date().toISOString();
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const minutes = Math.max(1, Math.round((endMs - startMs) / 60000));
    // Use local date, not UTC
    const startLocal = new Date(startMs);
    const date = `${startLocal.getFullYear()}-${String(startLocal.getMonth() + 1).padStart(2, "0")}-${String(startLocal.getDate()).padStart(2, "0")}`;
    const project = state.projects.find((p) => p.id === projectId);
    const openingId = projectId ? state.projectOpeningMap[projectId] : undefined;

    // Reset timer immediately so user can start a new one
    dispatch({ type: "RESET_TIMER" });

    // Merge-or-add: one local row per (projectId, taskId, date), mirroring AgileDay.
    const existing = state.entries.find(
      (e) => e.projectId === projectId && (e.taskId ?? null) === (taskId ?? null) && e.date === date
    );

    let workingId: string;
    if (existing) {
      workingId = existing.id;
      dispatch({
        type: "UPDATE_ENTRY",
        payload: {
          id: existing.id,
          updates: {
            description: description
              ? mergeDescriptions(existing.description, description)
              : existing.description,
            minutes: existing.minutes + minutes,
            endTime,
            syncStatus: "pending",
          },
        },
      });
    } else {
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
      // Send only THIS session's minutes — the provider handles
      // finding existing AgileDay entries and adding to their total
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
      // Adopt the real AgileDay id and authoritative description/minutes so the
      // local row stays 1:1 with the server.
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
  }, [timer, employee, state.projects, state.projectOpeningMap, dispatch, api]);

  const setDescription = useCallback(
    (description: string) => {
      dispatch({ type: "SET_TIMER", payload: { description } });
    },
    [dispatch]
  );

  const setProject = useCallback(
    (projectId: string) => {
      dispatch({ type: "SET_TIMER", payload: { projectId, taskId: null } });
    },
    [dispatch]
  );

  const setTask = useCallback(
    (taskId: string | null) => {
      dispatch({ type: "SET_TIMER", payload: { taskId } });
    },
    [dispatch]
  );

  const setElapsedSeconds = useCallback(
    (seconds: number) => {
      if (!timer.isRunning) return;
      const newStart = new Date(Date.now() - seconds * 1000).toISOString();
      dispatch({ type: "SET_TIMER", payload: { startTime: newStart } });
    },
    [dispatch, timer.isRunning]
  );

  const continueLastTask = useCallback(() => {
    if (timer.isRunning) return;
    const latest = state.entries.reduce<(typeof state.entries)[number] | null>(
      (best, e) => (best === null || e.startTime > best.startTime ? e : best),
      null
    );
    if (!latest) return;
    dispatch({
      type: "SET_TIMER",
      payload: {
        description: latest.description,
        projectId: latest.projectId,
        taskId: latest.taskId ?? null,
        isRunning: true,
        startTime: new Date().toISOString(),
      },
    });
  }, [dispatch, state.entries, timer.isRunning]);

  // Tray menu Continue/Stop buttons emit these events; keep refs so we register
  // the listeners only once but always invoke the latest closure.
  const stopRef = useRef(stop);
  const continueLastRef = useRef(continueLastTask);
  stopRef.current = stop;
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
    description: timer.description,
    projectId: timer.projectId,
    taskId: timer.taskId,
    elapsed,
    start,
    stop,
    setDescription,
    setProject,
    setTask,
    setElapsedSeconds,
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
