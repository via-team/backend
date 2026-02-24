-- RPC function to get route points with extracted lat/lng coordinates
-- This function extracts latitude and longitude from PostGIS geography type

CREATE OR REPLACE FUNCTION get_route_points_with_coords(p_route_id uuid)
RETURNS TABLE (
  sequence int,
  lat double precision,
  lng double precision,
  accuracy_meters double precision,
  recorded_at timestamptz
) 
LANGUAGE sql
STABLE
AS $$
  SELECT
    sequence,
    ST_Y(location::geometry) as lat,
    ST_X(location::geometry) as lng,
    accuracy_meters,
    recorded_at
  FROM route_points
  WHERE route_id = p_route_id
  ORDER BY sequence ASC;
$$;
