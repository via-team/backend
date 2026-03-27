const { z } = require('zod');

const FriendRequestSchema = z.object({
  friend_id: z
    .string({ required_error: 'friend_id is required' })
    .uuid('friend_id must be a valid UUID'),
});

const FriendParamSchema = z.object({
  id: z
    .string({ required_error: 'id is required' })
    .uuid('id must be a valid UUID'),
});

module.exports = { FriendRequestSchema, FriendParamSchema };
