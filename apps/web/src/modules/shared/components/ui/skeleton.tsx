import { cn } from "@/modules/shared/lib/utils"
import styles from "./skeleton.module.css"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(styles.shimmer, "rounded", className)}
      {...props}
    />
  )
}

export { Skeleton }
