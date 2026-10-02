import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useApp, useApi } from "../store/context";
import { useAddTime, useTimer, formatTime, formatMinutes } from "../hooks/useTimer";
import { usePersistEntry } from "./ProjectCard";
import { ProjectPicker } from "./ProjectPicker";
import { TaskPicker } from "./TaskPicker";
import { Modal } from "./Modal";
import { isLocalOnlyEntry } from "./entry-edit";
import {
  clickupTasksIn,
  entryDate,
  isAccounted,
  parseTaskRef,
  unsyncedGroups,
  withClickupLine,
  withoutClickupLine,
  type ClickUpTask,
} from "../api/clickup";
import type { TimeEntry } from "../api/types";

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ClickUp mark. `mono` draws it in currentColor (for coloured backgrounds). */
export function ClickUpLogo({ size = 16, mono = false }: { size?: number; mono?: boolean }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {!mono && (
        <defs>
          <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8930FD" />
            <stop offset="1" stopColor="#49CCF9" />
          </linearGradient>
          <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#FF02F0" />
            <stop offset="1" stopColor="#FFC800" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M4.5 16.2l2.9-2.2c1.5 2 3 2.9 4.6 2.9s3.1-.9 4.6-2.9l2.9 2.2c-2.2 2.9-4.7 4.4-7.5 4.4s-5.3-1.5-7.5-4.4z"
        fill={mono ? "currentColor" : `url(#${id}a)`}
      />
      <path
        d="M12 7.6l-5.2 4.5-2.4-2.8L12 2.8l7.6 6.5-2.4 2.8z"
        fill={mono ? "currentColor" : `url(#${id}b)`}
      />
    </svg>
  );
}

async function openTask(taskId: string) {
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(`https://app.clickup.com/t/${taskId}`);
}

/**
 * Put the ClickUp task's line on the (project, task, date) entry, creating a
 * local entry if there is none. Saved to AgileDay with the first timer stop.
 */
export function useEnsureClickUpLine() {
  const { state, dispatch } = useApp();
  return useCallback(
    (projectId: string, taskId: string, date: string, task: ClickUpTask) => {
      const existing = state.entries.find(
        (e) => e.projectId === projectId && (e.taskId ?? null) === taskId && e.date === date
      );
      if (existing) {
        const description = withClickupLine(existing.description, task);
        if (description !== existing.description) {
          dispatch({
            type: "UPDATE_ENTRY",
            payload: { id: existing.id, updates: { description } },
          });
        }
        return;
      }
      dispatch({
        type: "ADD_ENTRY",
        payload: {
          id: `local-${crypto.randomUUID()}`,
          description: withClickupLine("", task),
          projectId,
          projectName: state.projects.find((p) => p.id === projectId)?.name,
          openingId: state.projectOpeningMap[projectId],
          taskId,
          date,
          startTime: new Date().toISOString(),
          minutes: 0,
          status: "SAVED",
          syncStatus: "synced",
        },
      });
    },
    [state.entries, state.projects, state.projectOpeningMap, dispatch]
  );
}

interface ClickUpDialogProps {
  title: string;
  actionLabel: string;
  /** Pre-picked ClickUp task (running timer / unsynced time); omit to paste one. */
  task?: ClickUpTask;
  usageDate: string;
  onConfirm: (projectId: string, taskId: string, task: ClickUpTask) => void;
  onClose: () => void;
}

/** Pick a ClickUp task (pasted URL / id) and the AgileDay project + task it logs to. */
export function ClickUpDialog({
  title,
  actionLabel,
  task: presetTask,
  usageDate,
  onConfirm,
  onClose,
}: ClickUpDialogProps) {
  const { clickupClient } = useApp();
  const [ref, setRef] = useState("");
  const [task, setTask] = useState<ClickUpTask | null>(presetTask ?? null);
  const [lookup, setLookup] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const lastLookup = useRef("");

  const resolve = async (input: string) => {
    if (!clickupClient || input === lastLookup.current) return;
    lastLookup.current = input;
    setTask(null);
    const parsed = parseTaskRef(input);
    if (!parsed) {
      setLookup({ busy: false, error: input.trim() ? "Not a ClickUp task link or id" : null });
      return;
    }
    setLookup({ busy: true, error: null });
    try {
      setTask(await clickupClient.getTask(parsed));
      setLookup({ busy: false, error: null });
    } catch {
      setLookup({ busy: false, error: "Task not found in your ClickUp workspace" });
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={title}
      actions={[
        {
          label: actionLabel,
          onClick: () => task && projectId && taskId && onConfirm(projectId, taskId, task),
          disabled: !task || !projectId || !taskId,
        },
      ]}
    >
      {presetTask ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg text-sm text-text">
          <ClickUpLogo />
          <span className="truncate">{presetTask.name}</span>
        </div>
      ) : (
        <div>
          <input
            autoFocus
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onBlur={() => void resolve(ref)}
            onPaste={(e) => void resolve(e.clipboardData.getData("text"))}
            onKeyDown={(e) => e.key === "Enter" && void resolve(ref)}
            placeholder="Paste ClickUp task link or ID"
            className="w-full px-3 py-2 text-sm bg-bg border border-border rounded-lg text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            aria-label="ClickUp task link or ID"
          />
          <div className="flex items-center gap-1.5 mt-1.5 min-h-[18px] text-xs">
            {lookup.busy && <span className="text-text-muted">Looking up…</span>}
            {lookup.error && <span className="text-danger">{lookup.error}</span>}
            {task && (
              <>
                <ClickUpLogo size={13} />
                <span className="text-text truncate">{task.name}</span>
              </>
            )}
          </div>
        </div>
      )}
      <ProjectPicker
        selectedId={projectId}
        onSelect={(id) => {
          setProjectId(id);
          setTaskId(null);
        }}
        variant="field"
        usageDate={usageDate}
      />
      <TaskPicker projectId={projectId} selectedId={taskId} onSelect={setTaskId} variant="field" />
    </Modal>
  );
}

interface ClickUpCardProps {
  /** The AgileDay entry this ClickUp task is logged under. */
  entry: TimeEntry;
  task: ClickUpTask;
  /** Minutes this task holds of the entry's total. */
  minutes: number;
  isToday: boolean;
}

/** One ClickUp task's share of an AgileDay entry, with its own timer. */
export function ClickUpCard({ entry, task, minutes, isToday }: ClickUpCardProps) {
  const { state, dispatch, clickupClient } = useApp();
  const api = useApi();
  const persist = usePersistEntry(entry);
  const { isRunning, clickupTask, elapsed, startForCard, stop } = useTimer();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = state.projects.find((p) => p.id === entry.projectId);
  const taskName = entry.taskId ? state.taskNamesById[entry.taskId] : undefined;
  const isSubmitted = entry.status === "SUBMITTED" || entry.status === "APPROVED";
  const isEditable = !isSubmitted && entry.syncStatus !== "pending";
  const isThisRunning =
    isRunning &&
    clickupTask?.id === task.id &&
    state.timer.projectId === entry.projectId &&
    (state.timer.taskId ?? null) === (entry.taskId ?? null) &&
    isToday;

  // Tick while running so the clock moves.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isThisRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isThisRunning]);

  const displayTime = isThisRunning ? formatTime(minutes * 60 + elapsed) : formatMinutes(minutes);

  /** Remove this task's time from ClickUp and from the AgileDay entry. */
  const handleDelete = async () => {
    setConfirmDelete(false);
    setError(null);
    if (isThisRunning) dispatch({ type: "RESET_TIMER" });
    try {
      const ids = (state.clickupEntries ?? [])
        .filter((e) => e.taskId === task.id && entryDate(e) === entry.date)
        .filter((e) => state.clickup && isAccounted(e, state.clickup.sync))
        .filter((e) => !e.id.startsWith("local-"))
        .map((e) => e.id);
      if (clickupClient) await Promise.all(ids.map((id) => clickupClient.deleteTimeEntry(id)));
      dispatch({ type: "REMOVE_CLICKUP_ENTRIES", payload: ids });

      const description = withoutClickupLine(entry.description, task.id);
      const rest = entry.minutes - minutes;
      if (rest > 0 || description) {
        await persist({ description, minutes: Math.max(0, rest) });
      } else {
        if (!isLocalOnlyEntry(entry)) await api.deleteTimeEntry([entry.id]);
        dispatch({ type: "DELETE_ENTRY", payload: entry.id });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <div className="relative bg-bg-card border border-border rounded-xl shadow-[0_1px_2px_rgba(11,4,21,0.04)] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={() => void openTask(task.id)}
            title="Open in ClickUp"
            className="flex items-center gap-2 w-full text-left font-bold text-[16px] leading-[1.25] text-text hover:text-primary transition-colors cursor-pointer"
          >
            <ClickUpLogo />
            <span className="truncate">{task.name || `CU-${task.id}`}</span>
          </button>
          <div className="mt-[3px] text-[13px] text-text-muted truncate">
            {project?.name ?? entry.projectName ?? "Unknown project"}
            {taskName ? ` · ${taskName}` : ""}
          </div>
        </div>
        <span
          className={`text-[17px] font-semibold tabular-nums ${isThisRunning ? "text-primary" : "text-text"}`}
        >
          {displayTime}
        </span>
        {isToday && !isSubmitted && entry.taskId && (
          <button
            onClick={() =>
              isThisRunning ? void stop() : void startForCard(entry.projectId, entry.taskId!, task)
            }
            className={`w-[36px] h-[36px] shrink-0 rounded-full flex items-center justify-center text-white transition-all duration-200 active:scale-[0.94] ${
              isThisRunning ? "bg-danger hover:bg-[#d8363c]" : "bg-primary hover:bg-primary-dark"
            }`}
            aria-label={isThisRunning ? "Stop timer" : "Start timer"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              {isThisRunning ? (
                <rect x="6" y="6" width="12" height="12" rx="2.5" />
              ) : (
                <polygon points="6 4 20 12 6 20 6 4" />
              )}
            </svg>
          </button>
        )}
        {isEditable && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-text-subtle hover:text-danger hover:bg-bg-edit transition-colors"
            aria-label="Delete ClickUp time"
            title="Delete"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
            </svg>
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {confirmDelete && (
        <Modal
          onClose={() => setConfirmDelete(false)}
          title="Delete this ClickUp time?"
          subtitle={`${task.name} · ${displayTime} is removed from both ClickUp and AgileDay.`}
          actions={[
            { label: "Cancel", variant: "secondary", onClick: () => setConfirmDelete(false) },
            { label: "Delete", variant: "danger", onClick: () => void handleDelete() },
          ]}
        />
      )}
    </div>
  );
}

/**
 * Brings time tracked in ClickUp itself into the app:
 * - a timer running in ClickUp can be taken over ("Track here");
 * - finished ClickUp time on a task already linked to that day's AgileDay
 *   entry is added automatically;
 * - other finished ClickUp time is offered one task at a time (Add / Ignore).
 */
export function ClickUpBanner() {
  const { state, dispatch } = useApp();
  const addTime = useAddTime();
  const ensureLine = useEnsureClickUpLine();
  const { startForCard } = useTimer();
  const [dialog, setDialog] = useState<"adopt" | "add" | null>(null);

  const { clickup, clickupEntries, clickupRunning, timer } = state;
  const adoptedId = timer.clickupTask?.timerId;

  const groups = useMemo(() => {
    if (!clickup || !clickupEntries) return [];
    // The adopted ClickUp timer is added to AgileDay when the app stops it.
    return unsyncedGroups(
      clickupEntries.filter((e) => e.id !== adoptedId),
      clickup.sync
    );
  }, [clickup, clickupEntries, adoptedId]);

  /** Editable entry that already carries this task's line on that date. */
  const linkedEntry = useCallback(
    (date: string, taskId: string) =>
      state.entries.find(
        (e) =>
          e.date === date &&
          e.status !== "SUBMITTED" &&
          e.status !== "APPROVED" &&
          e.syncStatus !== "pending" &&
          clickupTasksIn(e.description).some((t) => t.id === taskId)
      ),
    [state.entries]
  );

  // Auto-add one linked group at a time; saves to one entry must not overlap.
  const busy = useRef(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (busy.current || state.loading) return;
    const group = groups.find((g) => linkedEntry(g.date, g.task.id));
    const target = group && linkedEntry(group.date, group.task.id);
    if (!group || !target) return;
    busy.current = true;
    dispatch({ type: "MARK_CLICKUP_SYNCED", payload: group.entries });
    void addTime({
      projectId: target.projectId,
      taskId: target.taskId ?? null,
      date: group.date,
      minutes: group.minutes,
      startTime: new Date(group.entries[0].start).toISOString(),
    }).finally(() => {
      busy.current = false;
      setRound((r) => r + 1);
    });
  }, [groups, linkedEntry, state.loading, addTime, dispatch, round]);

  const showRunning = clickupRunning && clickupRunning.id !== adoptedId;
  const pending = groups.find((g) => !linkedEntry(g.date, g.task.id));
  if (!showRunning && !pending) return null;

  const runningTask = clickupRunning
    ? { id: clickupRunning.taskId, name: clickupRunning.taskName }
    : null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-bg-card border-b border-border text-xs">
      <ClickUpLogo size={14} />
      {showRunning && runningTask ? (
        <>
          <span className="flex-1 min-w-0 truncate text-text">
            Timer running in ClickUp · <b>{runningTask.name}</b>
          </span>
          <button
            onClick={() => setDialog("adopt")}
            className="px-2.5 py-1 font-semibold text-white bg-primary rounded-md hover:bg-primary-dark"
          >
            Track here
          </button>
        </>
      ) : pending ? (
        <>
          <span className="flex-1 min-w-0 truncate text-text">
            <b>{pending.task.name}</b> · {formatMinutes(pending.minutes).slice(0, -3)} in ClickUp,
            not in AgileDay
          </span>
          <button
            onClick={() => setDialog("add")}
            className="px-2.5 py-1 font-semibold text-white bg-primary rounded-md hover:bg-primary-dark"
          >
            Add
          </button>
          <button
            onClick={() => dispatch({ type: "MARK_CLICKUP_SYNCED", payload: pending.entries })}
            className="px-2 py-1 font-medium text-text-muted hover:text-text"
          >
            Ignore
          </button>
        </>
      ) : null}

      {dialog === "adopt" && clickupRunning && runningTask && (
        <ClickUpDialog
          title="Track ClickUp timer"
          actionLabel="Track here"
          task={runningTask}
          usageDate={localDate(new Date(clickupRunning.start))}
          onClose={() => setDialog(null)}
          onConfirm={(projectId, taskId, task) => {
            setDialog(null);
            const start = new Date(clickupRunning.start);
            ensureLine(projectId, taskId, localDate(start), task);
            void startForCard(
              projectId,
              taskId,
              { ...task, timerId: clickupRunning.id },
              start.toISOString()
            );
          }}
        />
      )}
      {dialog === "add" && pending && (
        <ClickUpDialog
          title="Add ClickUp time to AgileDay"
          actionLabel={`Add ${formatMinutes(pending.minutes).slice(0, -3)}`}
          task={pending.task}
          usageDate={pending.date}
          onClose={() => setDialog(null)}
          onConfirm={(projectId, taskId, task) => {
            setDialog(null);
            dispatch({ type: "MARK_CLICKUP_SYNCED", payload: pending.entries });
            void addTime({
              projectId,
              taskId,
              date: pending.date,
              minutes: pending.minutes,
              startTime: new Date(pending.entries[0].start).toISOString(),
              clickupTasks: [task],
            });
          }}
        />
      )}
    </div>
  );
}
