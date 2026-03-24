/**
 * Aggregates vote rows from the `votes` table into counts and a simple score.
 *
 * @param {{ vote_type: string }[] | null | undefined} votes
 * @returns {{
 *   voteCount: number,
 *   upvotes: number,
 *   downvotes: number,
 *   avgRating: number
 * }}
 */
function aggregateVotes(votes) {
  if (!votes || votes.length === 0) {
    return { voteCount: 0, upvotes: 0, downvotes: 0, avgRating: 0 };
  }

  const voteCount = votes.length;
  const upvotes = votes.filter((v) => v.vote_type === 'up').length;
  const downvotes = votes.filter((v) => v.vote_type === 'down').length;
  const avgRating =
    voteCount > 0
      ? parseFloat(((upvotes - downvotes) / voteCount).toFixed(2))
      : 0;

  return { voteCount, upvotes, downvotes, avgRating };
}

module.exports = { aggregateVotes };
