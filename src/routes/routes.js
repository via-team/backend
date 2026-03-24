const express = require("express");
const supabase = require("../config/supabase");
const { requireAuth } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const { calculateDistance } = require("../utils/geo");
const {
    CreateRouteSchema,
    ListRoutesQuerySchema,
    FeedQuerySchema,
    VoteSchema,
    CommentSchema,
} = require("../schemas/routes");
const {
    ROUTE_LIST_SELECT,
    fetchNearbyRouteIds,
    enrichRoutesForList,
    feedTopHotScore,
    fetchRoutesForCreatorsChunked,
} = require("../services/routeList");

const router = express.Router();

const FEED_TOP_CANDIDATE_LIMIT = 500;

function requireAuthForFriendsFeed(req, res, next) {
    if (req.query.tab === "friends") {
        return requireAuth(req, res, next);
    }
    next();
}

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
 * @swagger
 * /api/v1/routes:
 *   post:
 *     summary: Create a route
 *     description: Create a new route with title, desription, start/end labels, times, tags, and points
 *     tags: [Routes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - start_label
 *               - end_label
 *               - start_time
 *               - end_time
 *               - points
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Quickest way to GDC from Jester"
 *               description:
 *                 type: string
 *                 example: "Avoids the Speedway crowd."
 *               start_label:
 *                 type: string
 *                 example: "Jester West"
 *               end_label:
 *                 type: string
 *                 example: "GDC 2.216"
 *               start_time:
 *                 type: string
 *                 format: date-time
 *                 example: "2023-10-27T10:00:00Z"
 *               end_time:
 *                 type: string
 *                 format: date-time
 *                 example: "2023-10-27T10:15:00Z"
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 example: ["uuid-short-cut", "uuid-shade"]
 *               points:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     seq:
 *                       type: integer
 *                     lat:
 *                       type: number
 *                       format: float
 *                     lng:
 *                       type: number
 *                       format: float
 *                     acc:
 *                       type: number
 *                       format: float
 *                     time:
 *                       type: string
 *                       format: date-time
 *     responses:
 *       201:
 *         description: Route created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 route_id:
 *                   type: string
 *                   format: uuid
 */
router.post("/", requireAuth, validateBody(CreateRouteSchema), async (req, res) => {
    try {
        const {
            title,
            description,
            start_label,
            end_label,
            start_time,
            end_time,
            tags,
            points,
        } = req.body;

        // Sort points by sequence to ensure correct order
        const sortedPoints = points.sort((a, b) => a.seq - b.seq);

        // Get first and last points for start/end locations
        const firstPoint = sortedPoints[0];
        const lastPoint = sortedPoints[sortedPoints.length - 1];

        // Calculate duration in seconds
        const startDate = new Date(start_time);
        const endDate = new Date(end_time);
        const durationSeconds = Math.floor((endDate - startDate) / 1000);

        const distanceMeters = calculateDistance(sortedPoints);

        const creator_id = req.user.id;

        // Insert route into database using RPC to handle PostGIS geography type
        const { data: routeData, error: routeError } = await supabase.rpc(
            "create_route_with_geography",
            {
                p_creator_id: creator_id,
                p_title: title,
                p_description: description || null,
                p_start_label: start_label,
                p_end_label: end_label,
                p_start_lng: firstPoint.lng,
                p_start_lat: firstPoint.lat,
                p_end_lng: lastPoint.lng,
                p_end_lat: lastPoint.lat,
                p_start_time: start_time,
                p_end_time: end_time,
                p_duration_seconds: durationSeconds,
                p_distance_meters: distanceMeters,
            },
        );

        if (routeError) {
            console.error("Error creating route:", routeError);
            return res
                .status(500)
                .json({
                    error: "Failed to create route",
                    details: routeError.message,
                });
        }

        const routeId = routeData;

        // Insert route points
        const routePointsToInsert = sortedPoints.map((point) => ({
            sequence: point.seq,
            lng: point.lng,
            lat: point.lat,
            recorded_at: point.time,
            accuracy_meters: point.acc || null,
        }));

        // Insert route points using RPC to handle PostGIS geography type
        const { error: pointsError } = await supabase.rpc(
            "insert_route_points",
            {
                p_route_id: routeId,
                p_points: routePointsToInsert,
            },
        );

        if (pointsError) {
            console.error("Error inserting route points:", pointsError);
            // Consider whether to rollback the route creation
            return res
                .status(500)
                .json({
                    error: "Failed to insert route points",
                    details: pointsError.message,
                });
        }

        // Insert route tags if provided
        if (tags && tags.length > 0) {
            const routeTagsToInsert = tags.map((tagId) => ({
                route_id: routeId,
                tag_id: tagId,
            }));

            const { error: tagsError } = await supabase
                .from("route_tags")
                .insert(routeTagsToInsert);

            if (tagsError) {
                console.error("Error inserting route tags:", tagsError);
                // Don't fail the entire request for tags, just log the error
            }
        }

        res.status(201).json({ route_id: routeId });
    } catch (error) {
        console.error("Error creating route:", error);
        res.status(500).json({
            error: "Internal server error",
            details: error.message,
        });
    }
});

/**
 * @swagger
 * /api/v1/routes:
 *   get:
 *     summary: Search and feed routes
 *     description: Search for routes by location, radius, tags, and sort order. When lat and lng are provided, results are filtered to routes whose start point falls within the given radius using PostGIS ST_DWithin.
 *     tags: [Routes]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *           format: float
 *         description: User's current latitude — activates location-based filtering when combined with lng
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *           format: float
 *         description: User's current longitude — activates location-based filtering when combined with lat
 *       - in: query
 *         name: radius
 *         schema:
 *           type: integer
 *           default: 500
 *         description: Search radius in meters (used when lat and lng are provided)
 *       - in: query
 *         name: dest_lat
 *         schema:
 *           type: number
 *           format: float
 *         description: Destination latitude (accepted but not yet used for filtering)
 *       - in: query
 *         name: dest_lng
 *         schema:
 *           type: number
 *           format: float
 *         description: Destination longitude (accepted but not yet used for filtering)
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated tag names to filter by (e.g., "shade,quiet")
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [popular, recent, efficient]
 *           default: recent
 *         description: Sort order
 *     responses:
 *       200:
 *         description: List of routes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       title:
 *                         type: string
 *                       start_label:
 *                         type: string
 *                       distance_meters:
 *                         type: integer
 *                       avg_rating:
 *                         type: number
 *                         format: float
 *                       tags:
 *                         type: array
 *                         items:
 *                           type: string
 *                       preview_polyline:
 *                         type: string
 *       400:
 *         description: Invalid query parameters
 *       500:
 *         description: Internal server error
 */
router.get("/", validateQuery(ListRoutesQuerySchema), async (req, res) => {
    try {
        const {
            lat,
            lng,
            radius,
            tags,
            sort,
        } = req.query;

        // After Zod coercion these are already numbers (or undefined)
        const parsedLat = lat ?? null;
        const parsedLng = lng ?? null;
        const parsedRadius = radius;

        // Location-based filtering: call the get_routes_near RPC which uses
        // PostGIS ST_DWithin on the start_point geography column.
        let locationFilteredIds = null;
        if (parsedLat !== null && parsedLng !== null) {
            const { ids: nearbyIds, error: locationError } =
                await fetchNearbyRouteIds(
                    supabase,
                    parsedLat,
                    parsedLng,
                    parsedRadius,
                );

            if (locationError) {
                console.error("Error in location filter RPC:", locationError);
                return res.status(500).json({
                    error: "Failed to apply location filter",
                    message: locationError.message,
                });
            }

            locationFilteredIds = nearbyIds;

            // Return early when no routes fall within the search radius
            if (locationFilteredIds.length === 0) {
                return res.json({
                    data: [],
                    count: 0,
                    filters: {
                        lat: parsedLat,
                        lng: parsedLng,
                        radius: parsedRadius,
                        tags: tags || null,
                        sort,
                    },
                });
            }
        }

        // Build the base query, narrowed to location results when applicable
        let query = supabase
            .from("routes")
            .select(ROUTE_LIST_SELECT)
            .eq("is_active", true);

        if (locationFilteredIds !== null) {
            query = query.in("id", locationFilteredIds);
        }

        const { data: routes, error: routesError } = await query.limit(100);

        if (routesError) {
            console.error("Error fetching routes:", routesError);
            return res.status(500).json({
                error: "Failed to fetch routes",
                details: routesError.message,
            });
        }

        let transformedRoutes = (await enrichRoutesForList(supabase, routes))
            .items;

        // Filter by tags if provided
        if (tags) {
            const tagArray = tags.split(",").map((t) => t.trim().toLowerCase());
            transformedRoutes = transformedRoutes.filter((route) =>
                route.tags.some((tag) => tagArray.includes(tag.toLowerCase())),
            );
        }

        // Sort routes based on sort parameter
        transformedRoutes.sort((a, b) => {
            switch (sort) {
                case "popular":
                    return b.vote_count - a.vote_count;
                case "efficient":
                    return a.distance_meters - b.distance_meters;
                case "recent":
                default:
                    return new Date(b.created_at) - new Date(a.created_at);
            }
        });

        // Remove temporary fields and prepare final response
        const finalRoutes = transformedRoutes.map(
            ({ vote_count: _vc, ...route }) => route,
        );

        res.json({
            data: finalRoutes,
            count: finalRoutes.length,
            filters: {
                lat: parsedLat,
                lng: parsedLng,
                radius: parsedRadius,
                tags: tags || null,
                sort,
            },
        });
    } catch (error) {
        console.error("Error in GET /routes:", error);
        res.status(500).json({
            error: "Internal server error",
            message: error.message,
        });
    }
});

/**
 * @swagger
 * /api/v1/routes/feed:
 *   get:
 *     summary: Home feed tabs (Top, Friends, New)
 *     description: |
 *       Returns route cards for the home feed. `tab=top` ranks routes by a hot score from upvotes and age.
 *       `tab=new` lists newest routes. `tab=friends` requires a Bearer token and lists routes created by accepted friends.
 *       Optional `lat`/`lng`/`radius` narrow results with the same PostGIS filter as `GET /api/v1/routes`.
 *     tags: [Routes]
 *     parameters:
 *       - in: query
 *         name: tab
 *         required: true
 *         schema:
 *           type: string
 *           enum: [top, friends, new]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *           format: float
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *           format: float
 *       - in: query
 *         name: radius
 *         schema:
 *           type: integer
 *           default: 500
 *     responses:
 *       200:
 *         description: Feed page of routes
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Missing or invalid token (only when tab=friends)
 *       500:
 *         description: Internal server error
 */
router.get(
    "/feed",
    validateQuery(FeedQuerySchema),
    requireAuthForFriendsFeed,
    async (req, res) => {
        try {
            const {
                tab,
                limit,
                offset,
                lat,
                lng,
                radius,
            } = req.query;

            const parsedLat = lat ?? null;
            const parsedLng = lng ?? null;
            const parsedRadius = radius;

            let locationFilteredIds = null;
            if (parsedLat !== null && parsedLng !== null) {
                const { ids: nearbyIds, error: locationError } =
                    await fetchNearbyRouteIds(
                        supabase,
                        parsedLat,
                        parsedLng,
                        parsedRadius,
                    );

                if (locationError) {
                    console.error(
                        "Error in location filter RPC (feed):",
                        locationError,
                    );
                    return res.status(500).json({
                        error: "Failed to apply location filter",
                        message: locationError.message,
                    });
                }

                locationFilteredIds = nearbyIds;

                if (locationFilteredIds.length === 0) {
                    return res.json({
                        data: [],
                        count: 0,
                        filters: {
                            tab,
                            limit,
                            offset,
                            lat: parsedLat,
                            lng: parsedLng,
                            radius: parsedRadius,
                            total: 0,
                        },
                    });
                }
            }

            const buildFilters = (total) => ({
                tab,
                limit,
                offset,
                lat: parsedLat,
                lng: parsedLng,
                radius: parsedRadius,
                total,
            });

            if (tab === "friends") {
                const userId = req.user.id;
                const { data: friendsData, error: friendsError } =
                    await supabase
                        .from("friends")
                        .select("requester_id, addressee_id")
                        .or(
                            `requester_id.eq.${userId},addressee_id.eq.${userId}`,
                        )
                        .eq("status", "accepted");

                if (friendsError) {
                    console.error("Error fetching friends:", friendsError);
                    return res.status(500).json({
                        error: "Failed to fetch friends",
                        message: friendsError.message,
                    });
                }

                const friendIds = friendIdsForUser(userId, friendsData);
                if (friendIds.length === 0) {
                    return res.json({
                        data: [],
                        count: 0,
                        filters: buildFilters(0),
                    });
                }

                let allFriendRoutes;
                try {
                    allFriendRoutes = await fetchRoutesForCreatorsChunked(
                        supabase,
                        friendIds,
                        locationFilteredIds,
                    );
                } catch (fetchErr) {
                    console.error("Error fetching friend routes:", fetchErr);
                    return res.status(500).json({
                        error: "Failed to fetch routes",
                        message: fetchErr.message,
                    });
                }

                const total = allFriendRoutes.length;
                const pageRows = allFriendRoutes.slice(
                    offset,
                    offset + limit,
                );
                const { items } = await enrichRoutesForList(
                    supabase,
                    pageRows,
                );
                const finalRoutes = items.map(
                    ({ vote_count: _v, ...route }) => route,
                );

                return res.json({
                    data: finalRoutes,
                    count: finalRoutes.length,
                    filters: buildFilters(total),
                });
            }

            if (tab === "new") {
                let query = supabase
                    .from("routes")
                    .select(ROUTE_LIST_SELECT, { count: "exact" })
                    .eq("is_active", true)
                    .order("created_at", { ascending: false });

                if (locationFilteredIds !== null) {
                    query = query.in("id", locationFilteredIds);
                }

                const {
                    data: routeRows,
                    error: routesError,
                    count: totalCount,
                } = await query.range(offset, offset + limit - 1);

                if (routesError) {
                    console.error("Error fetching feed (new):", routesError);
                    return res.status(500).json({
                        error: "Failed to fetch routes",
                        message: routesError.message,
                    });
                }

                const { items } = await enrichRoutesForList(
                    supabase,
                    routeRows || [],
                );
                const finalRoutes = items.map(
                    ({ vote_count: _v, ...route }) => route,
                );

                return res.json({
                    data: finalRoutes,
                    count: finalRoutes.length,
                    filters: buildFilters(
                        totalCount ?? finalRoutes.length,
                    ),
                });
            }

            // tab === "top"
            let topQuery = supabase
                .from("routes")
                .select(ROUTE_LIST_SELECT)
                .eq("is_active", true)
                .order("created_at", { ascending: false })
                .limit(FEED_TOP_CANDIDATE_LIMIT);

            if (locationFilteredIds !== null) {
                topQuery = topQuery.in("id", locationFilteredIds);
            }

            const { data: candidates, error: topFetchError } =
                await topQuery;

            if (topFetchError) {
                console.error("Error fetching feed (top):", topFetchError);
                return res.status(500).json({
                    error: "Failed to fetch routes",
                    message: topFetchError.message,
                });
            }

            const { items, votesByRoute } = await enrichRoutesForList(
                supabase,
                candidates || [],
            );

            const scored = items.map((item) => {
                const up = votesByRoute[item.id]?.up ?? 0;
                return {
                    ...item,
                    _feedScore: feedTopHotScore(item.created_at, up),
                };
            });

            scored.sort((a, b) => {
                if (b._feedScore !== a._feedScore) {
                    return b._feedScore - a._feedScore;
                }
                return new Date(b.created_at) - new Date(a.created_at);
            });

            const total = scored.length;
            const pageItems = scored.slice(offset, offset + limit);
            const finalRoutes = pageItems.map(
                ({ vote_count: _v, _feedScore, ...route }) => ({
                    ...route,
                    feed_score: parseFloat(_feedScore.toFixed(6)),
                }),
            );

            return res.json({
                data: finalRoutes,
                count: finalRoutes.length,
                filters: buildFilters(total),
            });
        } catch (error) {
            console.error("Error in GET /routes/feed:", error);
            res.status(500).json({
                error: "Internal server error",
                message: error.message,
            });
        }
    },
);

/**
 * @swagger
 * /api/v1/routes/{id}:
 *   get:
 *     summary: Get specific route
 *     description: Get full route object including all GPS points and tags
 *     tags: [Routes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *     responses:
 *       200:
 *         description: Full route object with route_points and tags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 title:
 *                   type: string
 *                 description:
 *                   type: string
 *                 start_label:
 *                   type: string
 *                 end_label:
 *                   type: string
 *                 distance_meters:
 *                   type: integer
 *                 duration_seconds:
 *                   type: integer
 *                 start_time:
 *                   type: string
 *                   format: date-time
 *                 end_time:
 *                   type: string
 *                   format: date-time
 *                 avg_rating:
 *                   type: number
 *                   format: float
 *                 vote_count:
 *                   type: integer
 *                 tags:
 *                   type: array
 *                   items:
 *                     type: string
 *                 route_points:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       seq:
 *                         type: integer
 *                       lat:
 *                         type: number
 *                         format: float
 *                       lng:
 *                         type: number
 *                         format: float
 *                       accuracy_meters:
 *                         type: number
 *                         format: float
 *                       recorded_at:
 *                         type: string
 *                         format: date-time
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

    const { data: route, error } = await supabase
      .from('routes')
      .select(`*, route_tags(tags(name))`)
      .eq('id', id)
      .eq('is_active', true)
      .single();

        if (error) {
            if (error.code === "PGRST116") {
                return res.status(404).json({
                    error: "Route not found",
                    message: `No active route found with id ${id}`,
                });
            }
            console.error("Error fetching route:", error);
            return res
                .status(500)
                .json({
                    error: "Failed to fetch route",
                    message: error.message,
                });
        }

        const [
            { data: votes, error: votesError },
            { data: rawPoints, error: pointsError },
        ] = await Promise.all([
            supabase.from("votes").select("vote_type").eq("route_id", id),
            supabase.rpc("get_route_points_with_coords", { p_route_id: id }),
        ]);

        let avgRating = 0;
        let voteCount = 0;

        if (!votesError && votes) {
            voteCount = votes.length;
            if (voteCount > 0) {
                const upvotes = votes.filter(
                    (v) => v.vote_type === "up",
                ).length;
                const downvotes = votes.filter(
                    (v) => v.vote_type === "down",
                ).length;
                avgRating = parseFloat(
                    ((upvotes - downvotes) / voteCount).toFixed(2),
                );
            }
        }

        const tags = route.route_tags
            ? route.route_tags.map((rt) => rt.tags?.name).filter(Boolean)
            : [];

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
            console.error("Error fetching route points:", pointsError);
        }

        const { route_tags: _rt, ...routeFields } = route;

        res.json({
            ...routeFields,
            avg_rating: avgRating,
            vote_count: voteCount,
            tags,
            route_points: routePoints,
        });
    } catch (error) {
        console.error("Error in GET /routes/:id:", error);
        res.status(500).json({
            error: "Internal server error",
            message: error.message,
        });
    }
});

/**
 * @swagger
 * /api/v1/routes/{id}/vote:
 *   post:
 *     summary: Upvote or downvote a route
 *     description: Cast an up or down vote on a route with a context category. One vote per user per route — re-voting replaces the previous vote.
 *     tags: [Routes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vote_type
 *               - context
 *             properties:
 *               vote_type:
 *                 type: string
 *                 enum: [up, down]
 *                 example: "up"
 *               context:
 *                 type: string
 *                 enum: [safety, efficiency, scenery]
 *                 example: "safety"
 *     responses:
 *       201:
 *         description: Vote recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 route_id:
 *                   type: string
 *                   format: uuid
 *                 vote_type:
 *                   type: string
 *                 context:
 *                   type: string
 *                 vote_count:
 *                   type: integer
 *                 upvotes:
 *                   type: integer
 *                 downvotes:
 *                   type: integer
 *                 avg_rating:
 *                   type: number
 *                   format: float
 *       400:
 *         description: Missing or invalid fields
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.post("/:id/vote", requireAuth, validateBody(VoteSchema), async (req, res) => {
    try {
        const { id } = req.params;
        const { vote_type, context } = req.body;
        const user_id = req.user.id;

        // Verify the route exists and is active
        const { data: route, error: routeError } = await supabase
            .from("routes")
            .select("id")
            .eq("id", id)
            .eq("is_active", true)
            .single();

        if (routeError || !route) {
            return res.status(404).json({
                error: "Route not found",
                message: `No active route found with id ${id}`,
            });
        }

        // Upsert vote — one vote per user per route, re-voting replaces the previous vote
        const { error: voteError } = await supabase
            .from("votes")
            .upsert(
                { route_id: id, user_id, vote_type, context },
                { onConflict: "route_id,user_id" },
            );

        if (voteError) {
            console.error("Error upserting vote:", voteError);
            return res
                .status(500)
                .json({
                    error: "Failed to record vote",
                    message: voteError.message,
                });
        }

        // Fetch updated vote totals for the route
        const { data: votes, error: totalsError } = await supabase
            .from("votes")
            .select("vote_type")
            .eq("route_id", id);

        let vote_count = 0;
        let upvotes = 0;
        let downvotes = 0;
        let avg_rating = 0;

        if (!totalsError && votes) {
            vote_count = votes.length;
            upvotes = votes.filter((v) => v.vote_type === "up").length;
            downvotes = votes.filter((v) => v.vote_type === "down").length;
            avg_rating =
                vote_count > 0
                    ? parseFloat(
                          ((upvotes - downvotes) / vote_count).toFixed(2),
                      )
                    : 0;
        }

        res.status(201).json({
            message: "Vote recorded successfully",
            route_id: id,
            vote_type,
            context,
            vote_count,
            upvotes,
            downvotes,
            avg_rating,
        });
    } catch (error) {
        console.error("Error in POST /routes/:id/vote:", error);
        res.status(500).json({
            error: "Internal server error",
            message: error.message,
        });
    }
});

/**
 * @swagger
 * /api/v1/routes/{id}/comments:
 *   post:
 *     summary: Add a comment to a route
 *     description: Post a comment on a specific route
 *     tags: [Routes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 example: "Super cool route Nolan!"
 *     responses:
 *       201:
 *         description: Comment added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 comment_id:
 *                   type: string
 *                   format: uuid
 *                 route_id:
 *                   type: string
 *                   format: uuid
 *                 user_id:
 *                   type: string
 *                   format: uuid
 *                 content:
 *                   type: string
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Missing or empty content
 *       404:
 *         description: Route not found
 *       500:
 *         description: Internal server error
 */
router.post("/:id/comments", requireAuth, validateBody(CommentSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const user_id = req.user.id;

    // Verify the route exists and is active
    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id')
      .eq('id', id)
      .eq('is_active', true)
      .single();

    if (routeError || !route) {
      return res.status(404).json({
        error: "Route not found",
        message: `No active route found with id ${id}`
      });
    }

    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .insert({ route_id: id, user_id, content })
      .select()
      .single();

    if (commentError) {
      console.error("Error inserting comment:", commentError);
      return res.status(500).json({ error: "Failed to add comment", message: commentError.message });
    }

    res.status(201).json({
      message: "Comment added successfully",
      comment_id: comment.id,
      route_id: comment.route_id,
      user_id: comment.user_id,
      content: comment.content,
      created_at: comment.created_at
    });
  } catch (error) {
    console.error("Error in POST /routes/:id/comments:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

module.exports = router;
