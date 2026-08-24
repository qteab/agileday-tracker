import { useState, useRef, useEffect, useMemo } from "react";

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
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
    return () => document.removeEventListener("mousedown", handleClick);
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
    <div ref={ref} className="relative min-w-0 w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg bg-bg-card border border-divider hover:border-border cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.color && (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: selected.color }}
            />
          )}
          <span className={`truncate ${selected ? "text-text" : "text-text-muted"}`}>
            {selected ? selected.label : placeholder}
          </span>
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
          className="fixed mt-1 bg-bg-card rounded-lg shadow-lg border border-divider z-50 overflow-hidden"
          style={{
            // Anchor below the trigger, matching its width exactly.
            top: ref.current?.getBoundingClientRect().bottom,
            left: ref.current?.getBoundingClientRect().left,
            width: ref.current?.getBoundingClientRect().width,
          }}
        >
          {searchable && (
            <div className="p-2.5 border-b border-divider">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full px-3 py-2 text-sm bg-bg rounded-lg outline-none placeholder:text-text-muted"
              />
            </div>
          )}

          <div className="max-h-64 overflow-y-auto py-1">
            {visibleOptions.length === 0 && (
              <div className="px-3 py-3 text-xs text-text-muted text-center">{emptyLabel}</div>
            )}
            {visibleOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                onClick={() => pick(option.id)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-bg/70 cursor-pointer transition-colors text-sm ${
                  option.id === selectedId ? "bg-primary/10" : ""
                }`}
              >
                {option.color && (
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                <span className="truncate flex-1">{option.label}</span>
                {option.hint && (
                  <span className="text-text-muted text-xs shrink-0 max-w-[40%] truncate text-right">
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
