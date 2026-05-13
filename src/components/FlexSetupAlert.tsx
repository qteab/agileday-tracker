import { useApp } from "../store/context";

interface FlexSetupAlertProps {
  onOpenSettings: () => void;
}

export function FlexSetupAlert({ onOpenSettings }: FlexSetupAlertProps) {
  const { state } = useApp();

  if (state.flexConfig) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-primary/10 text-primary text-xs">
      <span>Set up flex time tracking to monitor your overtime balance.</span>
      <button
        onClick={onOpenSettings}
        className="font-semibold hover:underline ml-2 whitespace-nowrap"
      >
        Set up
      </button>
    </div>
  );
}
