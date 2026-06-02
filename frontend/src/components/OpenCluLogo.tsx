import "./OpenCluLogo.css";
import { cn } from "@/lib/utils";

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="OpenClu"
      className={cn("text-primary", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="16" className="fill-primary/15" />
      <circle cx="32" cy="28" r="10" className="stroke-primary" strokeWidth="3" />
      <path
        d="M18 48c4-8 10-12 14-12s10 4 14 12"
        className="stroke-primary"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function OpenCluLogo({
  className,
  markOnly = false,
}: {
  className?: string;
  markOnly?: boolean;
  priority?: boolean;
}) {
  if (markOnly) {
    return <LogoMark className={cn("size-full", className)} />;
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark className="size-10 shrink-0" />
      <span className="text-lg font-semibold tracking-tight text-foreground">OpenClu</span>
    </div>
  );
}
