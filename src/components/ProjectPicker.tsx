import { useState, useRef, useEffect, useMemo } from "react";
import { useApp } from "../store/context";

interface ProjectPickerProps {
  selectedId: string | null;
  onSelect: (projectId: string) => void;
  variant?: "field" | "chip";
}

export function ProjectPicker({ selectedId, onSelect, variant = "field" }: ProjectPickerProps) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = state.projects.find((p) => p.id === selectedId);

  const myProjects = useMemo(
    () =>
      state.projects.filter(
        (p) => state.myProjectIds.includes(p.id) && p.projectType !== "ABSENCE"
      ),
    [state.projects, state.myProjectIds]
  );

  const { mySearchResults, otherSearchResults } = useMemo(() => {
    if (!search.trim()) return { mySearchResults: [], otherSearchResults: [] };
    const q = search.toLowerCase();
    const matches = state.projects.filter(
      (p) =>
        p.projectType !== "ABSENCE" &&
        (p.name.toLowerCase().includes(q) ||
          (p.customerName && p.customerName.toLowerCase().includes(q)))
    );
    const my: typeof matches = [];
    const other: typeof matches = [];
    for (const p of matches) {
      if (state.myProjectIds.includes(p.id)) {
        my.push(p);
      } else {
        other.push(p);
      }
    }
    return { mySearchResults: my.slice(0, 20), otherSearchResults: other.slice(0, 20) };
  }, [search, state.projects, state.myProjectIds]);

  // Absence projects are always shown in their own group, regardless of
  // allocation (vacation, sick leave, etc. aren't allocated like projects).
  const absenceResults = useMemo(() => {
    const absences = state.projects.filter((p) => p.projectType === "ABSENCE");
    const q = search.trim().toLowerCase();
    if (!q) return absences;
    return absences.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [search, state.projects]);

  const displayProjects = search.trim() ? mySearchResults : myProjects;

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

  const rootClass = variant === "chip" ? "relative min-w-0 flex-1" : "relative min-w-0 w-full";
  const buttonClass =
    variant === "chip"
      ? "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-sm rounded-md bg-bg-card border border-divider hover:border-border cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
      : "flex w-full items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg bg-bg-card border border-divider hover:border-border cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div ref={ref} className={rootClass}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={buttonClass}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <>
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: selected.color }}
              />
              <span className="text-text truncate">{selected.name}</span>
            </>
          ) : (
            <span className="text-text-muted truncate">Select project</span>
          )}
        </span>
        <svg
          className={`w-3 h-3 text-text-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed left-3 right-3 mt-1 bg-bg-card rounded-lg shadow-lg border border-divider z-50 overflow-hidden"
          style={{
            top: ref.current ? ref.current.getBoundingClientRect().bottom + "px" : undefined,
          }}
        >
          {/* Search input */}
          <div className="p-2.5 border-b border-divider">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by project or client..."
              className="w-full px-3 py-2 text-sm bg-bg rounded-lg outline-none placeholder:text-text-muted"
            />
          </div>

          {/* Project list */}
          <div className="max-h-64 overflow-y-auto pb-1">
            {/* My projects section */}
            <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wide">
              {search.trim()
                ? `My projects (${mySearchResults.length})`
                : `My projects (${myProjects.length})`}
            </div>
            {displayProjects.length === 0 && (
              <div className="px-3 py-3 text-xs text-text-muted text-center">
                {search.trim() ? "No allocated projects found" : "No allocated projects"}
              </div>
            )}
            {displayProjects.map((project) => (
              <button
                type="button"
                key={project.id}
                onClick={() => {
                  onSelect(project.id);
                  setOpen(false);
                  setSearch("");
                }}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-bg/70 cursor-pointer transition-colors text-sm ${
                  project.id === selectedId ? "bg-primary/10" : ""
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate flex-1">{project.name}</span>
                {project.customerName && (
                  <span className="text-text-muted text-xs shrink-0 max-w-[40%] truncate text-right">
                    {project.customerName}
                  </span>
                )}
              </button>
            ))}

            {/* Other projects section (only shown when searching) */}
            {search.trim() && otherSearchResults.length > 0 && (
              <>
                <div className="px-3 py-1.5 mt-1 text-[10px] font-semibold text-text-muted uppercase tracking-wide border-t border-divider pt-2">
                  Other projects ({otherSearchResults.length})
                </div>
                {otherSearchResults.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    onClick={() => {
                      onSelect(project.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-bg/70 cursor-pointer transition-colors text-sm ${
                      project.id === selectedId ? "bg-primary/10" : ""
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="truncate flex-1">{project.name}</span>
                    {project.customerName && (
                      <span className="text-text-muted text-xs shrink-0 max-w-[40%] truncate text-right">
                        {project.customerName}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}

            {/* Absence section — always visible, regardless of allocation */}
            {absenceResults.length > 0 && (
              <>
                <div className="px-3 py-1.5 mt-1 text-[10px] font-semibold text-text-muted uppercase tracking-wide border-t border-divider pt-2">
                  Absence ({absenceResults.length})
                </div>
                {absenceResults.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    onClick={() => {
                      onSelect(project.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-bg/70 cursor-pointer transition-colors text-sm ${
                      project.id === selectedId ? "bg-primary/10" : ""
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="truncate flex-1">{project.name}</span>
                    {project.customerName && (
                      <span className="text-text-muted text-xs shrink-0 max-w-[40%] truncate text-right">
                        {project.customerName}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
