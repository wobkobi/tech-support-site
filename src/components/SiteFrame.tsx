// src/components/SiteFrame.tsx
/**
 * Site frame with full-bleed backdrop and consistent gutters.
 * @param props.children page content
 * @returns Frame element.
 */
import { cn } from "@/lib/cn";
import Image from "next/image";

/**
 * Full-bleed blurred image backdrop.
 * @returns React element.
 */
export function PageBackdrop(): React.ReactElement {
  return (
    <div
      className={cn(
        "bg-seasalt-600 pointer-events-none fixed -inset-px -z-10 overflow-hidden"
      )}>
      <Image
        src="/backdrop.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className={cn(
          "absolute inset-0 h-full w-full object-cover blur-xl",
          "[transform-origin:center] [transform:scale(1.14)] will-change-transform"
        )}
      />
    </div>
  );
}

/**
 * Centers content and applies the frosted panel.
 * @param root0 Component props.
 * @param root0.children Children to render inside the panel.
 * @returns React element.
 */
export function FrostedSection({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={cn("mx-auto w-full max-w-[min(100vw-2rem,68rem)]")}>
      <div
        className={cn(
          "border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-4 shadow-lg backdrop-blur-xl sm:p-8"
        )}>
        {children}
      </div>
    </div>
  );
}

/**
 * Main page shell with gutters and backdrop.
 * @param root0 Component props.
 * @param root0.children Children to render inside the shell.
 * @returns React element.
 */
export function PageShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <main
      className={cn(
        "relative flex min-h-dvh w-full flex-col overflow-hidden pt-6 pb-6 sm:pt-10 sm:pb-10"
      )}>
      <PageBackdrop />
      {children}
    </main>
  );
}
