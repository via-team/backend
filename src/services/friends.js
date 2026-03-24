/**
 * Given friendship rows where the user is either requester or addressee,
 * returns the set of the other party's user IDs (accepted friends only —
 * callers should filter `status` before passing rows).
 *
 * @param {string} userId
 * @param {{ requester_id: string, addressee_id: string }[] | null | undefined} rows
 * @returns {string[]}
 */
function friendIdsForUser(userId, rows) {
  const ids = new Set();
  for (const row of rows || []) {
    if (row.requester_id === userId) {
      ids.add(row.addressee_id);
    } else {
      ids.add(row.requester_id);
    }
  }
  return [...ids];
}

module.exports = { friendIdsForUser };
