const { z } = require('zod');

const GpsPointSchema = z.object({
  seq: z
    .number({ required_error: 'seq is required', invalid_type_error: 'seq must be a number' })
    .int('seq must be an integer'),
  lat: z
    .number({ required_error: 'lat is required', invalid_type_error: 'lat must be a number' })
    .min(-90, 'lat must be between -90 and 90')
    .max(90, 'lat must be between -90 and 90'),
  lng: z
    .number({ required_error: 'lng is required', invalid_type_error: 'lng must be a number' })
    .min(-180, 'lng must be between -180 and 180')
    .max(180, 'lng must be between -180 and 180'),
  acc: z.number({ invalid_type_error: 'acc must be a number' }).nonnegative().optional(),
  time: z
    .string({ required_error: 'time is required' })
    .datetime({ message: 'time must be a valid ISO 8601 datetime' }),
});

const CreateRouteSchema = z.object({
  title: z
    .string({ required_error: 'title is required' })
    .trim()
    .min(1, 'title must not be empty'),
  description: z.string().trim().optional(),
  start_label: z
    .string({ required_error: 'start_label is required' })
    .trim()
    .min(1, 'start_label must not be empty'),
  end_label: z
    .string({ required_error: 'end_label is required' })
    .trim()
    .min(1, 'end_label must not be empty'),
  start_time: z
    .string({ required_error: 'start_time is required' })
    .datetime({ message: 'start_time must be a valid ISO 8601 datetime' }),
  end_time: z
    .string({ required_error: 'end_time is required' })
    .datetime({ message: 'end_time must be a valid ISO 8601 datetime' }),
  tags: z
    .array(z.string().uuid('each tag must be a valid UUID'))
    .optional()
    .default([]),
  points: z
    .array(GpsPointSchema, { required_error: 'points is required' })
    .min(1, 'points must contain at least one GPS point'),
});

const ListRoutesQuerySchema = z.object({
  lat: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().min(-90).max(90).optional(),
  ),
  lng: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().min(-180).max(180).optional(),
  ),
  radius: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().int().positive().optional().default(500),
  ),
  dest_lat: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().min(-90).max(90).optional(),
  ),
  dest_lng: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().min(-180).max(180).optional(),
  ),
  tags: z.string().optional(),
  sort: z.enum(['recent', 'popular', 'efficient']).optional().default('recent'),
});

const FeedQuerySchema = z.object({
  tab: z.enum(['top', 'friends', 'new'], {
    required_error: 'tab is required',
    invalid_type_error: "tab must be 'top', 'friends', or 'new'",
  }),
  limit: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().int().positive().max(100).optional().default(20),
  ),
  offset: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().int().min(0).optional().default(0),
  ),
  lat: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().min(-90).max(90).optional(),
  ),
  lng: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().min(-180).max(180).optional(),
  ),
  radius: z.preprocess(
    (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
    z.number().int().positive().optional().default(500),
  ),
});

const VoteSchema = z.object({
  vote_type: z.enum(['up', 'down'], {
    required_error: 'vote_type is required',
    invalid_type_error: "vote_type must be 'up' or 'down'",
  }),
  context: z.enum(['safety', 'efficiency', 'scenery'], {
    required_error: 'context is required',
    invalid_type_error: "context must be 'safety', 'efficiency', or 'scenery'",
  }),
});

const CommentSchema = z.object({
  content: z
    .string({ required_error: 'content is required' })
    .trim()
    .min(1, 'content must not be empty'),
});

module.exports = {
  CreateRouteSchema,
  ListRoutesQuerySchema,
  FeedQuerySchema,
  VoteSchema,
  CommentSchema,
};
