import { describe, expect, it } from "vitest";
import { fetchOEmbed, parseYouTubeId, watchUrl, type FetchLike } from "../youtube";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeId", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s`],
    [`https://www.youtube.com/watch?feature=share&v=${ID}`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://music.youtube.com/watch?v=${ID}&list=abc`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=xyz&t=10`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/shorts/${ID}?feature=share`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`youtu.be/${ID}`],
    [`  https://youtu.be/${ID}  `],
    [`http://www.youtube.com/watch?v=${ID}`],
  ])("finds the id in %s", (url) => {
    expect(parseYouTubeId(url)).toBe(ID);
  });

  it.each([
    [""],
    ["   "],
    ["not a url"],
    ["https://example.com/watch?v=" + ID],
    ["https://www.youtube.com/"],
    ["https://www.youtube.com/watch"],
    ["https://www.youtube.com/watch?v=short"],
    [`https://www.youtube.com/watch?v=${ID}extra`],
    ["https://www.youtube.com/playlist?list=PL123"],
    ["https://youtu.be/"],
    [`ftp://youtu.be/${ID}`],
    [`https://evil-youtube.com/watch?v=${ID}`],
  ])("returns null for %j", (url) => {
    expect(parseYouTubeId(url)).toBeNull();
  });
});

describe("watchUrl", () => {
  it("builds the canonical link", () => {
    expect(watchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});

function fakeFetch(status: number, body: unknown, calls: string[] = []): FetchLike {
  return async (input) => {
    calls.push(input);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body instanceof Error) throw body;
        return body;
      },
    };
  };
}

describe("fetchOEmbed", () => {
  const good = { title: "A talk", author_name: "Some Channel", thumbnail_url: "https://i.ytimg.com/x.jpg", extra: 1 };

  it("returns the validated info and calls the oEmbed endpoint with an encoded url", async () => {
    const calls: string[] = [];
    const result = await fetchOEmbed(`https://youtu.be/${ID}?si=abc`, fakeFetch(200, good, calls));
    expect(result).toEqual({
      ok: true,
      info: { title: "A talk", author_name: "Some Channel", thumbnail_url: "https://i.ytimg.com/x.jpg" },
    });
    expect(calls).toEqual([
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(ID))}&format=json`,
    ]);
  });

  it("does not hit the network for a bad link", async () => {
    const calls: string[] = [];
    const result = await fetchOEmbed("https://example.com", fakeFetch(200, good, calls));
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(calls).toEqual([]);
  });

  it("maps 404 and 401 to not-found", async () => {
    expect(await fetchOEmbed(`https://youtu.be/${ID}`, fakeFetch(404, {}))).toEqual({ ok: false, reason: "not-found" });
    expect(await fetchOEmbed(`https://youtu.be/${ID}`, fakeFetch(401, {}))).toEqual({ ok: false, reason: "not-found" });
  });

  it("maps server errors to network", async () => {
    expect(await fetchOEmbed(`https://youtu.be/${ID}`, fakeFetch(503, {}))).toEqual({ ok: false, reason: "network" });
  });

  it("maps a thrown fetch to network", async () => {
    const failing: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await fetchOEmbed(`https://youtu.be/${ID}`, failing)).toEqual({ ok: false, reason: "network" });
  });

  it("maps a wrong shape or broken JSON to invalid", async () => {
    expect(await fetchOEmbed(`https://youtu.be/${ID}`, fakeFetch(200, { title: "x" }))).toEqual({ ok: false, reason: "invalid" });
    expect(await fetchOEmbed(`https://youtu.be/${ID}`, fakeFetch(200, new SyntaxError("bad")))).toEqual({ ok: false, reason: "invalid" });
  });
});
