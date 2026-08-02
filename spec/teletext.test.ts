import { describe, expect, it } from "vitest";
import {
  MAX_AGE_HOURS,
  decodeEntities,
  loadBulletin,
  normaliseTitle,
  parseFeed,
  serviceTime,
  serviceZone,
  wrap,
} from "../teletext";

// Contracts for the engine that turns a feed into a fixed grid. These test what
// the pages must be true of, not how the engine is written: the grid has a hard
// width, and the feed's two ways of lying both have to be caught.

const NOW = Date.parse("2026-08-02T08:00:00Z");

function item(fields: { title?: string; summary?: string; ago?: number }): string {
  const { title = "A headline", summary = "A summary.", ago = 1 } = fields;
  const published = new Date(NOW - ago * 3_600_000).toUTCString();
  return `<item>
    <title><![CDATA[${title}]]></title>
    <description><![CDATA[${summary}]]></description>
    <pubDate>${published}</pubDate>
  </item>`;
}

function feed(items: string[]): string {
  return `<rss><channel>${items.join("")}</channel></rss>`;
}

describe("the fixed grid", () => {
  it("never emits a line wider than the grid", () => {
    const prose =
      "Trump says he is cancelling strikes on Iran subject to deal being made rapidly";
    for (const line of wrap(prose, 36)) expect(line.length).toBeLessThanOrEqual(36);
  });

  it("breaks a word that cannot fit rather than letting it overhang", () => {
    expect(wrap("supercalifragilistic ok", 12)).toEqual(["supercalifra", "gilistic ok"]);
  });

  it("keeps every word", () => {
    const prose = "the quick brown fox jumps over the lazy dog";
    expect(wrap(prose, 11).join(" ").split(/\s+/)).toEqual(prose.split(" "));
  });

  it("emits nothing for nothing", () => {
    expect(wrap("   ", 36)).toEqual([]);
  });
});

describe("feed entities", () => {
  it("resolves named, decimal and hex entities", () => {
    expect(decodeEntities("a &amp; b &#39;c&#39; &quot;d&quot; &lt;e&gt; &#x2014;")).toBe(
      `a & b 'c' "d" <e> —`,
    );
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(decodeEntities("&notanentity;")).toBe("&notanentity;");
  });
});

describe("the build survives a feed that does not answer", () => {
  // The deploy rebuilds on every push, so a feed outage would otherwise take
  // the whole site down. This is the claim PROCESS.md makes, held by a check.
  it("serves the committed snapshot instead of failing", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("getaddrinfo ENOTFOUND"));
    try {
      const bulletin = await loadBulletin();
      expect(bulletin.stories.length).toBeGreaterThan(0);
      expect(bulletin.source).toBeTruthy();
      expect(Number.isNaN(Date.parse(bulletin.fetchedAt))).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 20_000);
});

describe("the service clock", () => {
  // A British service kept British time, and half the year that is not UTC.
  it("reads London time in summer, not UTC", () => {
    const summer = new Date("2026-08-02T08:00:00Z");
    expect(serviceTime(summer)).toBe("09:00");
    expect(serviceZone(summer)).toBe("BST");
  });

  it("reads London time in winter, which is UTC", () => {
    const winter = new Date("2026-01-15T08:00:00Z");
    expect(serviceTime(winter)).toBe("08:00");
    expect(serviceZone(winter)).toBe("GMT");
  });

  it("does not follow the reader's own clock", () => {
    const instant = new Date("2026-08-02T22:30:00Z");
    expect(serviceTime(instant)).toBe("23:30");
  });
});

describe("headline normalisation", () => {
  it("compares on words alone", () => {
    expect(normaliseTitle("Kerr's mile gold — at last!")).toBe("kerr s mile gold at last");
  });
});

describe("what reaches the bulletin", () => {
  it("drops a house promo dated outside the window even though it has a summary", () => {
    const stories = parseFeed(
      feed([
        item({ title: "Real news today" }),
        item({ title: "BBC News app", summary: "Download it.", ago: MAX_AGE_HOURS + 1 }),
      ]),
      NOW,
    );
    expect(stories.map((s) => s.title)).toEqual(["Real news today"]);
  });

  it("keeps a story right at the edge of the window", () => {
    const stories = parseFeed(feed([item({ ago: MAX_AGE_HOURS })]), NOW);
    expect(stories).toHaveLength(1);
  });

  it("treats a shortened repeat as the same story and keeps the fuller headline", () => {
    const long = "Emotional Kerr delivers moment Glasgow 2026 has waited for with men's mile gold";
    const short = "Emotional Kerr delivers moment Glasgow 2026 has waited for";
    const stories = parseFeed(feed([item({ title: long }), item({ title: short })]), NOW);
    expect(stories.map((s) => s.title)).toEqual([long]);
  });

  it("catches the repeat whichever order the feed lists it in", () => {
    const long = "Root in a very different place over Test captaincy this summer";
    const short = "Root in a very different place";
    const stories = parseFeed(feed([item({ title: short }), item({ title: long })]), NOW);
    expect(stories.map((s) => s.title)).toEqual([long]);
  });

  it("keeps the first of two identical headlines, once", () => {
    const stories = parseFeed(feed([item({ title: "Same" }), item({ title: "Same" })]), NOW);
    expect(stories).toHaveLength(1);
  });

  it("does not confuse two stories that merely start alike", () => {
    const stories = parseFeed(
      feed([
        item({ title: "Peru plane crash kills 13" }),
        item({ title: "Peru plane crash inquiry opens in Lima" }),
      ]),
      NOW,
    );
    expect(stories).toHaveLength(2);
  });

  it("drops an item with no summary", () => {
    const stories = parseFeed(feed([item({ summary: "" })]), NOW);
    expect(stories).toEqual([]);
  });

  it("keeps the feed's own ordering, which is editorial", () => {
    const stories = parseFeed(
      feed([item({ title: "First" }), item({ title: "Second" }), item({ title: "Third" })]),
      NOW,
    );
    expect(stories.map((s) => s.title)).toEqual(["First", "Second", "Third"]);
  });
});
