interface TabSwitcherProps {
  active: "list" | "allocation";
  onChange: (tab: "list" | "allocation") => void;
}

export function TabSwitcher({ active, onChange }: TabSwitcherProps) {
  return (
    <div className="px-4 pt-4 pb-[6px] bg-bg">
      <div className="grid grid-cols-2 bg-tab-track rounded-full p-1">
        <button
          onClick={() => onChange("list")}
          className={`text-center py-[9px] font-bold text-[15px] rounded-full transition-all duration-200 ${
            active === "list"
              ? "bg-bg-card text-text shadow-[0_2px_6px_rgba(11,4,21,0.06)]"
              : "bg-transparent text-text-muted"
          }`}
        >
          List
        </button>
        <button
          onClick={() => onChange("allocation")}
          className={`text-center py-[9px] font-bold text-[15px] rounded-full transition-all duration-200 ${
            active === "allocation"
              ? "bg-bg-card text-text shadow-[0_2px_6px_rgba(11,4,21,0.06)]"
              : "bg-transparent text-text-muted"
          }`}
        >
          Allocation
        </button>
      </div>
    </div>
  );
}
