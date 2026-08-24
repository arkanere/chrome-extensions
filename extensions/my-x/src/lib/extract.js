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
MyX.EXTRACT_VERSION = 1;

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
};
