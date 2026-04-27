import { useState } from "react";
import { useApp } from "../store/context";
import { formatMinutes } from "../hooks/useTimer";
import { EntryEditModal } from "./EntryEditModal";
import type { TimeEntry as TimeEntryType } from "../api/types";

interface TimeEntryProps {
  entry: TimeEntryType;
  onContinue: (entry: TimeEntryType) => void;
}

export function TimeEntry({ entry, onContinue }: TimeEntryProps) {
  const { state } = useApp();
  const [editing, setEditing] = useState(false);
  const project = state.projects.find((p) => p.id === entry.projectId);

  return (
    <>
      <div
        onClick={() => setEditing(true)}
        className="group flex items-center gap-3 px-4 py-3 hover:bg-white/50 transition-colors cursor-pointer border-b border-border/50 last:border-b-0"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text truncate">
            {entry.description || (
              <span className="text-text-muted">+ Add description</span>
            )}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {project && (
              <>
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span className="text-xs text-text-muted truncate">
                  {project.name}
                </span>
              </>
            )}
          </div>
        </div>

        {entry.syncStatus === "unsaved" && (
          <span className="text-xs text-danger font-medium shrink-0">
            Unsaved
          </span>
        )}

        <span className="text-sm text-text-muted tabular-nums shrink-0">
          {formatMinutes(entry.minutes)}
        </span>

        {/* Play button on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onContinue(entry);
          }}
          className="opacity-0 group-hover:opacity-100 w-8 h-8 rounded-full flex items-center justify-center text-primary hover:bg-primary/10 transition-all shrink-0"
          title="Continue this entry"
        >
          <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>

      {editing && (
        <EntryEditModal entry={entry} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
