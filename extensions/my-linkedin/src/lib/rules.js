/*
 * The decision: does this post stay?
 *
 * The rule is about where a post came from, never about what it says. There
 * is no keyword list here and there is not meant to be one.
 *
 * There are no settings. Both rules are always on. See ARCHITECTURE.md for
 * why the header button is the signal, what was measured, and what it gets
 * wrong.
 */

MyLI.rules = {
  /*
   * Decided synchronously, because the pass walks every visible post and has
   * no chance to await.
   */
  shouldHide(post) {
    return post.offered || post.promoted;
  },
};
