import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";

import { useApp } from "../store/context";

interface ProjectPickerProps {
  selectedId: string | null;
  onSelect: (projectId: string) => void;
  variant?: "field" | "chip";
  /** When set, projects tracked on this day (YYYY-MM-DD) are also listed in the
   *  default view, alongside allocated projects. */
  usageDate?: string;
  /** Called when the picker is dismissed by clicking outside it. */
  onClose?: () => void;
}

export function ProjectPicker({
  selectedId,
  onSelect,
  variant = "field",
  usageDate,
  onClose,
}: ProjectPickerProps) {
  const { state } = useApp();
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  const [open, setOpen] = useState(false);
  // Trigger rect, measured when the panel opens.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
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

  // Projects tracked on the active day (non-absence) — surfaced in the default
  // view so a card's own project (incl. non-allocated ones) is always pickable.
  const dayProjects = useMemo(() => {
    if (!usageDate) return [];
    const ids = new Set(state.entries.filter((e) => e.date === usageDate).map((e) => e.projectId));
    return state.projects.filter((p) => ids.has(p.id) && p.projectType !== "ABSENCE");
  }, [usageDate, state.entries, state.projects]);

  // Default (non-search) list: allocated projects ∪ the day's tracked projects,
  // plus the currently-selected project if it's somehow neither.
  const displayProjects = useMemo(() => {
    if (search.trim()) return mySearchResults;
    const merged = [...myProjects];
    const seen = new Set(myProjects.map((p) => p.id));
    for (const p of dayProjects) {
      if (!seen.has(p.id)) {
        merged.push(p);
        seen.add(p.id);
      }
    }
    if (selected && selected.projectType !== "ABSENCE" && !seen.has(selected.id)) {
      merged.unshift(selected);
    }
    return merged;
  }, [search, mySearchResults, myProjects, dayProjects, selected]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
        onCloseRef.current?.();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
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
        onClick={() => {
          setAnchor(ref.current?.getBoundingClientRect() ?? null);
          setOpen(!open);
        }}
        className={buttonClass}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: selected.color }}
              />
              <span className="truncate text-text">{selected.name}</span>
            </>
          ) : (
            <span className="truncate text-text-muted">Select project</span>
          )}
        </span>
        <svg
          className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed z-50 mt-1 overflow-hidden rounded-lg border border-divider bg-bg-card shadow-lg"
          style={{
            // Anchor below the trigger, matching its width exactly.
            top: anchor?.bottom,
            left: anchor?.left,
            width: anchor?.width,
          }}
        >
          {/* Search input */}
          <div className="border-b border-divider p-2.5">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder="Search by project or client..."
              className="w-full rounded-lg bg-bg px-3 py-2 text-sm outline-none placeholder:text-text-muted"
            />
          </div>

          {/* Project list */}
          <div className="max-h-64 overflow-y-auto pb-1">
            {/* My projects section */}
            <div className="px-3 py-1.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
              {search.trim()
                ? `My projects (${mySearchResults.length})`
                : `My projects (${displayProjects.length})`}
            </div>
            {displayProjects.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-text-muted">
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
                className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-bg/70 ${
                  project.id === selectedId ? "bg-primary/10" : ""
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
                <span className="flex-1 truncate">{project.name}</span>
                {project.customerName && (
                  <span className="max-w-[40%] shrink-0 truncate text-right text-xs text-text-muted">
                    {project.customerName}
                  </span>
                )}
              </button>
            ))}

            {/* Other projects section (only shown when searching) */}
            {search.trim() && otherSearchResults.length > 0 && (
              <>
                <div className="mt-1 border-t border-divider px-3 py-1.5 pt-2 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
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
                    className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-bg/70 ${
                      project.id === selectedId ? "bg-primary/10" : ""
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="flex-1 truncate">{project.name}</span>
                    {project.customerName && (
                      <span className="max-w-[40%] shrink-0 truncate text-right text-xs text-text-muted">
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
                <div className="mt-1 border-t border-divider px-3 py-1.5 pt-2 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
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
                    className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-bg/70 ${
                      project.id === selectedId ? "bg-primary/10" : ""
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="flex-1 truncate">{project.name}</span>
                    {project.customerName && (
                      <span className="max-w-[40%] shrink-0 truncate text-right text-xs text-text-muted">
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
