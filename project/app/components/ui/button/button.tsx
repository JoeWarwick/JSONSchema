import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import classNames from "classnames";
import styles from "./button.module.css";

interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={classNames(
        styles.base,
        styles[variant],
        styles[`size${size.charAt(0).toUpperCase() + size.slice(1)}`],
        className
      )}
      {...props}
    />
  );
});
Button.displayName = "Button";

export { Button };
