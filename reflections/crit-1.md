# Crit 1 — Forgotten web

## The breakthrough

I started with what looked like a contradiction: I wanted real, current news,
and the brief allows no JavaScript. The breakthrough was noticing that this was
not a constraint to work around but the shape of the answer. Teletext pages were
snapshots with a clock on them, not live documents — so reading the feed once, at
build time, and stamping the page with when it was read is closer to the real
thing than fetching in the browser would have been.

The same move kept paying. CI validates outbound links, and the BBC refuses
automated requests often enough to break a deploy — and teletext had no
hyperlinks at all, so plain-text attribution was both the safe choice and the
authentic one. Twice the constraint pointed at the more faithful design. I had
expected the era to be something I imitated on top of a modern site; it turned
out to be something I could let the limits produce.

## What it changed

The habit I want to break is trusting what a thing looks like. A screenshot told
me my layout was broken when measurement showed it was already correct, and the
feed looked clean until I read the raw items and found a promo dated 458 days ago
sitting in "today's news". Both times, looking was wrong and checking was right.

So the developer I want to be is one who builds the sensor before forming the
opinion — and who puts a correction into the checks rather than into another
prompt, so the next mistake of that kind fails loudly instead of shipping
quietly.
