const { fetchNearbyRouteIds } = require('./routeList');

/**
 * Applies optional PostGIS-backed location filtering for route list/feed handlers.
 * When both lat and lng are provided, calls `get_routes_near` via {@link fetchNearbyRouteIds}.
 * On RPC failure or zero matches, sends the HTTP response and returns `{ handled: true }`.
 * When coordinates are omitted, returns `{ handled: false, ids: null }` (no geo filter).
 * When matches exist, returns `{ handled: false, ids: string[] }`.
 *
 * @param {import('express').Response} res
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} options
 * @param {number|null} options.parsedLat
 * @param {number|null} options.parsedLng
 * @param {number} options.parsedRadius
 * @param {string} options.logContext - Short label for console.error (e.g. "GET /routes", "feed")
 * @param {() => object} options.buildEmptyResponse - JSON body when no routes fall in radius
 * @returns {Promise<{ handled: true } | { handled: false, ids: string[] | null }>}
 */
async function resolveLocationFilteredRouteIds(res, supabase, options) {
  const {
    parsedLat,
    parsedLng,
    parsedRadius,
    logContext,
    buildEmptyResponse,
  } = options;

  if (parsedLat === null || parsedLng === null) {
    return { handled: false, ids: null };
  }

  const { ids: nearbyIds, error: locationError } = await fetchNearbyRouteIds(
    supabase,
    parsedLat,
    parsedLng,
    parsedRadius,
  );

  if (locationError) {
    console.error(`Error in location filter (${logContext}):`, locationError);
    res.status(500).json({
      error: 'Failed to apply location filter',
      message: locationError.message,
    });
    return { handled: true };
  }

  if (nearbyIds.length === 0) {
    res.json(buildEmptyResponse());
    return { handled: true };
  }

  return { handled: false, ids: nearbyIds };
}

module.exports = { resolveLocationFilteredRouteIds };
