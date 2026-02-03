import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import classNames from "classnames";
import styles from "./tooltip.module.css";

const TooltipProvider = TooltipPrimitive.Provider;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipPortal = TooltipPrimitive.Portal;

type TooltipProps = React.ComponentProps<typeof TooltipPrimitive.Root>;

/**
 * Custom Tooltip wrapper that ensures only one tooltip is open at a time.
 * When a tooltip opens it broadcasts an `open-tooltip` event with its id;
 * other tooltips listen for this event and close themselves when the id
 * does not match. This prevents overlapping/stacked tooltips when hovering
 * between nodes.
 */
const Tooltip: React.FC<TooltipProps> = ({ children, onOpenChange, open: controlledOpen, ...props }) => {
  const idRef = React.useRef<string>(() => `tooltip-${Math.random().toString(36).slice(2, 9)}`) as React.MutableRefObject<string>;
  const [open, setOpen] = React.useState<boolean>(() => controlledOpen ?? false);

  React.useEffect(() => {
    // Keep internal state in sync when used as a controlled component
    if (controlledOpen !== undefined) setOpen(controlledOpen);
  }, [controlledOpen]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | undefined;
      if (detail && detail !== idRef.current) {
        setOpen(false);
      }
    };
    window.addEventListener('open-tooltip', handler as EventListener);
    return () => window.removeEventListener('open-tooltip', handler as EventListener);
  }, []);

  const handleOpenChange = (v: boolean) => {
    // Respect global disable flag (set by parent when inline descriptions are present)
    if (v && typeof document !== 'undefined' && document.body.getAttribute('data-disable-tooltips') === 'true') {
      if (controlledOpen === undefined) setOpen(false);
      if (onOpenChange) onOpenChange(false);
      return;
    }
    if (controlledOpen === undefined) setOpen(v);
    if (v) window.dispatchEvent(new CustomEvent('open-tooltip', { detail: idRef.current }));
    if (onOpenChange) onOpenChange(v);
  };

  return (
    <TooltipPrimitive.Root {...props} open={open} onOpenChange={handleOpenChange} delayDuration={100} disableHoverableContent={false}>
      {children}
    </TooltipPrimitive.Root>
  );
};
Tooltip.displayName = 'Tooltip';

const TooltipContent: React.FC<React.ComponentProps<typeof TooltipPrimitive.Content>> = ({
  className,
  sideOffset = 4,
  ...props
}) => (
  <TooltipPortal>
    <TooltipPrimitive.Content sideOffset={sideOffset} className={classNames(styles.content, className)} {...props} />
  </TooltipPortal>
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipPortal };
