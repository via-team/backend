/**
 * Express middleware factory that validates req.body against a Zod schema.
 *
 * On success the parsed (and coerced) value replaces req.body so handlers
 * always receive clean, typed data.
 *
 * On failure a uniform 400 response is returned:
 *   { error: "Validation error", issues: [ { field, message }, ... ] }
 *
 * @param {import('zod').ZodTypeAny} schema
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((e) => ({
        field: e.path.join('.') || '(root)',
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation error', issues });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Express middleware factory that validates req.query against a Zod schema.
 * Same contract as validateBody.
 *
 * @param {import('zod').ZodTypeAny} schema
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const issues = result.error.issues.map((e) => ({
        field: e.path.join('.') || '(root)',
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation error', issues });
    }
    req.query = result.data;
    next();
  };
}

/**
 * Express middleware factory that validates req.params against a Zod schema.
 * Same contract as validateBody.
 *
 * @param {import('zod').ZodTypeAny} schema
 */
function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const issues = result.error.issues.map((e) => ({
        field: e.path.join('.') || '(root)',
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation error', issues });
    }
    req.params = result.data;
    next();
  };
}

module.exports = { validateBody, validateQuery, validateParams };
