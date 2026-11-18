// YouTube helpers for the Dinleme (listening) block.
//
// Why no API key: the oEmbed endpoint is public and returns the title, channel and thumbnail
// for any public video. That is all the listening log needs, so there is no secret to protect.

import { z } from "zod";

/** A YouTube video id is always exactly 11 characters from this alphabet. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Hosts that carry the id in `?v=` or in a /shorts/ or /embed/ path. */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** Hosts of the short link form: https://youtu.be/<id>. */
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

function asValidId(candidate: string | null | undefined): string | null {
  return candidate !== null && candidate !== undefined && VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Extracts the 11-character video id from any common YouTube link, or returns null.
 * Handles watch?v=, youtu.be/, /shorts/, /embed/, m.youtube.com and extra params (&t=, ?si=...).
 */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;

  // People paste links without the scheme ("youtu.be/abc"); `URL` needs one, so add it.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((part) => part !== "");

  if (SHORT_HOSTS.has(host)) {
    return asValidId(segments[0]);
  }
  if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") return asValidId(url.searchParams.get("v"));
    if (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "live") {
      return asValidId(segments[1]);
    }
  }
  // Any other host is rejected on purpose: we must not treat random sites as YouTube links.
  return null;
}

/** The canonical watch link for an id. */
export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** The parts of the oEmbed answer the app uses. Extra fields are ignored. */
const oEmbedSchema = z.object({
  title: z.string(),
  author_name: z.string(),
  thumbnail_url: z.string(),
});

export type OEmbedInfo = z.infer<typeof oEmbedSchema>;

/**
 * Why a lookup failed:
 * - "network": no connection, timeout, or a server error. Trying again later may work.
 * - "not-found": the video is private, removed, or not embeddable. Trying again will not help.
 * - "invalid": the input is not a YouTube link, or the answer had an unexpected shape.
 */
export type OEmbedFailure = "network" | "not-found" | "invalid";

export type OEmbedResult = { ok: true; info: OEmbedInfo } | { ok: false; reason: OEmbedFailure };

/** Minimal fetch shape, so tests can pass a fake without network. */
export type FetchLike = (input: string) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** Looks up title, channel and thumbnail for a YouTube link. Never throws. */
export async function fetchOEmbed(url: string, fetchImpl: FetchLike = (input) => fetch(input)): Promise<OEmbedResult> {
  // Normalise first: oEmbed only needs a clean watch link, and a bad link must not hit the network.
  const id = parseYouTubeId(url);
  if (id === null) return { ok: false, reason: "invalid" };

  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(id))}&format=json`;

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(endpoint);
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) {
    // YouTube answers 400/401/403/404 for private, deleted or non-embeddable videos.
    const missing = response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404;
    return { ok: false, reason: missing ? "not-found" : "network" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const parsed = oEmbedSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return { ok: true, info: parsed.data };
}
