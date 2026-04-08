const { z } = require('zod');

const EVENT_TYPES = [
  'construction',
  'muddy_path',
  'crash',
  'weapon',
  'unsafe',
  'blocked_road',
  'police',
  'crowd_protest',
];

const CreateEventSchema = z.object({
  type: z.enum(EVENT_TYPES, {
    required_error: 'type is required',
    invalid_type_error: `type must be one of: ${EVENT_TYPES.join(', ')}`,
  }),
  // duration_minutes is no longer required — expires_at defaults to 2 hours server-side
  duration_minutes: z
    .number()
    .int('duration_minutes must be an integer')
    .positive('duration_minutes must be a positive integer')
    .optional(),
  lat: z
    .number({ required_error: 'lat is required', invalid_type_error: 'lat must be a number' })
    .min(-90, 'lat must be between -90 and 90')
    .max(90, 'lat must be between -90 and 90'),
  lng: z
    .number({ required_error: 'lng is required', invalid_type_error: 'lng must be a number' })
    .min(-180, 'lng must be between -180 and 180')
    .max(180, 'lng must be between -180 and 180'),
  description: z.string().trim().optional(),
  location_label: z.string().trim().optional(),
  route_id: z.string().uuid('route_id must be a valid UUID').optional(),
});

const ListEventsQuerySchema = z
  .object({
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
  })
  .refine(
    (data) => {
      const hasLat = data.lat !== undefined;
      const hasLng = data.lng !== undefined;
      return hasLat === hasLng;
    },
    { message: 'lat and lng must be provided together for spatial filtering' },
  );

module.exports = { CreateEventSchema, ListEventsQuerySchema };
