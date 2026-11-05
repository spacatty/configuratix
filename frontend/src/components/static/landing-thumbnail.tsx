"use client";

import * as React from "react";
import { Code2, FileArchive, Globe, Package } from "lucide-react";
import { api, type Landing } from "@/lib/api";
import { cn } from "@/lib/utils";

const FRAME_W = 1280;
const FRAME_H = 800;

export function landingPreviewUrl(l: Landing): string | null {
  return l.preview_path ? api.getApiUrl() + l.preview_path : null;
}

export function landingTypeIcon(type: string) {
  return type === "php" ? Code2 : type === "html" ? Globe : type === "asset" ? Package : FileArchive;
}

/**
 * Live, non-interactive thumbnail of an HTML landing (sandboxed iframe, scripts disabled,
 * lazily loaded). Falls back to a type glyph when there is no preview.
 */
export function LandingThumbnail({ landing, className }: { landing: Landing; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(0.25);
  const [loaded, setLoaded] = React.useState(false);
  const url = landingPreviewUrl(landing);
  const canFrame = !!url && landing.type === "html";
  const Icon = landingTypeIcon(landing.type);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !canFrame) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / FRAME_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [canFrame]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative aspect-[16/10] w-full overflow-hidden bg-surface-2/50 bg-grid",
        className
      )}
    >
      {canFrame ? (
        <>
          {!loaded && <div className="skeleton-shimmer absolute inset-0" />}
          <iframe
            src={url!}
            title={`${landing.name} preview`}
            sandbox=""
            loading="lazy"
            tabIndex={-1}
            aria-hidden
            onLoad={() => setLoaded(true)}
            className={cn("pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white transition-opacity", loaded ? "opacity-100" : "opacity-0")}
            style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})` }}
          />
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-subtle-foreground">
          <Icon className="size-6" />
          <span className="font-data text-[11px]">{landing.type}</span>
        </div>
      )}
    </div>
  );
}
