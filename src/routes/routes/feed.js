const express = require('express');
const supabase = require('../../config/supabase');
const { validateQuery } = require('../../middleware/validate');
const { requireAuthForFriendsFeed } = require('../../middleware/requireAuthForFriendsFeed');
const { FeedQuerySchema } = require('../../schemas/routes');
const {
  ROUTE_LIST_SELECT,
  enrichRoutesForList,
  feedTopHotScore,
  fetchRoutesForCreatorsChunked,
} = require('../../services/routeList');
const { resolveLocationFilteredRouteIds } = require('../../services/routeLocation');
const { friendIdsForUser } = require('../../services/friends');

const router = express.Router();

/** Max rows considered for hot-score ranking before pagination (in-memory sort). */
const FEED_TOP_CANDIDATE_LIMIT = 500;

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
  '/feed',
  validateQuery(FeedQuerySchema),
  requireAuthForFriendsFeed,
  async (req, res) => {
    try {
      const { tab, limit, offset, lat, lng, radius } = req.query;
      const parsedLat = lat ?? null;
      const parsedLng = lng ?? null;
      const parsedRadius = radius;

      const locationResult = await resolveLocationFilteredRouteIds(res, supabase, {
        parsedLat,
        parsedLng,
        parsedRadius,
        logContext: 'GET /routes/feed',
        buildEmptyResponse: () => ({
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
        }),
      });

      if (locationResult.handled) {
        return;
      }

      const { ids: locationFilteredIds } = locationResult;

      const buildFilters = (total) => ({
        tab,
        limit,
        offset,
        lat: parsedLat,
        lng: parsedLng,
        radius: parsedRadius,
        total,
      });

      if (tab === 'friends') {
        const userId = req.user.id;
        const { data: friendsData, error: friendsError } = await supabase
          .from('friends')
          .select('requester_id, addressee_id')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
          .eq('status', 'accepted');

        if (friendsError) {
          console.error('Error fetching friends:', friendsError);
          return res.status(500).json({
            error: 'Failed to fetch friends',
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
          console.error('Error fetching friend routes:', fetchErr);
          return res.status(500).json({
            error: 'Failed to fetch routes',
            message: fetchErr.message,
          });
        }

        const total = allFriendRoutes.length;
        const pageRows = allFriendRoutes.slice(offset, offset + limit);
        const { items } = await enrichRoutesForList(supabase, pageRows);
        const finalRoutes = items.map(({ vote_count: _v, ...route }) => route);

        return res.json({
          data: finalRoutes,
          count: finalRoutes.length,
          filters: buildFilters(total),
        });
      }

      if (tab === 'new') {
        let query = supabase
          .from('routes')
          .select(ROUTE_LIST_SELECT, { count: 'exact' })
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (locationFilteredIds !== null) {
          query = query.in('id', locationFilteredIds);
        }

        const {
          data: routeRows,
          error: routesError,
          count: totalCount,
        } = await query.range(offset, offset + limit - 1);

        if (routesError) {
          console.error('Error fetching feed (new):', routesError);
          return res.status(500).json({
            error: 'Failed to fetch routes',
            message: routesError.message,
          });
        }

        const { items } = await enrichRoutesForList(supabase, routeRows || []);
        const finalRoutes = items.map(({ vote_count: _v, ...route }) => route);

        return res.json({
          data: finalRoutes,
          count: finalRoutes.length,
          filters: buildFilters(totalCount ?? finalRoutes.length),
        });
      }

      let topQuery = supabase
        .from('routes')
        .select(ROUTE_LIST_SELECT)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(FEED_TOP_CANDIDATE_LIMIT);

      if (locationFilteredIds !== null) {
        topQuery = topQuery.in('id', locationFilteredIds);
      }

      const { data: candidates, error: topFetchError } = await topQuery;

      if (topFetchError) {
        console.error('Error fetching feed (top):', topFetchError);
        return res.status(500).json({
          error: 'Failed to fetch routes',
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
      console.error('Error in GET /routes/feed:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
      });
    }
  },
);

module.exports = router;
