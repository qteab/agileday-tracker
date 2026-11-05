import { useApp } from "../store/context";

interface FlexSetupAlertProps {
  onOpenSettings: () => void;
}

export function FlexSetupAlert({ onOpenSettings }: FlexSetupAlertProps) {
  const { state } = useApp();

  if (state.flexConfig) return null;

  return (
    <div className="flex items-center justify-between bg-primary/10 px-4 py-2 text-xs text-primary">
      <span>Set up flex time tracking to monitor your overtime balance.</span>
      <button
        onClick={onOpenSettings}
        className="ml-2 font-semibold whitespace-nowrap hover:underline"
      >
        Set up
      </button>
    </div>
  );
}
