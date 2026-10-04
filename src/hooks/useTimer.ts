import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useApp, useApi } from "../store/context";
import type { TimerState } from "../store/reducer";
import {
  ClickUpRateLimitError,
  sessionMinutes,
  withClickupLine,
  type ClickUpTask,
} from "../api/clickup";

export function useTimer() {
  const { state, dispatch } = useApp();
  const addTime = useAddTime();
  const logClickUp = useLogClickUp();
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
    // An unresolved "you were away" prompt must be answered (Discard/Keep)
    // before the timer can be stopped.
    if (state.inactivity.pendingReturn) return;

    const { projectId, taskId, startTime, clickupTask } = timer;
    const endTime = new Date().toISOString();
    const startMs = new Date(startTime).getTime();
    const minutes = sessionMinutes(new Date(endTime).getTime() - startMs);
    const startLocal = new Date(startMs);
    const date = `${startLocal.getFullYear()}-${String(startLocal.getMonth() + 1).padStart(2, "0")}-${String(startLocal.getDate()).padStart(2, "0")}`;

    // Reset timer immediately so user can start a new one
    dispatch({ type: "RESET_TIMER" });

    // ClickUp logging runs in the background: starting the next timer waits on
    // stop(), and must never hang on a slow or rate-limited ClickUp.
    if (clickupTask) void logClickUp(clickupTask, startMs, minutes);
    await addTime({
      projectId: projectId!,
      taskId,
      date,
      minutes,
      startTime,
      endTime,
      clickupTasks: clickupTask ? [clickupTask] : [],
    });
  }, [timer, employee, state.inactivity.pendingReturn, dispatch, addTime, logClickUp]);

  // Use a ref so startForCard always invokes the latest stop closure
  const stopRef = useRef(stop);
  stopRef.current = stop;

  /** Start the timer for a specific card (projectId + taskId). Stops any running timer first. */
  const startForCard = useCallback(
    async (
      projectId: string,
      taskId: string,
      clickupTask: NonNullable<TimerState["clickupTask"]> | null = null,
      startTime = new Date().toISOString()
    ) => {
      // Stop any currently running timer before starting a new one
      await stopRef.current();
      dispatch({
        type: "SET_TIMER",
        payload: { projectId, taskId, clickupTask, isRunning: true, startTime },
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
        clickupTask: null,
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
    clickupTask: timer.clickupTask ?? null,
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

interface AddTimeParams {
  projectId: string;
  taskId: string | null;
  date: string;
  minutes: number;
  startTime: string;
  endTime?: string;
  /** ClickUp tasks whose `CU-` line must be on the entry. */
  clickupTasks?: ClickUpTask[];
}

/**
 * Add minutes to the day's (project, task) entry — creating it if needed — and
 * save the full total to AgileDay (the app is the source of truth).
 */
export function useAddTime() {
  const { state, dispatch } = useApp();
  const api = useApi();
  const { employee } = state;

  return useCallback(
    async ({
      projectId,
      taskId,
      date,
      minutes,
      startTime,
      endTime,
      clickupTasks = [],
    }: AddTimeParams) => {
      if (!employee) return;
      const project = state.projects.find((p) => p.id === projectId);
      const openingId = state.projectOpeningMap[projectId];

      // Find the existing entry for this card — it should exist since we only
      // show play buttons on cards that already have an entry.
      const existing = state.entries.find(
        (e) =>
          e.projectId === projectId && (e.taskId ?? null) === (taskId ?? null) && e.date === date
      );

      let workingId: string;
      const description = clickupTasks.reduce(withClickupLine, existing?.description ?? "");
      // Total minutes = existing entry + this session (app is source of truth)
      const totalMinutes = (existing?.minutes ?? 0) + minutes;

      if (existing) {
        workingId = existing.id;
        dispatch({
          type: "UPDATE_ENTRY",
          payload: {
            id: existing.id,
            updates: {
              minutes: totalMinutes,
              description,
              ...(endTime ? { endTime } : {}),
              syncStatus: "pending",
            },
          },
        });
      } else {
        // Edge case: entry was deleted while timer was running
        workingId = `local-${crypto.randomUUID()}`;
        dispatch({
          type: "ADD_ENTRY",
          payload: {
            id: workingId,
            description,
            projectId,
            projectName: project?.name,
            openingId,
            taskId: taskId ?? undefined,
            date,
            startTime,
            endTime,
            minutes: totalMinutes,
            status: "SAVED",
            syncStatus: "pending",
          },
        });
      }

      try {
        // Send full state to API: total minutes + current description
        const created = await api.createTimeEntry(employee.id, {
          description,
          projectId,
          projectName: project?.name,
          openingId,
          taskId: taskId ?? undefined,
          date,
          startTime,
          endTime,
          minutes: totalMinutes,
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
    },
    [employee, state.projects, state.projectOpeningMap, state.entries, dispatch, api]
  );
}

/**
 * Record a finished session on the ClickUp task: stop + correct an adopted
 * ClickUp timer, or create a new time entry. The entry is marked as already
 * counted in AgileDay so sync never adds it twice.
 */
export function useLogClickUp() {
  const { dispatch, clickupClient } = useApp();

  return useCallback(
    async (task: NonNullable<TimerState["clickupTask"]>, start: number, minutes: number) => {
      if (!clickupClient) return;
      // Duration is the whole minutes AgileDay got, so both sides add up exactly.
      const duration = minutes * 60000;
      const localId = `local-${crypto.randomUUID()}`;
      const shown = { taskId: task.id, taskName: task.name, start, duration };
      dispatch({
        type: "ADD_CLICKUP_ENTRY",
        payload: { id: localId, teamId: task.teamId ?? "", ...shown },
      });
      const attempt = async (): Promise<void> => {
        try {
          // Tasks started from a `CU-` line don't know their workspace yet.
          const teamId =
            task.teamId ?? (await clickupClient.getTask({ id: task.id, custom: false })).teamId!;
          let id = task.timerId;
          if (id) {
            // Only stop ClickUp's timer if it is still this one — it may have been
            // stopped (or another started) in ClickUp meanwhile. Safe to retry.
            const running = await clickupClient.getRunning(teamId);
            if (running?.id === id) await clickupClient.stopRunning(teamId);
            await clickupClient.updateTimeEntry(teamId, id, start, duration);
            dispatch({ type: "SET_CLICKUP_RUNNING", payload: null });
          } else {
            id = (await clickupClient.createTimeEntry(teamId, task.id, start, duration)).id;
          }
          dispatch({ type: "MARK_CLICKUP_SYNCED", payload: [{ id, start }] });
          dispatch({ type: "REMOVE_CLICKUP_ENTRIES", payload: [localId] });
          dispatch({ type: "ADD_CLICKUP_ENTRY", payload: { id, teamId, ...shown } });
        } catch (err) {
          if (err instanceof ClickUpRateLimitError) {
            // Keep the card's minutes and retry once ClickUp allows calls again.
            // ponytail: in-memory retry — quitting before it fires leaves this
            // session out of ClickUp (AgileDay already has it).
            const wait = Math.max(0, err.retryAt - Date.now());
            dispatch({
              type: "SET_ERROR",
              payload: `ClickUp is rate limiting requests. Saved to AgileDay; logging in ClickUp in ${Math.ceil(wait / 1000)}s.`,
            });
            setTimeout(() => void attempt(), wait);
            return;
          }
          dispatch({ type: "REMOVE_CLICKUP_ENTRIES", payload: [localId] });
          const reason = err instanceof Error ? err.message : "Unknown error";
          dispatch({
            type: "SET_ERROR",
            payload: `Saved to AgileDay, but logging time in ClickUp failed: ${reason}`,
          });
        }
      };
      await attempt();
    },
    [dispatch, clickupClient]
  );
}
