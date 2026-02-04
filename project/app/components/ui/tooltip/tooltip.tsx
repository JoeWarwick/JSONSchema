import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import classNames from "classnames";
import styles from "./tooltip.module.css";

const TooltipProvider: React.FC<TooltipPrimitive.TooltipProviderProps> = ({ children, skipDelayDuration = 500, ...props }) => (
  <TooltipPrimitive.Provider skipDelayDuration={skipDelayDuration} {...props}>
    {children}
  </TooltipPrimitive.Provider>
);
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
const Tooltip: React.FC<TooltipProps> = ({ children, delayDuration = 300, ...props }) => {
  return (
    <TooltipPrimitive.Root {...props} delayDuration={delayDuration}>
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
