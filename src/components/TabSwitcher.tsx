interface TabSwitcherProps {
  active: "list" | "allocation";
  onChange: (tab: "list" | "allocation") => void;
}

export function TabSwitcher({ active, onChange }: TabSwitcherProps) {
  return (
    <div className="flex mx-4 my-3 rounded-full border border-border overflow-hidden">
      <button
        onClick={() => onChange("list")}
        className={`flex-1 py-2 text-sm font-medium transition-all ${
          active === "list"
            ? "bg-bg-card text-text"
            : "bg-transparent text-text-muted hover:text-text"
        }`}
      >
        List
      </button>
      <button
        onClick={() => onChange("allocation")}
        className={`flex-1 py-2 text-sm font-medium transition-all ${
          active === "allocation"
            ? "bg-bg-card text-text"
            : "bg-transparent text-text-muted hover:text-text"
        }`}
      >
        Allocation
      </button>
    </div>
  );
}
