import { useState, useEffect, useCallback, useRef } from "react";
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
        setElapsed(Math.floor((Date.now() - start) / 1000));
      };
      updateElapsed();
      intervalRef.current = setInterval(updateElapsed, 1000);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else {
      setElapsed(0);
    }
  }, [timer.isRunning, timer.startTime]);

  const start = useCallback(() => {
    if (!timer.projectId) return;
    dispatch({
      type: "SET_TIMER",
      payload: {
        isRunning: true,
        startTime: new Date().toISOString(),
      },
    });
  }, [dispatch, timer.projectId]);

  const stop = useCallback(async () => {
    if (!timer.isRunning || !timer.startTime || !employee) return;

    const startTime = timer.startTime;
    const endTime = new Date().toISOString();
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const minutes = Math.max(1, Math.round((endMs - startMs) / 60000));
    const date = new Date(startMs).toISOString().split("T")[0];

    const project = state.projects.find((p) => p.id === timer.projectId);

    dispatch({ type: "RESET_TIMER" });

    try {
      const entry = await api.createTimeEntry(employee.id, {
        description: timer.description,
        projectId: timer.projectId!,
        projectName: project?.name,
        taskId: timer.taskId ?? undefined,
        date,
        startTime,
        endTime,
        minutes,
        status: "SAVED",
      });
      dispatch({ type: "ADD_ENTRY", payload: entry });
    } catch {
      // Save as unsaved entry for manual retry
      const unsavedEntry = {
        id: crypto.randomUUID(),
        description: timer.description,
        projectId: timer.projectId!,
        projectName: project?.name,
        taskId: timer.taskId ?? undefined,
        date,
        startTime,
        endTime,
        minutes,
        status: "SAVED" as const,
        syncStatus: "unsaved" as const,
      };
      dispatch({ type: "ADD_ENTRY", payload: unsavedEntry });
      dispatch({
        type: "SET_ERROR",
        payload: "Failed to save — entry marked as unsaved",
      });
    }
  }, [timer, employee, state.projects, dispatch, api]);

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
