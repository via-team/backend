/**
 * Given friendship rows where the user is either requester or addressee,
 * returns the set of the other party's user IDs for accepted mutual friendships
 * (callers should filter `status` before passing rows).
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

/**
 * Fetches any existing friendship rows for an unordered user pair (both directions).
 * Returns at most two rows: one where userId is requester and one where userId is addressee.
 *
 * @param {object} supabase
 * @param {string} userId
 * @param {string} targetId
 * @returns {Promise<{ rows: Array<{ requester_id: string, addressee_id: string, status: string, created_at: string }>, error: object|null }>}
 */
async function getFriendshipRows(supabase, userId, targetId) {
  const { data, error } = await supabase
    .from('friends')
    .select('requester_id, addressee_id, status, created_at')
    .or(
      `and(requester_id.eq.${userId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${userId})`
    );
  return { rows: data || [], error };
}

/**
 * Returns the row in which `userId` is the requester (outbound), or null.
 *
 * @param {{ requester_id: string, addressee_id: string, status: string }[]} rows
 * @param {string} userId
 * @returns {{ requester_id: string, addressee_id: string, status: string } | null}
 */
function outboundRow(rows, userId) {
  return rows.find((r) => r.requester_id === userId) || null;
}

/**
 * Returns the row in which `userId` is the addressee (inbound), or null.
 *
 * @param {{ requester_id: string, addressee_id: string, status: string }[]} rows
 * @param {string} userId
 * @returns {{ requester_id: string, addressee_id: string, status: string } | null}
 */
function inboundRow(rows, userId) {
  return rows.find((r) => r.addressee_id === userId) || null;
}

module.exports = { friendIdsForUser, getFriendshipRows, outboundRow, inboundRow };
