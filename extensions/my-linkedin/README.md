# my-linkedin

A LinkedIn feed of the accounts you follow, and nothing else.

Almost everything in the feed is there because someone in your network reacted
to it, or because LinkedIn suggested it, or because it is an ad. This hides all
of it and leaves the posts written by the people and pages you follow. On a real
feed that is about three quarters of the cards, and it is meant to be.

It does not replace the feed or fight the algorithm. The algorithm stays exactly
as it is, and we take out the part of it you have said you don't want.

## What it does and doesn't

- Hides every feed post whose author you do not follow, and every "Promoted"
  post. Aggressive is the point — if the feed empties out, that is it working.
- Leaves posts by the people and pages you follow alone — with one deliberate
  exception, a reshare of a stranger's post, which goes. Changes nothing about
  how LinkedIn loads the feed.
- No rebuilt feed, no redirect, no API client of our own. We read what LinkedIn
  already rendered and hide part of it.
- No account, no sync, no backend. Everything is local to the browser.
- No keyword filtering. The rule is about where a post came from, never about
  what it says.
- Does not touch LinkedIn's own Unfollow, Mute or Block. This layer is separate
  and private.

## How it decides

LinkedIn offers **Follow** (or **Connect**) in a post's header only when you do
not already follow that account. That is the whole rule: a Follow or Connect
button on the card, and the post goes. Ads say "Promoted" and offer neither, so
they get a second rule.

On a live feed this hid 24 of 33 cards.

Everything else — why not the "Jane Doe likes this" line, why not the connection
degree, what breaks and when — is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Installing

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder (`extensions/my-linkedin`)
4. Pin it to the toolbar

After changing code, hit the reload arrow on the extension's card and refresh
the LinkedIn tab.
