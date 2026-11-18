import { useState } from "react";
import { cx } from "../../components/ui/index.ts";
import { thumbnailUrl } from "./logic/screen.ts";

interface VideoThumbProps {
  youtubeId: string;
  title: string;
  /** Shown in the corner badge, e.g. "14 dk". */
  durationText: string;
  /** "full" fills the card width; "small" is the 64px row thumbnail. */
  size: "full" | "small";
  /** Use this address instead of the standard YouTube one (the add form gets it from oEmbed). */
  src?: string;
}

/**
 * A 16:9 pale green tile with the video's picture on top when it loads.
 * Why the tile stays underneath: the picture comes from the internet, so offline or on a blocked
 * network it fails. The tile keeps the layout and the duration badge in place, and a failed load
 * simply hides the broken image icon.
 */
export function VideoThumb({ youtubeId, title, durationText, size, src }: VideoThumbProps) {
  // Remember WHICH address failed: a new address (another video in the same slot) gets a fresh try.
  const address = src ?? thumbnailUrl(youtubeId);
  const [failedAddress, setFailedAddress] = useState<string | null>(null);
  const showImage = failedAddress !== address;

  return (
    <div
      className={cx(
        "relative aspect-video shrink-0 overflow-hidden border border-dinleme-tile-border bg-dinleme-tile",
        size === "full" ? "w-full rounded-control" : "w-16 rounded-[5px]",
      )}
    >
      {showImage ? (
        <img
          src={address}
          alt={`Küçük resim: ${title}`}
          loading="lazy"
          onError={() => setFailedAddress(address)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {size === "full" ? (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-dinleme-tile px-1.5 py-0.5 text-[12px] leading-none font-semibold text-dinleme-ink tabular-nums">
          {durationText}
        </span>
      ) : null}
    </div>
  );
}
