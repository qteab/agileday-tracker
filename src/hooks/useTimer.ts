import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp, useApi } from "../store/context";

export function useTimer() {
  const { state, dispatch } = useApp();
  const api = useApi();
  const { timer, employee } = state;
  const [elapsed, setElapsed] = useState(0); // seconds
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update elapsed time every second based on timestamp (no drift)
  useEffect(() => {
    if (timer.isRunning && timer.startTime) {
      const updateElapsed = () => {
        const start = new Date(timer.startTime!).getTime();
        const seconds = Math.floor((Date.now() - start) / 1000);
        setElapsed(seconds);
        invoke("set_timer_status", {
          running: true,
          elapsedText: formatTime(seconds),
        }).catch(() => {});
      };
      updateElapsed();
      intervalRef.current = setInterval(updateElapsed, 1000);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else {
      setElapsed(0);
      invoke("set_timer_status", { running: false, elapsedText: null }).catch(() => {});
    }
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

    // 1. Always add individual session to local state (for the UI)
    const localEntry = {
      id: crypto.randomUUID(),
      description,
      projectId: projectId!,
      projectName: project?.name,
      openingId,
      taskId: taskId ?? undefined,
      date,
      startTime,
      endTime,
      minutes,
      status: "SAVED" as const,
      syncStatus: "pending" as const,
    };
    dispatch({ type: "ADD_ENTRY", payload: localEntry });

    try {
      // Send only THIS session's minutes — the provider handles
      // finding existing entries and adding to their total
      await api.createTimeEntry(employee.id, {
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
        payload: { id: localEntry.id, updates: { syncStatus: "synced" } },
      });
    } catch (err) {
      dispatch({
        type: "UPDATE_ENTRY",
        payload: { id: localEntry.id, updates: { syncStatus: "unsaved" } },
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
