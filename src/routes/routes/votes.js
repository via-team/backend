const express = require("express");
const supabase = require("../../config/supabase");
const { requireAuth } = require("../../middleware/auth");
const { voteRateLimit } = require("../../middleware/rateLimit");
const { validateBody } = require("../../middleware/validate");
const { VoteSchema } = require("../../schemas/routes");
const { aggregateVotes } = require("../../services/voteStats");

const router = express.Router();

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
router.post(
    "/:id/vote",
    voteRateLimit,
    requireAuth,
    validateBody(VoteSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { vote_type, context } = req.body;
            const user_id = req.user.id;

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

            // Enforce a single vote per user per route regardless of DB unique-index shape.
            const { error: deleteVoteError } = await supabase
                .from("votes")
                .delete()
                .eq("route_id", id)
                .eq("user_id", user_id);

            if (deleteVoteError) {
                console.error("Error clearing existing vote:", deleteVoteError);
                return res.status(500).json({
                    error: "Failed to record vote",
                    message: deleteVoteError.message,
                });
            }

            const { error: voteError } = await supabase
                .from("votes")
                .insert({ route_id: id, user_id, vote_type, context });

            if (voteError) {
                console.error("Error upserting vote:", voteError);
                return res.status(500).json({
                    error: "Failed to record vote",
                    message: voteError.message,
                });
            }

            const { data: votes, error: totalsError } = await supabase
                .from("votes")
                .select("vote_type")
                .eq("route_id", id);

            const totals =
                !totalsError && votes
                    ? aggregateVotes(votes)
                    : { voteCount: 0, upvotes: 0, downvotes: 0, avgRating: 0 };

            res.status(201).json({
                message: "Vote recorded successfully",
                route_id: id,
                vote_type,
                context,
                vote_count: totals.voteCount,
                upvotes: totals.upvotes,
                downvotes: totals.downvotes,
                avg_rating: totals.avgRating,
            });
        } catch (error) {
            console.error("Error in POST /routes/:id/vote:", error);
            res.status(500).json({
                error: "Internal server error",
                message: error.message,
            });
        }
    },
);

module.exports = router;
