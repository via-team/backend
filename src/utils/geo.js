/**
 * Geographic utility functions for the VIA backend.
 *
 * Centralises the Haversine distance calculation (previously inlined in the
 * route-creation handler) and adds the helpers needed to produce a
 * Google-Encoded-Polyline preview from a set of GPS points.
 */

/**
 * Encodes a single signed integer value according to the Google Encoded
 * Polyline Algorithm Format.
 *
 * Spec: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function encodeValue(value) {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let output = "";
    while (v >= 0x20) {
        output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
    }
    output += String.fromCharCode(v + 63);
    return output;
}

/**
 * Encodes an array of {lat, lng} objects as a Google Encoded Polyline string.
 * Returns an empty string for an empty or null input.
 *
 * @param {Array<{lat: number, lng: number}>} points
 * @returns {string}
 */
function encodePolyline(points) {
    if (!points || points.length === 0) return "";

    let output = "";
    let prevLat = 0;
    let prevLng = 0;

    for (const point of points) {
        const lat = Math.round(point.lat * 1e5);
        const lng = Math.round(point.lng * 1e5);
        output += encodeValue(lat - prevLat);
        output += encodeValue(lng - prevLng);
        prevLat = lat;
        prevLng = lng;
    }

    return output;
}

/**
 * Downsamples an array of points to at most `maxPoints` entries while always
 * preserving the first and last point.  If the array is already shorter than
 * `maxPoints` it is returned unchanged.
 *
 * Uses uniform stride sampling (every Nth point) which is sufficient for a
 * low-fidelity preview polyline.
 *
 * @param {Array<object>} points  Must have at least a `lat` and `lng` property.
 * @param {number}        maxPoints  Target maximum number of output points (default 20).
 * @returns {Array<object>}
 */
function samplePoints(points, maxPoints = 20) {
    if (!points || points.length <= maxPoints) return points ?? [];

    const sampled = [];
    // Distribute maxPoints evenly across the full index range.
    const step = (points.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) {
        sampled.push(points[Math.round(i * step)]);
    }
    return sampled;
}

/**
 * Calculates the total path length in metres for an ordered array of GPS
 * points using the Haversine formula.
 *
 * Each element must have `lat` and `lng` properties in decimal degrees.
 *
 * @param {Array<{lat: number, lng: number}>} points
 * @returns {number}  Total distance in metres.
 */
function calculateDistance(points) {
    const R = 6_371_000; // Earth radius in metres
    let total = 0;

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        const lat1 = (p1.lat * Math.PI) / 180;
        const lat2 = (p2.lat * Math.PI) / 180;
        const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
        const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

        total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    return total;
}

module.exports = { encodePolyline, samplePoints, calculateDistance };
