// The teletext engine: fetch a news feed, wrap it to a fixed grid, and inject
// it into hand-written pages at build time.
//
// Why build time: the brief forbids JavaScript in the shipped site, so nothing
// here reaches the browser. The build reads the feed and emits plain HTML.
//
// Why a fixed grid: teletext pages were 40 columns by 24 rows, and the wrapping
// is not decoration — it is the medium. A headline that does not fit is cut,
// exactly as it was on air.
import { readFileSync, writeFileSync } from "node:fs";
import type { Plugin } from "vite";

/** Teletext's line length. Every rendered row is wrapped to this. */
export const COLUMNS = 40;

/** Columns left for prose once a row is indented and numbered. */
const BODY_WIDTH = 36;

export const FEED_URL = "https://feeds.bbci.co.uk/news/rss.xml";
export const SNAPSHOT = "data/news.json";

export type Story = {
  title: string;
  summary: string;
  published: string;
};

export type Bulletin = {
  /** When the feed was read. Teletext pages always carried their own clock. */
  fetchedAt: string;
  source: string;
  stories: Story[];
};

// --- feed parsing -----------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Resolve the XML entities a feed actually uses, including numeric ones. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

function field(item: string, name: string): string {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(item);
  if (!match) return "";
  const raw = match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
  return decodeEntities(raw).replace(/\s+/g, " ").trim();
}

/** A bulletin is a bulletin: anything older than this is not news. */
export const MAX_AGE_HOURS = 48;

/** Compare headlines on their words alone, so punctuation can't hide a repeat. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn an RSS document into stories.
 *
 * The feed lies in two ways that both reach the page if you trust it, and
 * neither is visible until you look at the data:
 *
 * 1. It carries house promos alongside the news. "BBC News app" has a summary
 *    like any story, so filtering on missing fields does not catch it — but its
 *    timestamp is over a year old, and a bulletin has no business showing it.
 *    The age window catches it as a side effect of being correct about news.
 *
 * 2. The section feeds repeat a front-page story under a shortened headline, so
 *    "…has waited for with men's mile gold" and "…has waited for" are one story
 *    twice. Exact-title dedupe misses it; one normalised headline being a prefix
 *    of another catches it. The longer headline wins, being the fuller one.
 *
 * Order is the feed's own, because that ordering is editorial and worth keeping.
 */
export function parseFeed(xml: string, now: number = Date.now()): Story[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  const candidates = items.flatMap((item) => {
    const title = field(item, "title");
    const summary = field(item, "description");
    const pubDate = field(item, "pubDate");
    if (!title || !summary || !pubDate) return [];

    const published = new Date(pubDate);
    if (Number.isNaN(published.getTime())) return [];
    if (now - published.getTime() > MAX_AGE_HOURS * 3_600_000) return [];

    return [{ title, summary, published: published.toISOString(), norm: normaliseTitle(title) }];
  });

  return candidates
    .filter((story, index) =>
      candidates.every((other, otherIndex) => {
        if (index === otherIndex) return true;
        if (!other.norm.startsWith(story.norm)) return true;
        // A longer headline wins; between identical ones, the earlier wins.
        return other.norm.length === story.norm.length && otherIndex > index;
      }),
    )
    .map(({ title, summary, published }) => ({ title, summary, published }));
}

// --- the fixed grid ---------------------------------------------------------

/**
 * Hard-wrap to a column count, the way a teletext page had to.
 *
 * A word longer than the line is broken rather than allowed to overhang: the
 * grid has no give in it.
 */
export function wrap(text: string, width: number = BODY_WIDTH): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let piece = word;
    while (piece.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(piece.slice(0, width));
      piece = piece.slice(width);
    }
    if (!line) {
      line = piece;
    } else if (line.length + 1 + piece.length <= width) {
      line += ` ${piece}`;
    } else {
      lines.push(line);
      line = piece;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// --- reading the feed, with a snapshot to fall back to ----------------------

export function readSnapshot(): Bulletin {
  return JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Bulletin;
}

export function writeSnapshot(bulletin: Bulletin): void {
  writeFileSync(SNAPSHOT, `${JSON.stringify(bulletin, null, 2)}\n`);
}

async function readFeedOnce(): Promise<string> {
  const response = await fetch(FEED_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`feed returned HTTP ${response.status}`);
  return await response.text();
}

/**
 * Read the feed, retrying a transient failure.
 *
 * The name resolves intermittently from here, and a single DNS blip is not a
 * reason to serve a stale page — but three in a row is, which is what the
 * snapshot is for.
 */
export async function fetchBulletin(attempts = 3): Promise<Bulletin> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const stories = parseFeed(await readFeedOnce());
      if (stories.length === 0) throw new Error("feed parsed to zero stories");
      return { fetchedAt: new Date().toISOString(), source: "BBC News", stories };
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * The bulletin the build renders: live if the feed answers, the committed
 * snapshot if it does not.
 *
 * The deploy rebuilds on every push, so a feed that is slow or refusing
 * requests would otherwise take the whole site down. A stale page is a
 * teletext page; a failed build is nothing at all.
 */
export async function loadBulletin(): Promise<Bulletin> {
  try {
    return await fetchBulletin();
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.warn(`[teletext] live feed unavailable (${why}) — using ${SNAPSHOT}`);
    return readSnapshot();
  }
}

// --- rendering --------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** One wrapped block of prose as teletext rows. */
function rows(lines: string[], className: string): string {
  return lines.map((line) => `<p class="${className}">${escapeHtml(line)}</p>`).join("\n");
}

/** A numbered headline: the number sits in the margin, the text wraps under it. */
export function renderHeadlines(stories: Story[]): string {
  return stories
    .map((story, index) => {
      const lines = wrap(story.title, BODY_WIDTH - 3);
      const body = lines
        .map((line, lineIndex) => {
          const gutter = lineIndex === 0 ? String(index + 1).padStart(2) : "  ";
          return `<p class="row"><span class="gutter">${gutter}</span> ${escapeHtml(line)}</p>`;
        })
        .join("\n");
      return `<li class="headline">\n${body}\n</li>`;
    })
    .join("\n");
}

// The service was British, so its clock is: London time, labelled with whatever
// London is calling it today. Showing UTC would be a near miss for half the
// year, which is worse than being obviously foreign.
const SERVICE_ZONE = "Europe/London";

function inLondon(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: SERVICE_ZONE, ...options }).format(date);
}

/** "18:24" in London, whatever the reader's own clock says. */
export function serviceTime(date: Date): string {
  return inLondon(date, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "BST" in summer, "GMT" in winter. */
export function serviceZone(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SERVICE_ZONE,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/** A story in full: headline, then its summary, then its clock. */
export function renderStories(stories: Story[]): string {
  return stories
    .map((story) => {
      const time = new Date(story.published);
      const stamp = `${serviceTime(time)} ${serviceZone(time)}`;
      return [
        `<li class="story">`,
        rows(wrap(story.title, BODY_WIDTH), "row headline-row"),
        rows(wrap(story.summary, BODY_WIDTH), "row"),
        `<p class="row stamp">${stamp}</p>`,
        `</li>`,
      ].join("\n");
    })
    .join("\n");
}

/**
 * Expand authored prose into grid rows.
 *
 * A `<p class="wrap">` in a page is written as ordinary readable prose; the
 * build breaks it to the column count. The alternative is counting characters
 * by hand in the markup, which is how a grid drifts one column wider without
 * anyone noticing.
 */
export function expandProse(html: string): string {
  return html.replace(/<p class="wrap">([\s\S]*?)<\/p>/g, (_, text: string) => {
    const flat = decodeEntities(text).replace(/\s+/g, " ").trim();
    return rows(wrap(flat, BODY_WIDTH), "row");
  });
}

/** The clock in every page header, in the style the service used. */
export function renderClock(bulletin: Bulletin): string {
  const at = new Date(bulletin.fetchedAt);
  const day = inLondon(at, { weekday: "short", day: "2-digit", month: "short" });
  return escapeHtml(`${day} ${serviceTime(at)} ${serviceZone(at)}`);
}

// --- the Vite plugin --------------------------------------------------------

/**
 * Fill the slots in the hand-written pages.
 *
 * The pages are real files with real structure — the headings, the landmarks
 * and the navigation are all authored, not generated. Only the feed's own words
 * are injected, which keeps the markup readable and the invariants visible in
 * the source.
 */
export function teletext(): Plugin {
  let bulletin: Bulletin | undefined;

  return {
    name: "teletext",
    async buildStart() {
      bulletin = await loadBulletin();
    },
    transformIndexHtml: {
      order: "pre",
      handler(html: string): string {
        if (!bulletin) throw new Error("no bulletin loaded");
        const { stories } = bulletin;
        return expandProse(
          html
            .replaceAll("<!--tt:clock-->", renderClock(bulletin))
            .replaceAll("<!--tt:count-->", String(stories.length))
            .replaceAll("<!--tt:source-->", escapeHtml(bulletin.source))
            .replaceAll("<!--tt:headlines-->", renderHeadlines(stories.slice(0, 9)))
            .replaceAll("<!--tt:stories-->", renderStories(stories.slice(0, 4)))
            .replaceAll("<!--tt:more-->", renderStories(stories.slice(4, 9))),
        );
      },
    },
  };
}
