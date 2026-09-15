# my-linkedin

A LinkedIn feed of the accounts you follow, and nothing else.

Most of the feed is there because someone in your network reacted to it, or
because LinkedIn suggested it, or because it is an ad. All of that goes. On a
real feed that is about three quarters of the cards, and it is meant to be.

## What it hides

- Every post whose author you do not follow, and every "Promoted" post.
- The right-hand rail: LinkedIn News, puzzles, the ad, the footer links.

Posts by people and pages you follow stay — except a reshare of a stranger's
post, which goes on purpose. Nothing else about LinkedIn changes: no rebuilt
feed, no redirect, no keyword filtering, no account, no sync, no settings.

## How it decides

LinkedIn offers **Follow** (or **Connect**) in a post's header only when you do
not already follow that account. That is the whole rule. Ads offer neither, so
they are matched on the word "Promoted".

A bar across the top shows the name and how many posts it has taken out —
hidden posts leave no gap, so it is the only way to tell working from broken.

Why not the "Jane Doe likes this" line, and what breaks it:
[ARCHITECTURE.md](ARCHITECTURE.md).

## Installing

1. `chrome://extensions` → **Developer mode** on
2. **Load unpacked** → this folder (`extensions/my-linkedin`)

After changing code, hit reload on the extension's card and refresh LinkedIn.
