/*
 * DOM cell -> post object.
 *
 * This is the fragile file. All knowledge of X's markup lives here and nowhere
 * else, so when X changes its DOM exactly one small file needs fixing.
 *
 * Returns null for a cell it cannot make sense of, rather than throwing. The
 * pass counts nulls and reports them in the bar, so breakage is visible
 * instead of silent.
 */

/*
 * Bumped whenever the selectors change. Reported with the parse-failure count
 * so a stale extension (edited on disk but not reloaded in chrome://extensions)
 * is obvious instead of looking like a selector bug.
 */
MyX.EXTRACT_VERSION = 3;

const CELL = '[data-testid="cellInnerDiv"]';
const ARTICLE = 'article[data-testid="tweet"]';

/*
 * Paths that look like a profile link but are not an account. A post from
 * /i/status/... would otherwise be filed under an account called "i".
 */
const RESERVED = new Set([
  "i", "home", "explore", "notifications", "messages", "search", "settings",
  "compose", "login", "logout", "signup", "about", "tos", "privacy",
]);

function handleFromHref(href) {
  const m = href && href.match(/^\/([A-Za-z0-9_]{1,15})(?:$|[/?#])/);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return RESERVED.has(h) ? null : h;
}

/*
 * The handle as rendered text, "@name". Needed because the quoted account
 * inside a quote card has no link of its own anywhere in the card.
 */
function handleFromText(scope) {
  for (const span of scope.querySelectorAll("span")) {
    const t = span.textContent.trim();
    if (/^@[A-Za-z0-9_]{1,15}$/.test(t)) return t.slice(1).toLowerCase();
  }
  return null;
}

/* The quote card: a nested role="link" that carries its own author block. */
function quoteCard(article) {
  for (const d of article.querySelectorAll('div[role="link"]')) {
    if (d.querySelector('[data-testid="User-Name"]')) return d;
  }
  return null;
}

MyX.extract = {
  CELL,

  /*
   * Where the posts are. [aria-label^="Timeline"] is not usable — it also
   * matches "Timeline: Trending now" in the right-hand column.
   */
  timelineRoot() {
    return document.querySelector('[data-testid="primaryColumn"]');
  },

  /*
   * "foryou" | "other" | null. null means stand down: we could not tell, so
   * we show you everything rather than guess and eat a feed we do not own.
   *
   * Which tab is which is read by position, not by its label. The labels are
   * translated, and a pinned list adds more tabs, but For You is the first.
   */
  readTab() {
    if (!/^\/(home)?$/.test(location.pathname)) return null;

    const list = document.querySelector('[role="tablist"]');
    if (!list) return null;

    const tabs = [...list.querySelectorAll('[role="tab"]')];
    if (tabs.length < 2) return null;

    const selected = tabs.findIndex(
      (t) => t.getAttribute("aria-selected") === "true"
    );
    if (selected < 0) return null;

    return selected === 0 ? "foryou" : "other";
  },

  /* A cell that holds no post at all — the composer, a prompt, a divider. */
  isPost(cell) {
    return Boolean(cell.querySelector(ARTICLE));
  },

  /*
   * The three handles a post can be attributed to, all lowercase, absent ones
   * null. X renders none of the three the same way:
   *
   *   author       a real profile link, the first one in the author block
   *   repostedBy   no link of its own; the "N reposted" byline sits inside one
   *   quotedAuthor no link at all, so it is read from the "@name" text
   */
  readCell(cell) {
    const article = cell.querySelector(ARTICLE);
    if (!article) return null;

    /* Document order, so this is the post's own author block and not the
     * quoted one nested inside it. */
    const nameBlock = article.querySelector('[data-testid="User-Name"]');
    if (!nameBlock) return null;

    const author =
      handleFromHref(nameBlock.querySelector("a")?.getAttribute("href")) ||
      handleFromText(nameBlock);
    if (!author) return null;

    const status = article
      .querySelector('a[href*="/status/"]')
      ?.getAttribute("href")
      .match(/\/status\/(\d+)/);
    if (!status) return null;

    const byline = article.querySelector('[data-testid="socialContext"]');
    const repostedBy = byline
      ? handleFromHref(byline.closest("a")?.getAttribute("href"))
      : null;

    const quote = quoteCard(article);
    const quotedAuthor = quote
      ? handleFromText(quote.querySelector('[data-testid="User-Name"]'))
      : null;

    return { postId: status[1], author, repostedBy, quotedAuthor };
  },

  /*
   * Where the tag button goes: beside the "..." menu, which is the only thing
   * already sitting at that end of the post's header row.
   */
  menuButton(cell) {
    return cell.querySelector('[data-testid="caret"]');
  },

  /* ---- a post's own page ---------------------------------------------- */

  /*
   * The status id in the URL, or null anywhere else. This is also what keeps
   * post.js off every other page.
   */
  statusId() {
    const m = location.pathname.match(
      /^\/[A-Za-z0-9_]{1,15}\/status\/(\d+)/
    );
    return m ? m[1] : null;
  },

  /*
   * The one post the URL points at, or null.
   *
   * A status page is not one post: X renders the parents above it and the
   * replies below it, each the same article. So the post is found by identity
   * — its own status id — and never by position. No match means no button:
   * a copy button on the wrong reply would hand you the wrong text and look
   * like it worked.
   */
  focusedPost() {
    const id = this.statusId();
    if (!id) return null;

    const root = this.timelineRoot();
    if (!root) return null;

    for (const article of root.querySelectorAll(ARTICLE)) {
      for (const a of article.querySelectorAll('a[href*="/status/"]')) {
        if (a.getAttribute("href").match(/\/status\/(\d+)/)?.[1] === id) {
          return article;
        }
      }
    }
    return null;
  },

  /*
   * Where the copy button goes: the post's action row — reply, repost, like,
   * bookmark, share — and after the last of them.
   *
   * Not beside the "..." menu, which is where the tag button goes in the feed.
   * That works in a timeline cell but not here: on a status page the right
   * edge of the header is a 28px-wide flex column, so a button put there
   * stacks above the "..." instead of sitting next to it. The action row is a
   * real horizontal row with room in it, and "copy the text" belongs next to
   * share anyway.
   */
  actionBar(article) {
    return article.querySelector('[role="group"]');
  },

  /*
   * A section heading cell, or null for anything else.
   *
   * The reply list on a status page ends with headed sections: "Discover more"
   * (posts X recommends, unrelated to this one) and "Probable spam" (replies
   * X ranked down). Neither heading carries a testid and both labels are
   * translated, so they are told apart by shape rather than by text: the
   * recommendation heading is the only one with a second line under it
   * ("Sourced from across X").
   *
   * Returns "recommended" for that one, "other" for any other heading.
   */
  headingKind(cell) {
    if (cell.querySelector(ARTICLE)) return null;
    if (!cell.querySelector('h2[role="heading"]')) return null;
    return cell.querySelectorAll("span").length > 1 ? "recommended" : "other";
  },

  /* Is anything post-shaped rendered yet? Tells "still loading" from "broke". */
  hasArticles() {
    return Boolean(this.timelineRoot()?.querySelector(ARTICLE));
  },

  /*
   * A post's text, or null when it has none (an image on its own).
   *
   * Walked rather than read off textContent, for one reason: X renders emoji
   * as twemoji images, <img alt="😬" src=".../1f62c.svg">, and textContent
   * drops them silently. The alt is the character itself, so putting it back
   * is enough.
   *
   * Line breaks need no work — X sets white-space: pre-wrap on the text and
   * leaves the newlines in the text nodes (measured on the live page). An
   * earlier version of this added a newline before every block-level element
   * as well, which broke lines in the middle of a sentence: X wraps a @mention
   * in an inline-flex div whose inner span is display:block.
   *
   * The quoted post inside a quote card has a tweetText of its own, so this
   * takes the first one in document order — the outer post's.
   */
  postText(article) {
    const node = article.querySelector('[data-testid="tweetText"]');
    if (!node) return null;

    let out = "";
    const walk = document.createTreeWalker(
      node,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    );

    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.nodeValue;
      } else if (n.tagName === "IMG") {
        out += n.getAttribute("alt") || "";
      } else if (n.tagName === "BR") {
        out += "\n";
      }
    }

    out = out.trim();
    return out || null;
  },
};
