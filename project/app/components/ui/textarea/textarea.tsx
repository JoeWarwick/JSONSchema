import * as React from "react";
import classNames from "classnames";
import styles from "./textarea.module.css";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return <textarea ref={ref} className={classNames(styles.textarea, className)} {...props} />;
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
