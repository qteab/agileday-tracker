import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";

export interface DropdownOption {
  id: string;
  label: string;
  /** Muted right-aligned text (e.g. a customer name). */
  hint?: string;
  /** Leading color dot, matching how projects render elsewhere. */
  color?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  placeholder?: string;
  /** Show a search input above the list. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown when the list is empty (no options, or no search matches). */
  emptyLabel?: string;
  /** Called when the picker is dismissed by clicking outside it. */
  onClose?: () => void;
}

/**
 * Generic themed dropdown, styled like the project/task pickers: a field-style
 * trigger with a chevron, and an anchored panel with optional search.
 */
export function Dropdown({
  options,
  selectedId,
  onSelect,
  placeholder = "Select…",
  searchable = false,
  searchPlaceholder = "Search...",
  emptyLabel = "No options",
  onClose,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  // Trigger rect, measured when the panel opens.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  const selected = options.find((o) => o.id === selectedId);

  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!searchable || !q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)
    );
  }, [options, search, searchable]);

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
    if (open && searchable) inputRef.current?.focus();
  }, [open, searchable]);

  function pick(id: string) {
    onSelect(id);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={ref} className="relative w-full min-w-0">
      <button
        type="button"
        onClick={() => {
          setAnchor(ref.current?.getBoundingClientRect() ?? null);
          setOpen(!open);
        }}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-divider bg-bg-card px-3 py-2 text-sm transition-colors hover:border-border focus:ring-2 focus:ring-primary/20 focus:outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.color && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          )}
          <span className={`truncate ${selected ? "text-text" : "text-text-muted"}`}>
            {selected ? selected.label : placeholder}
          </span>
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
          {searchable && (
            <div className="border-b border-divider p-2.5">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                placeholder={searchPlaceholder}
                className="w-full rounded-lg bg-bg px-3 py-2 text-sm outline-none placeholder:text-text-muted"
              />
            </div>
          )}

          <div className="max-h-64 overflow-y-auto py-1">
            {visibleOptions.length === 0 && (
              <div className="px-3 py-3 text-center text-xs text-text-muted">{emptyLabel}</div>
            )}
            {visibleOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                onClick={() => {
                  pick(option.id);
                }}
                className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-bg/70 ${
                  option.id === selectedId ? "bg-primary/10" : ""
                }`}
              >
                {option.color && (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                <span className="flex-1 truncate">{option.label}</span>
                {option.hint && (
                  <span className="max-w-[40%] shrink-0 truncate text-right text-xs text-text-muted">
                    {option.hint}
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
