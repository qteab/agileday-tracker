import { useState, useRef, useEffect, useMemo } from "react";
import { useApp } from "../store/context";

interface ProjectPickerProps {
  selectedId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectPicker({ selectedId, onSelect }: ProjectPickerProps) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = state.projects.find((p) => p.id === selectedId);

  const myProjects = useMemo(
    () => state.projects.filter((p) => state.myProjectIds.includes(p.id)),
    [state.projects, state.myProjectIds]
  );

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return state.projects
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.customerName && p.customerName.toLowerCase().includes(q))
      )
      .slice(0, 15);
  }, [search, state.projects]);

  const displayProjects = search.trim() ? searchResults : myProjects;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

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
        <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-lg shadow-lg border border-border z-50 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-divider">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search all projects..."
              className="w-full px-2.5 py-1.5 text-sm bg-bg rounded-md outline-none placeholder:text-text-muted"
            />
          </div>

          {/* Section label */}
          <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wide">
            {search.trim()
              ? `Results (${searchResults.length})`
              : `My projects (${myProjects.length})`}
          </div>

          {/* Project list */}
          <div className="max-h-52 overflow-y-auto py-1">
            {displayProjects.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-muted">
                {search.trim() ? "No projects found" : "No allocated projects"}
              </div>
            )}
            {displayProjects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  onSelect(project.id);
                  setOpen(false);
                  setSearch("");
                }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-bg transition-colors text-sm ${
                  project.id === selectedId ? "bg-bg" : ""
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate" title={project.name}>
                  {project.name}
                </span>
                {project.customerName && (
                  <span className="text-text-muted text-xs ml-auto truncate" title={project.customerName}>
                    {project.customerName}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
