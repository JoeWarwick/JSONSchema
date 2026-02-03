import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import classNames from "classnames";
import styles from "./popover.module.css";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Content> & { simple?: boolean };
const PopoverContent: React.FC<PopoverContentProps> = ({
  className,
  align = "center",
  sideOffset = 4,
  simple = false,
  ...props
}) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      align={align}
      sideOffset={sideOffset}
      className={classNames(styles.content, simple ? styles.simple : undefined, className)}
      {...props}
    />
  </PopoverPrimitive.Portal>
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
