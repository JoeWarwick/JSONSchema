import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";
import classNames from "classnames";
import styles from "./resizable.module.css";

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup className={classNames(styles.group, className)} {...props} />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.PanelResizeHandle className={classNames(styles.handle, className)} {...props}>
    {withHandle && (
      <div className={styles.gripWrapper}>
        <GripVertical className={styles.gripIcon} />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
