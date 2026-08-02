# Process overview

## What I built

A teletext news service: eleven pages on a 40x24 grid, seven colours on black,
navigated by three-digit page numbers and four coloured keys. Each lead story has
a page of its own in the 300s, and the headline list carries the number to type
for it. Ceefax closed in October 2012; this puts today's BBC News feed back into
the interface that carried it. The feed is read at build time, so the shipped
site is plain HTML and CSS with no script of any kind.

## The moments that mattered

**The feed lies in two ways, and neither shows in the output.** Reading the raw
items rather than the rendered page turned up a promo, "BBC News app", carrying a
real summary — so no missing-field filter could catch it — and the sport section
repeating a front-page story under a shortened headline. Rather than a denylist
and exact-title dedupe, the promo now falls out of a correct definition of news,
a 48-hour window, and dedupe compares one normalised headline being a *prefix* of
another. The tests pin both against a fixed clock, and the snapshot dropped from
30 stories to 24: the promo, four evergreen features and the repeat, nothing else
([`365ba98`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit1-RuiquanQiao/commit/365ba98)).

**Looking told me the layout was broken; measuring told me why.** The page looked
like a column stuck in a corner at 1920x1080, and the obvious move was to rewrite
the stylesheet. Measuring showed it already centred at exactly 40 characters —
the screenshot renders at the pane's size, not the emulated viewport. The real
defect was one I could not see: the headline page needed 55 rows on a medium of
24, so it scrolled and the coloured keys sat below the fold. Rather than cut the
page, the build now counts the rows a page holds and the stylesheet sizes the
cell from that, so a page is fitted to the screen as the medium did. That is only
countable because every margin is exactly one row, so a test asserts the declared
count matches the page — a drift there scrolls silently, and both marked
viewports would scroll with it
([`8166d2e...dfd0701`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit1-RuiquanQiao/compare/8166d2e...dfd0701)).
