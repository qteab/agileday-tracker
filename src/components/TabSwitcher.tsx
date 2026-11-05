interface TabSwitcherProps {
  active: "list" | "allocation";
  onChange: (tab: "list" | "allocation") => void;
}

export function TabSwitcher({ active, onChange }: TabSwitcherProps) {
  return (
    <div className="bg-bg px-4 pt-4 pb-[6px]">
      <div className="grid grid-cols-2 rounded-full bg-tab-track p-1">
        <button
          onClick={() => {
            onChange("list");
          }}
          className={`rounded-full py-[9px] text-center text-[15px] font-bold transition-all duration-200 ${
            active === "list"
              ? "bg-bg-card text-text shadow-[0_2px_6px_rgba(11,4,21,0.06)]"
              : "bg-transparent text-text-muted"
          }`}
        >
          List
        </button>
        <button
          onClick={() => {
            onChange("allocation");
          }}
          className={`rounded-full py-[9px] text-center text-[15px] font-bold transition-all duration-200 ${
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
