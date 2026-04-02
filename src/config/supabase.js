const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Creates a Supabase client authenticated as the given user.
 * This sets the Authorization header so RLS policies see the correct auth.uid().
 *
 * @param {string} userToken - The user's JWT token from the Authorization header.
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function createUserClient(userToken) {
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false },
  });
}

/**
 * Service role client (bypasses RLS). Use only after authorization in Express.
 * Set `SUPABASE_SERVICE_ROLE_KEY` in production so creator soft-delete can succeed when
 * user JWT UPDATE policies are misconfigured.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
function getServiceRoleClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !supabaseUrl) {
    return null;
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = supabase;
module.exports.createUserClient = createUserClient;
module.exports.getServiceRoleClient = getServiceRoleClient;
