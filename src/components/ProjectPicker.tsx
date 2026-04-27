import { useState, useRef, useEffect } from "react";
import { useApp } from "../store/context";

interface ProjectPickerProps {
  selectedId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectPicker({ selectedId, onSelect }: ProjectPickerProps) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = state.projects.find((p) => p.id === selectedId);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg hover:bg-white/60 transition-colors"
      >
        {selected ? (
          <>
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: selected.color }}
            />
            <span className="text-text truncate max-w-[200px]">{selected.name}</span>
          </>
        ) : (
          <span className="text-text-muted">Select project</span>
        )}
        <svg
          className="w-3 h-3 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-border z-50 py-1 max-h-60 overflow-y-auto">
          {state.projects.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                onSelect(project.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-bg transition-colors text-sm ${
                project.id === selectedId ? "bg-bg" : ""
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <span className="truncate">{project.name}</span>
              {project.customerName && (
                <span className="text-text-muted text-xs ml-auto truncate">
                  {project.customerName}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
