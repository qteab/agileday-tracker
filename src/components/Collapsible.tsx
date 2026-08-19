import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface CollapsibleProps {
  collapsed: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Animates its children between zero height and their natural height.
 *
 * Clips with `overflow: clip` rather than `hidden`: `hidden` would make this a
 * scroll container, and sticky headings inside it would then stick to this box
 * instead of the scrolling list.
 *
 * The height has to be an explicit pixel value to transition, so the content is
 * measured with a ResizeObserver — that also covers content changing size while
 * expanded (a description added, text reflowing). Transitions stay off for the
 * first paint so nothing animates open on mount.
 */
export function Collapsible({ collapsed, children, className = "" }: CollapsibleProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`overflow-clip ${
        animated ? "transition-all duration-200 ease-out motion-reduce:transition-none" : ""
      } ${collapsed ? "opacity-0" : "opacity-100"} ${className}`}
      style={{ height: collapsed ? 0 : height }}
      aria-hidden={collapsed}
      inert={collapsed}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
