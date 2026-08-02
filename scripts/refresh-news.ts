#!/usr/bin/env node
// Refresh the committed bulletin snapshot.
//
// The build prefers the live feed, but a build that depends on someone else's
// uptime is a build that fails at the worst moment. This writes the fallback
// the build uses when the feed does not answer, so the snapshot is a deliberate
// artefact rather than whatever happened to be cached.
//
// Two ways in, because on this network node's resolver fails on a name curl
// resolves fine, and the snapshot is exactly the artefact you want when the
// network is being unreliable:
//
//   node scripts/refresh-news.ts                       # fetch it here
//   curl -s <feed> | node scripts/refresh-news.ts       # pipe it in
import { fetchBulletin, parseFeed, writeSnapshot, type Bulletin } from "../teletext.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

let bulletin: Bulletin;
if (process.stdin.isTTY) {
  bulletin = await fetchBulletin();
} else {
  const stories = parseFeed(await readStdin());
  if (stories.length === 0) throw new Error("piped feed parsed to zero stories");
  bulletin = { fetchedAt: new Date().toISOString(), source: "BBC News", stories };
}

writeSnapshot(bulletin);

console.log(`snapshot written: ${bulletin.stories.length} stories, read at ${bulletin.fetchedAt}`);
for (const story of bulletin.stories.slice(0, 5)) {
  console.log(`  - ${story.title}`);
}
