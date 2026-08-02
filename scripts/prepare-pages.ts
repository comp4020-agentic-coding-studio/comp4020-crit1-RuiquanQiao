#!/usr/bin/env node
// Read the feed once, and lay out the pages this build needs.
//
// This is the only place the network is touched. The Vite plugin then renders
// from what this wrote, so the headline list on page 101 and the story pages it
// points at always describe the same bulletin — a story arriving between two
// separate reads would otherwise give a page number that leads somewhere else.
//
// The story pages are generated rather than hand-written because there is one
// per story and their number follows the feed. They are ignored by git: the
// source of truth is this template plus the bulletin, not six near-identical
// files.
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { loadBulletin, storyPages, writeBuildBulletin } from "../teletext.ts";

// Only the 300s hold story pages. Matching every three-digit name would sweep
// away 199.html, which is hand-written and committed.
const STORY_PAGE_FILE = /^3\d{2}\.html$/;

function escape(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A coloured key: a link when it leads somewhere, dimmed when it does not. */
function key(colour, target, label) {
  const classes = `key key-${colour}`;
  return target === null
    ? `          <span class="${classes}" aria-disabled="true">${label}</span>`
    : `          <a class="${classes}" href="./${target}">${label}</a>`;
}

function storyPage(page, story, previous, next) {
  const title = escape(story.title);
  const short = title.length > 60 ? `${title.slice(0, 57)}...` : title;
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>P${page} ${short} — Teletext</title>
    <meta name="description" content="${short}" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="screen">
      <div class="statusbar">
        <span class="service">Teletext</span>
        <span class="page-no">${page}</span>
      </div>
      <div class="colourbar" aria-hidden="true"></div>
      <p class="band band-blue">Updated <!--tt:clock--></p>

      <main>
        <h1 class="story-head"><!--tt:story-head--></h1>
        <!--tt:story-body-->
      </main>

      <nav aria-label="Teletext pages">
        <ul class="dir">
          <li class="dir-row"><span>Index</span><a href="./">100</a></li>
          <li class="dir-row"><span>Heads</span><a href="./101.html">101</a></li>
          <li class="dir-row"><span>Brief</span><a href="./102.html">102</a></li>
          <li class="dir-row"><span>About</span><a href="./199.html">199</a></li>
        </ul>
        <div class="fastext">
${key("red", "101.html", "101 News")}
${key("green", previous === null ? null : `${previous}.html`, previous === null ? "Back" : `${previous} Back`)}
${key("yellow", next === null ? null : `${next}.html`, next === null ? "Next" : `${next} Next`)}
${key("cyan", "199.html", "199 About")}
        </div>
      </nav>
    </div>
  </body>
</html>
`;
}

const bulletin = await loadBulletin();
writeBuildBulletin(bulletin);

// Clear the previous build's story pages first, so a shorter bulletin cannot
// leave one behind that nothing links to — which CI's link check would not
// catch, being an orphan rather than a broken link.
for (const name of readdirSync(".")) {
  if (STORY_PAGE_FILE.test(name)) rmSync(name);
}

const pages = storyPages(bulletin);
for (const [index, { page, story }] of pages.entries()) {
  const previous = index > 0 ? pages[index - 1].page : null;
  const next = index < pages.length - 1 ? pages[index + 1].page : null;
  writeFileSync(`${page}.html`, storyPage(page, story, previous, next));
}

console.log(
  `bulletin: ${bulletin.stories.length} stories read at ${bulletin.fetchedAt}\n` +
    `story pages: ${pages.map((p) => p.page).join(", ")}`,
);
