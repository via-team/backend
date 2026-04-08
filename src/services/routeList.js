const { encodePolyline, samplePoints } = require("../utils/geo");
const { fetchImagesByRouteIds } = require("./routeDetail");

/** PostgREST `in` filter size — split friend lists to avoid oversized URLs. */
const CREATOR_ID_IN_CHUNK = 100;

const ROUTE_LIST_SELECT = `
        id,
        creator_id,
        title,
    description,
        start_label,
        end_label,
        distance_meters,
        duration_seconds,
        created_at,
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
      `;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {Promise<{ ids: string[], error: Error | null }>}
 */
async function fetchNearbyRouteIds(supabase, lat, lng, radiusMeters) {
    const { data: nearbyRoutes, error } = await supabase.rpc(
        "get_routes_near",
        {
            p_lat: lat,
            p_lng: lng,
            p_radius_meters: radiusMeters,
        },
    );
    if (error) {
        return { ids: [], error };
    }
    return {
        ids: nearbyRoutes ? nearbyRoutes.map((r) => r.id) : [],
        error: null,
    };
}

/**
 * Fetches votes and preview polylines for route rows from `routes` (same shape as list/feed selects).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object[]} routes
 * @param {string|null} [userId] - When provided, `user_vote` ('up'|'down'|null) is included per route.
 * @param {{ savedRoutesSupabase?: import('@supabase/supabase-js').SupabaseClient }} [options]
 *   When `userId` is set, use `savedRoutesSupabase` (e.g. JWT-scoped client) to read `saved_routes` under RLS.
 * @returns {Promise<{ items: object[], votesByRoute: Record<string, { up: number, down: number, total: number }> }>}
 */
async function enrichRoutesForList(supabase, routes, userId = null, options = {}) {
    const savedRoutesSupabase = options.savedRoutesSupabase ?? supabase;
    if (!routes || routes.length === 0) {
        return { items: [], votesByRoute: {} };
    }

    const routeIds = routes.map((r) => r.id);

    const [votesResult, commentsResult, savedResult, ...pointsResults] = await Promise.all([
        supabase
            .from("votes")
            .select("route_id, vote_type, user_id")
            .in("route_id", routeIds),
        supabase.from("comments").select("route_id").in("route_id", routeIds),
        userId
            ? savedRoutesSupabase
                  .from("saved_routes")
                  .select("route_id")
                  .eq("user_id", userId)
                  .in("route_id", routeIds)
            : Promise.resolve({ data: [], error: null }),
        ...routes.map((r) =>
            supabase.rpc("get_route_points_with_coords", {
                p_route_id: r.id,
            }),
        ),
    ]);

    let votesData = [];
    if (!votesResult.error && votesResult.data) {
        votesData = votesResult.data;
    } else if (votesResult.error) {
        console.error(
            "Error fetching votes for route list:",
            votesResult.error,
        );
    }

    if (savedResult.error) {
        console.error(
            "Error fetching saved routes for route list:",
            savedResult.error,
        );
    }

    const savedRouteIds = new Set(
        !savedResult.error && savedResult.data
            ? savedResult.data.map((r) => r.route_id)
            : [],
    );

    const polylineByRoute = {};
    routes.forEach((route, idx) => {
        const result = pointsResults[idx];
        if (!result.error && result.data && result.data.length > 0) {
            const sampled = samplePoints(result.data, 20);
            polylineByRoute[route.id] = encodePolyline(sampled) || null;
        } else {
            polylineByRoute[route.id] = null;
        }
    });

    const votesByRoute = {};
    const userVoteByRoute = {};
    votesData.forEach((vote) => {
        if (!votesByRoute[vote.route_id]) {
            votesByRoute[vote.route_id] = { up: 0, down: 0, total: 0 };
        }
        if (vote.vote_type === "up") {
            votesByRoute[vote.route_id].up++;
        } else if (vote.vote_type === "down") {
            votesByRoute[vote.route_id].down++;
        }
        votesByRoute[vote.route_id].total++;
        if (userId && vote.user_id === userId) {
            userVoteByRoute[vote.route_id] = vote.vote_type;
        }
    });

    const commentsByRoute = {};
    if (!commentsResult.error && commentsResult.data) {
        commentsResult.data.forEach((comment) => {
            commentsByRoute[comment.route_id] =
                (commentsByRoute[comment.route_id] || 0) + 1;
        });
    } else if (commentsResult.error) {
        console.error(
            "Error fetching comments for route list:",
            commentsResult.error,
        );
    }

    const imagesByRoute = await fetchImagesByRouteIds(supabase, routeIds);

    const items = routes.map((route) => {
        const votes = votesByRoute[route.id] || {
            up: 0,
            down: 0,
            total: 0,
        };
        const avgRating =
            votes.total > 0 ? (votes.up - votes.down) / votes.total : 0;

        const routeTags = route.route_tags
            ? route.route_tags.map((rt) => rt.tags?.name).filter(Boolean)
            : [];

        return {
            id: route.id,
            creator_id: route.creator_id,
            creator: route.creator || null,
            title: route.title,
            description: route.description || null,
            start_label: route.start_label,
            end_label: route.end_label,
            distance_meters: route.distance_meters,
            duration_seconds: route.duration_seconds,
            avg_rating: parseFloat(avgRating.toFixed(2)),
            tags: routeTags,
            preview_polyline: polylineByRoute[route.id] ?? null,
            created_at: route.created_at,
            vote_count: votes.total,
            upvotes: votes.up,
            downvotes: votes.down,
            score: votes.up - votes.down,
            comment_count: commentsByRoute[route.id] || 0,
            user_vote: userVoteByRoute[route.id] ?? null,
            is_saved: savedRouteIds.has(route.id),
            images: imagesByRoute[route.id] ?? [],
        };
    });

    return { items, votesByRoute };
}

/**
 * @param {string} createdAtIso
 * @param {number} upvotes
 */
function feedTopHotScore(createdAtIso, upvotes) {
    const ageMs = Date.now() - new Date(createdAtIso).getTime();
    const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
    return (1 + upvotes) / (ageHours + 2) ** 1.5;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string[]} creatorIds
 * @param {string[] | null} locationFilteredIds when non-null, restrict to these route ids
 */
async function fetchRoutesForCreatorsChunked(
    supabase,
    creatorIds,
    locationFilteredIds,
) {
    if (creatorIds.length === 0) {
        return [];
    }

    const merged = [];
    for (let i = 0; i < creatorIds.length; i += CREATOR_ID_IN_CHUNK) {
        const chunk = creatorIds.slice(i, i + CREATOR_ID_IN_CHUNK);
        let q = supabase
            .from("routes")
            .select(ROUTE_LIST_SELECT)
            .eq("is_active", true)
            .in("creator_id", chunk);
        if (locationFilteredIds !== null) {
            q = q.in("id", locationFilteredIds);
        }
        const { data, error } = await q;
        if (error) {
            throw error;
        }
        if (data) {
            merged.push(...data);
        }
    }

    const byId = new Map(merged.map((r) => [r.id, r]));
    return [...byId.values()].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );
}

module.exports = {
    ROUTE_LIST_SELECT,
    fetchNearbyRouteIds,
    enrichRoutesForList,
    feedTopHotScore,
    fetchRoutesForCreatorsChunked,
};
