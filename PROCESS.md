# Process overview

## What I built

A teletext news service: five pages on a 40x24 grid, seven colours on black,
navigated by three-digit page numbers and four coloured keys. Ceefax closed in
October 2012; this puts today's BBC News feed back into the interface that used
to carry it. The feed is read at build time, so the shipped site is plain HTML
and CSS with no script of any kind.

## The moments that mattered

**The feed lies in two ways, and neither shows in the output.** Reading the raw
items rather than the rendered page turned up a house promo, "BBC News app",
carrying a real summary — so no missing-field filter could catch it — and the
sport section repeating a front-page story under a shortened headline. The
obvious fixes were a title denylist and exact-title dedupe. Instead the promo
falls out of a correct definition of news, a 48-hour window, and dedupe compares
one normalised headline being a *prefix* of another. Tests pin both against a
fixed clock, and the snapshot dropped from 30 stories to 24: the promo, four
evergreen features and the repeat, nothing else
([`365ba98`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit1-RuiquanQiao/commit/365ba98)).

**A screenshot told me the layout was broken when it wasn't.** At 1920x1080 the
page looked like a column stuck in a corner, and the obvious move was to rewrite
the stylesheet. Measuring instead showed it already centred, 804px for exactly 40
characters, and that the tool renders at the pane's size rather than the emulated
viewport. That reframed the real defects: dead vertical space, and two key labels
clipping at 390x844. The stylesheet now binds cell size to *both* axes, and a
test holds label length
([`8166d2e...2236370`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit1-RuiquanQiao/compare/8166d2e...2236370)).

That range carries the same lesson once more: since `linkinator` will not run in
this checkout, I wrote the internal-reference check rather than pushing to find
out.
