import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";
import { COLUMNS } from "../teletext";

// This week's published spec, in the lines a machine can settle. The rest —
// whether the look commits to the era — is the crit's job, not this file's.
//
// These run against the BUILT site, because the built site is the deliverable.

const DIST = resolve("dist");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

type Page = { name: string; doc: Document; html: string };

let pages: Page[] = [];

beforeAll(() => {
  pages = files(DIST)
    .filter((path) => path.endsWith(".html"))
    .map((path) => {
      const html = readFileSync(path, "utf8");
      return {
        name: path.slice(DIST.length + 1).replace(/\\/g, "/"),
        doc: new JSDOM(html).window.document,
        html,
      };
    });
});

describe("no JavaScript ships", () => {
  // The brief allows plain HTML and CSS. The feed is read at build time, so
  // this is the assertion that the build stayed on the right side of that.
  it("builds no script file at all", () => {
    expect(files(DIST).filter((path) => path.endsWith(".js"))).toEqual([]);
  });

  it("has no script element on any page", () => {
    for (const { name, doc } of pages) {
      expect(doc.querySelectorAll("script"), `${name} has a script element`).toHaveLength(0);
    }
  });

  it("has no inline event handler on any page", () => {
    for (const { name, html } of pages) {
      expect(/\son[a-z]+\s*=/i.test(html), `${name} has an inline handler`).toBe(false);
    }
  });
});

describe("it is a real site", () => {
  it("has several pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(4);
  });

  // "each reachable from the home page" — followed, not assumed.
  it("reaches every page from the home page", () => {
    const known = new Set(pages.map((page) => page.name));
    const byName = new Map(pages.map((page) => [page.name, page]));
    const seen = new Set(["index.html"]);
    const queue = ["index.html"];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const page = byName.get(current);
      if (!page) continue;
      for (const anchor of page.doc.querySelectorAll("a[href]")) {
        const href = anchor.getAttribute("href") ?? "";
        if (/^[a-z]+:/i.test(href) || href.startsWith("#")) continue;
        const target = href === "./" || href === "" ? "index.html" : href.replace(/^\.\//, "");
        if (known.has(target) && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }

    const unreachable = pages.map((page) => page.name).filter((name) => !seen.has(name));
    expect(unreachable, "pages with no path from the home page").toEqual([]);
  });

  it("lets every page get back to the home page", () => {
    for (const { name, doc } of pages) {
      if (name === "index.html") continue;
      const home = [...doc.querySelectorAll("a[href]")].some((anchor) => {
        const href = anchor.getAttribute("href");
        return href === "./" || href === "index.html" || href === "./index.html";
      });
      expect(home, `${name} cannot return to the home page`).toBe(true);
    }
  });
});

describe("the teletext grid", () => {
  it("wraps every row inside the page width", () => {
    for (const { name, doc } of pages) {
      for (const row of doc.querySelectorAll("p.row")) {
        const text = row.textContent ?? "";
        expect(text.length, `${name}: "${text}" is ${text.length} columns`).toBeLessThanOrEqual(
          COLUMNS,
        );
      }
    }
  });

  it("gives every page a unique three-digit page number", () => {
    const numbers = pages.map(({ name, doc }) => {
      const shown = doc.querySelector(".page-no")?.textContent?.trim() ?? "";
      expect(shown, `${name} has no page number`).toMatch(/^P\d{3}$/);
      return shown;
    });
    expect(new Set(numbers).size, "two pages share a page number").toBe(numbers.length);
  });

  it("leaves no unfilled slot behind", () => {
    for (const { name, html } of pages) {
      expect(html, `${name} still has a build placeholder`).not.toContain("<!--tt:");
    }
  });
});

describe("the coloured keys", () => {
  it("gives every page four of them", () => {
    for (const { name, doc } of pages) {
      expect(doc.querySelectorAll(".fastext .key"), `${name}`).toHaveLength(4);
    }
  });

  // Four keys share one row of forty columns, so a label has ten to fit in.
  // Longer and it is clipped at the phone viewport, which is a marked one.
  it("keeps every label inside its quarter of the row", () => {
    for (const { name, doc } of pages) {
      for (const key of doc.querySelectorAll(".fastext .key")) {
        const label = (key.textContent ?? "").trim();
        expect(label.length, `${name}: "${label}" will clip`).toBeLessThanOrEqual(
          Math.floor(COLUMNS / 4),
        );
      }
    }
  });

  it("marks the key for the page you are on as unavailable", () => {
    for (const { name, doc } of pages) {
      if (name === "index.html") continue;
      const disabled = doc.querySelectorAll('.fastext .key[aria-disabled="true"]');
      expect(disabled, `${name} should dim its own key`).toHaveLength(1);
      expect(disabled[0].tagName).not.toBe("A");
    }
  });
});
