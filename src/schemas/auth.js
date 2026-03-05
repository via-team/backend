const { z } = require('zod');

const VerifySchoolEmailSchema = z.object({
  email: z
    .string({ required_error: 'email is required' })
    .trim()
    .email('Invalid email format'),
});

module.exports = { VerifySchoolEmailSchema };
