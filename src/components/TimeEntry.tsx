import { useState } from "react";
import { useApp } from "../store/context";
import { formatMinutes } from "../hooks/useTimer";
import { EntryEditModal } from "./EntryEditModal";
import { BillableIndicator } from "./BillableIndicator";
import type { TimeEntry as TimeEntryType } from "../api/types";

interface TimeEntryProps {
  entry: TimeEntryType;
  onContinue: (entry: TimeEntryType) => void;
}

export function TimeEntry({ entry, onContinue }: TimeEntryProps) {
  const { state } = useApp();
  const [editing, setEditing] = useState(false);
  const project = state.projects.find((p) => p.id === entry.projectId);
  const isSubmitted = entry.status === "SUBMITTED" || entry.status === "APPROVED";

  return (
    <>
      <div
        onClick={() => {
          if (isSubmitted) {
            // Brief visual feedback that it's locked
          } else {
            setEditing(true);
          }
        }}
        className={`group flex items-center gap-3 px-3 py-3 transition-colors ${
          isSubmitted ? "opacity-75 cursor-default" : "hover:bg-bg/40 cursor-pointer"
        }`}
        title={isSubmitted ? "Submitted entries can only be edited in AgileDay" : undefined}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text truncate" title={entry.description || undefined}>
            {entry.description || <span className="text-text-muted">+ Add description</span>}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <BillableIndicator projectType={entry.projectType ?? project?.projectType} />
            {project && (
              <>
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span className="text-xs text-text-muted truncate" title={project.name}>
                  {project.name}
                </span>
              </>
            )}
            {isSubmitted && (
              <span className="text-[10px] text-text-muted/50 ml-1 flex items-center gap-0.5">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M12 15v2m0 0v2m0-2h2m-2 0H10m-4-6V7a4 4 0 118 0v4m-8 0h12a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6a2 2 0 012-2z"
                  />
                </svg>
                Edit in AgileDay
              </span>
            )}
          </div>
        </div>

        {entry.syncStatus === "unsaved" && (
          <span className="text-xs text-danger font-medium shrink-0">Unsaved</span>
        )}

        {entry.syncStatus === "pending" && (
          <span className="text-xs text-text-muted font-medium shrink-0">Saving...</span>
        )}

        <span className="text-sm text-text-muted tabular-nums shrink-0">
          {formatMinutes(entry.minutes)}
        </span>

        {/* Play button on hover — always available (starts new entry for today) */}
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

      {editing && !isSubmitted && (
        <EntryEditModal entry={entry} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
