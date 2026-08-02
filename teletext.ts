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

/** The committed fallback, used when the feed will not answer. */
export const SNAPSHOT = "data/news.json";

/**
 * The bulletin this build is rendering, written once by the prepare step.
 *
 * The network is called in exactly one place. If the page generator and the
 * plugin each read the feed themselves, a story that arrives between the two
 * calls puts a headline on page 101 that points at a page telling a different
 * story — a wrong site rather than a stale one.
 */
export const BUILD_BULLETIN = ".bulletin.json";

/** The first story page. Teletext put the news in the 300s. */
export const FIRST_STORY_PAGE = 301;

/** How many stories get a page of their own. */
export const STORY_PAGES = 6;

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

export function readBuildBulletin(): Bulletin {
  return JSON.parse(readFileSync(BUILD_BULLETIN, "utf8")) as Bulletin;
}

export function writeBuildBulletin(bulletin: Bulletin): void {
  writeFileSync(BUILD_BULLETIN, `${JSON.stringify(bulletin, null, 2)}\n`);
}

/** The page number a story is told on, and the stories that get one. */
export function storyPages(bulletin: Bulletin): { page: number; story: Story }[] {
  return bulletin.stories
    .slice(0, STORY_PAGES)
    .map((story, index) => ({ page: FIRST_STORY_PAGE + index, story }));
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

/**
 * A headline with its page number set hard against the right margin.
 *
 * This is teletext's signature and the thing a numbered list cannot do: the
 * reader's eye runs down a column of three-digit numbers, each one naming where
 * that story is told. The number is placed by arithmetic on the grid rather
 * than by an alignment rule that could round differently.
 *
 * The whole headline is the link, not just the number. On the phone viewport
 * three digits are about twenty-five pixels wide, which is not a target anyone
 * can hit — and a page number that a reader cannot act on is decoration
 * pretending to be navigation.
 */
export function renderHeadlines(pages: { page: number; story: Story }[]): string {
  return pages
    .map(({ page, story }) => {
      const ref = String(page);
      const lines = wrap(story.title, COLUMNS - ref.length - 1);
      const head = lines[0] ?? "";
      const gap = " ".repeat(Math.max(1, COLUMNS - ref.length - head.length));
      const first =
        `<p class="row lead">${escapeHtml(head)}${gap}` +
        `<span class="pageref">${ref}</span></p>`;
      const rest = lines
        .slice(1)
        .map((line) => `<p class="row cont">${escapeHtml(line)}</p>`)
        .join("\n");
      return [
        `<li class="headline">`,
        `<a class="headline-link" href="./${ref}.html">`,
        first,
        rest,
        `</a>`,
        `</li>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

/** The in-brief page: one story per line, cut rather than wrapped. */
export function renderBrief(stories: Story[]): string {
  return stories
    .map((story) => {
      const [line] = wrap(story.title, COLUMNS);
      return `<li><p class="row cont">${escapeHtml(line ?? "")}</p></li>`;
    })
    .join("\n");
}

// The source is British; the reader is not. This bulletin is read in Canberra,
// so it keeps Canberra's clock and converts the feed's timestamps into it.
//
// Pinning the zone matters beyond taste: the deploy builds on a CI runner set to
// UTC, so a clock left to the machine would read two hours behind the room the
// page is demoed in.
const SERVICE_ZONE = "Australia/Canberra";

function inZone(date: Date, options: Intl.DateTimeFormatOptions): string {
  // en-GB renders the date without a comma, which the grid prefers.
  return new Intl.DateTimeFormat("en-GB", { timeZone: SERVICE_ZONE, ...options }).format(date);
}

/** "18:24" in Canberra, whatever the building machine's clock says. */
export function serviceTime(date: Date): string {
  return inZone(date, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "AEST" in winter, "AEDT" over summer. Only en-AU names them; en-GB says "GMT+10". */
export function serviceZone(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: SERVICE_ZONE,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/**
 * A story page's headline, which is also the page's one top-level heading.
 *
 * It is wrapped into grid rows rather than left to the browser: a heading that
 * reflows on its own is the one element that would break the grid, and it is
 * the most visible line on the page.
 */
export function renderStoryHead(story: Story): string {
  return rows(wrap(story.title, BODY_WIDTH), "row lead");
}

/** The rest of a story page: the summary, and when the story filed. */
export function renderStoryBody(story: Story): string {
  const filed = new Date(story.published);
  return [
    rows(wrap(story.summary, BODY_WIDTH), "row cont"),
    `<p class="row"> </p>`,
    `<p class="row stamp">Filed ${serviceTime(filed)} ${serviceZone(filed)}</p>`,
  ].join("\n");
}

/**
 * Expand authored prose into grid rows.
 *
 * A `<p class="wrap">` in a page is written as ordinary readable prose; the
 * build breaks it to the column count. The alternative is counting characters
 * by hand in the markup, which is how a grid drifts one column wider without
 * anyone noticing.
 *
 * Any further classes are carried through, so `class="wrap source"` becomes
 * grid rows that are still styled as a source line. Every piece of prose on the
 * page goes through here; anything that does not is being wrapped by the
 * browser instead, which is the one thing the grid cannot survive.
 */
export function expandProse(html: string): string {
  return html.replace(/<p class="wrap([^"]*)">([\s\S]*?)<\/p>/g, (_, extra: string, text: string) => {
    const flat = decodeEntities(text).replace(/\s+/g, " ").trim();
    return rows(wrap(flat, BODY_WIDTH), `row${extra}`);
  });
}

/**
 * How many rows of the grid a finished page occupies.
 *
 * Teletext never scrolled. A page was a screenful, and anything that did not
 * fit went on the next page — so the honest translation is to let the cell size
 * follow the page rather than let the page run off the bottom of the screen.
 * That needs a row count, which is only knowable if every piece of vertical
 * space is a whole number of rows: the stylesheet has no margin that is not
 * exactly one row, which is why this can be counted rather than measured.
 */
export function countRows(html: string): number {
  const tally = (pattern: RegExp): number => (html.match(pattern) ?? []).length;

  const dirRows = Math.ceil(tally(/class="dir-row"/g) / 2);

  return (
    1 + // the status row
    1 + // the bar of colour under it
    tally(/class="band /g) +
    tally(/class="dh"/g) * 2 + // double height: one row of layout, one reserved
    tally(/class="row[" ]/g) +
    tally(/class="index-row"/g) +
    tally(/class="headline"/g) + // each is followed by one blank row
    (dirRows > 0 ? dirRows + 1 : 0) + // the directory, and the blank row above it
    2 // the blank row above the coloured keys, and the keys
  );
}

/**
 * The divisor the stylesheet uses to size a cell from the viewport height.
 *
 * Rows are 1.25em tall, and one spare row keeps the last line clear of the
 * bottom edge.
 */
export function heightUnits(html: string): number {
  return Math.ceil(countRows(html) * 1.25) + 1;
}

/** The clock in every page header, in the style the service used. */
export function renderClock(bulletin: Bulletin): string {
  const at = new Date(bulletin.fetchedAt);
  const day = inZone(at, { weekday: "short", day: "2-digit", month: "short" });
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
    buildStart() {
      // No network here: the prepare step already read the feed once and wrote
      // what this build renders, so every page comes from the same bulletin.
      bulletin = readBuildBulletin();
    },
    transformIndexHtml: {
      order: "pre",
      handler(html: string, ctx): string {
        if (!bulletin) throw new Error("no bulletin loaded");
        const pages = storyPages(bulletin);

        const page = /(\d{3})\.html$/.exec(ctx.path);
        const onThisPage = page ? pages.find((p) => p.page === Number(page[1])) : undefined;

        const filled = expandProse(
          html
            .replaceAll("<!--tt:clock-->", renderClock(bulletin))
            .replaceAll("<!--tt:count-->", String(bulletin.stories.length))
            .replaceAll("<!--tt:source-->", escapeHtml(bulletin.source))
            .replaceAll("<!--tt:headlines-->", renderHeadlines(pages))
            .replaceAll("<!--tt:brief-->", renderBrief(bulletin.stories.slice(STORY_PAGES)))
            .replaceAll(
              "<!--tt:story-head-->",
              onThisPage ? renderStoryHead(onThisPage.story) : "",
            )
            .replaceAll(
              "<!--tt:story-body-->",
              onThisPage ? renderStoryBody(onThisPage.story) : "",
            ),
        );

        // Sized last, because the page has to be finished before it can be
        // counted.
        return filled.replace("<body>", `<body style="--tt-vunit: ${heightUnits(filled)}">`);
      },
    },
  };
}
