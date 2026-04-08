const { encodePolyline, samplePoints } = require('../utils/geo');
const { aggregateVotes } = require('./voteStats');

/**
 * Build preview_polyline from full point rows (same sampling as list enrichment).
 *
 * @param {{ sequence?: number, lat: number, lng: number }[]} rawPoints
 * @returns {string|null}
 */
function previewPolylineFromPoints(rawPoints) {
  if (!rawPoints || rawPoints.length === 0) return null;
  const sampled = samplePoints(rawPoints, 20);
  return encodePolyline(sampled) || null;
}

/**
 * Fetches route_images rows for many route ids, grouped by route_id.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string[]} routeIds
 * @returns {Promise<Record<string, { id: string, public_url: string, sort_order: number }[]>>}
 */
async function fetchImagesByRouteIds(supabase, routeIds) {
  const byRoute = {};
  if (!routeIds || routeIds.length === 0) return byRoute;

  const { data, error } = await supabase
    .from('route_images')
    .select('id, route_id, public_url, sort_order')
    .in('route_id', routeIds);

  if (error) {
    console.error('Error fetching route_images:', error);
    return byRoute;
  }

  const rows = [...(data || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  rows.forEach((row) => {
    const rid = row.route_id;
    if (!byRoute[rid]) byRoute[rid] = [];
    byRoute[rid].push({
      id: row.id,
      public_url: row.public_url,
      sort_order: row.sort_order ?? 0,
    });
  });

  return byRoute;
}

/**
 * Full route detail payload for map preview / hydration (single GET).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} routeId
 * @param {{ userId?: string | null, savedRoutesSupabase?: import('@supabase/supabase-js').SupabaseClient }} [options]
 * @returns {Promise<{ ok: true, body: object } | { ok: false, status: number, error: object }>}
 */
async function buildRouteDetailResponse(supabase, routeId, options = {}) {
  const userId = options.userId ?? null;
  const savedRoutesSupabase = options.savedRoutesSupabase ?? supabase;

  const { data: route, error } = await supabase
    .from('routes')
    .select(
      `
        *,
        route_tags (
          tags (
            name
          )
        ),
        creator:profiles!creator_id (
          id,
          full_name,
          email
        )
      `,
    )
    .eq('id', routeId)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return {
        ok: false,
        status: 404,
        error: {
          error: 'Route not found',
          message: `No active route found with id ${routeId}`,
        },
      };
    }
    console.error('Error fetching route:', error);
    return {
      ok: false,
      status: 500,
      error: {
        error: 'Failed to fetch route',
        message: error.message,
      },
    };
  }

  const [
    { data: votes, error: votesError },
    { data: rawPoints, error: pointsError },
    { data: commentRows, error: commentsError },
    { data: imageRows, error: imagesError },
    savedResult,
  ] = await Promise.all([
    supabase.from('votes').select('vote_type, user_id').eq('route_id', routeId),
    supabase.rpc('get_route_points_with_coords', { p_route_id: routeId }),
    supabase.from('comments').select('id').eq('route_id', routeId),
    supabase.from('route_images').select('id, public_url, sort_order').eq('route_id', routeId),
    userId
      ? savedRoutesSupabase
          .from('saved_routes')
          .select('route_id')
          .eq('user_id', userId)
          .eq('route_id', routeId)
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);

  let votesData = [];
  if (!votesError && votes) {
    votesData = votes;
  } else if (votesError) {
    console.error('Error fetching votes for route detail:', votesError);
  }

  const agg = aggregateVotes(votesData.map((v) => ({ vote_type: v.vote_type })));
  const voteCount = agg.voteCount;
  const upvotes = agg.upvotes;
  const downvotes = agg.downvotes;
  const avgRating = agg.avgRating;

  let userVote = null;
  if (userId && votesData.length) {
    const mine = votesData.filter((v) => v.user_id === userId);
    if (mine.length) {
      const ups = mine.filter((v) => v.vote_type === 'up').length;
      const downs = mine.filter((v) => v.vote_type === 'down').length;
      if (ups > downs) userVote = 'up';
      else if (downs > ups) userVote = 'down';
    }
  }

  let commentCount = 0;
  if (!commentsError && commentRows) {
    commentCount = commentRows.length;
  } else if (commentsError) {
    console.error('Error fetching comments for route detail:', commentsError);
  }

  let routePoints = [];
  if (!pointsError && rawPoints) {
    routePoints = rawPoints.map((p) => ({
      seq: p.sequence,
      lat: p.lat,
      lng: p.lng,
      accuracy_meters: p.accuracy_meters,
      recorded_at: p.recorded_at,
    }));
  } else if (pointsError) {
    console.error('Error fetching route points:', pointsError);
  }

  const previewPolyline = previewPolylineFromPoints(rawPoints || []);

  let images = [];
  if (!imagesError && imageRows) {
    const sorted = [...imageRows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    images = sorted.map((r) => ({
      id: r.id,
      public_url: r.public_url,
      sort_order: r.sort_order ?? 0,
    }));
  } else if (imagesError) {
    // Table may not exist until migration is applied; avoid failing the whole detail response.
    const msg = String(imagesError.message || '').toLowerCase();
    if (!msg.includes('route_images') && !msg.includes('does not exist')) {
      console.error('Error fetching route_images:', imagesError);
    }
  }

  if (savedResult.error) {
    console.error('Error fetching saved_routes for route detail:', savedResult.error);
  }
  const savedRows = savedResult.data;
  const isSaved = Boolean(
    userId && Array.isArray(savedRows) && savedRows.length > 0 && savedRows[0]?.route_id,
  );

  const tags = route.route_tags
    ? route.route_tags.map((rt) => rt.tags?.name).filter(Boolean)
    : [];

  const { route_tags: _rt, ...routeFields } = route;

  const creator = route.creator || null;

  const body = {
    ...routeFields,
    creator,
    avg_rating: avgRating,
    vote_count: voteCount,
    upvotes,
    downvotes,
    score: upvotes - downvotes,
    comment_count: commentCount,
    user_vote: userVote,
    is_saved: isSaved,
    tags,
    preview_polyline: previewPolyline,
    route_points: routePoints,
    images,
  };

  return { ok: true, body };
}

module.exports = {
  buildRouteDetailResponse,
  fetchImagesByRouteIds,
  previewPolylineFromPoints,
};
