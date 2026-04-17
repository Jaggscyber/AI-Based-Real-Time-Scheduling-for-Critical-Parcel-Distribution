const axios = require('axios');
require('dotenv').config();

const ORS_KEY = process.env.ORS_API_KEY;
const GRAPHHOPPER_KEY = process.env.GRAPHHOPPER_KEY || ''; // optional backup

/**
 * Main routing entry point.
 * Chain: ORS → GraphHopper → OSRM (alternative server) → OSRM (original) → straight-line
 * Accepts waypoints as ["lat,lng", "lat,lng", ...]
 */
exports.calculateOptimizedRoute = async (waypoints, avoidPoints = []) => {
    if (!waypoints || waypoints.length < 2) return null;

    // ── 1. OpenRouteService ────────────────────────────────────────────────
    try {
        const orsResult = await callORS(waypoints, avoidPoints);
        if (orsResult) {
            console.log(`[Router] ORS success — ${orsResult.totalDistance}`);
            return orsResult;
        }
    } catch (err) {
        console.warn('[Router] ORS failed:', err.response?.data?.error?.message || err.message);
    }

    // ── 2. GraphHopper fallback (if key provided) ─────────────────────────
    if (GRAPHHOPPER_KEY) {
        try {
            const ghResult = await callGraphHopper(waypoints);
            if (ghResult) {
                console.log(`[Router] GraphHopper success — ${ghResult.totalDistance}`);
                return ghResult;
            }
        } catch (err) {
            console.warn('[Router] GraphHopper failed:', err.message);
        }
    }

    // ── 3. OSRM (alternative public server) ──────────────────────────────
    try {
        const osrmResult = await callOSRM(waypoints, 'https://routing.openstreetmap.de/routed-car/route/v1/driving/');
        if (osrmResult) {
            console.log(`[Router] OSRM (alt) success — ${osrmResult.totalDistance}`);
            return osrmResult;
        }
    } catch (err) {
        console.warn('[Router] OSRM alt failed:', err.message);
    }

    // ── 4. OSRM (original public server) ─────────────────────────────────
    try {
        const osrmResult = await callOSRM(waypoints, 'http://router.project-osrm.org/route/v1/driving/');
        if (osrmResult) {
            console.log(`[Router] OSRM (original) success — ${osrmResult.totalDistance}`);
            return osrmResult;
        }
    } catch (err) {
        console.warn('[Router] OSRM original failed:', err.message);
    }

    // ── 5. Haversine straight-line fallback ───────────────────────────────
    console.warn('[Router] All routing services failed — using straight-line fallback');
    return buildStraightLineFallback(waypoints);
};

// ─────────────────────────────────────────────────────────────────────────────
// ORS
// ─────────────────────────────────────────────────────────────────────────────
async function callORS(waypoints, avoidPoints = []) {
    // Insert detour waypoints around traffic blocks
    const effectiveWaypoints = avoidPoints.length > 0
        ? insertDetourWaypoints(waypoints, avoidPoints)
        : waypoints;

    // ORS expects [longitude, latitude]
    const coordinates = effectiveWaypoints.map(w => {
        const parts = typeof w === 'string' ? w.split(',').map(Number) : w;
        const lat = Array.isArray(parts) ? parts[0] : parseFloat(w.split(',')[0]);
        const lng = Array.isArray(parts) ? parts[1] : parseFloat(w.split(',')[1]);
        return [lng, lat]; // [lng, lat] for ORS
    });

    const body = { coordinates };
    if (avoidPoints.length > 0) {
        // ORS avoid_polygons — create small circles around each block
        const polygons = avoidPoints.map(bp => {
            const [blat, blng] = Array.isArray(bp) ? bp : [bp.lat, bp.lng];
            return createAvoidPolygon(blat, blng, 0.003); // ~300m radius polygon
        });
        body.options = { avoid_polygons: { type: 'MultiPolygon', coordinates: polygons } };
    }

    const url = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
    
    // Try with JWT token directly (ORS new format)
    const response = await axios.post(url, body, {
        headers: {
            'Authorization': ORS_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json, application/geo+json'
        },
        timeout: 10000
    });

    const feature = response.data.features?.[0];
    if (!feature) return null;

    const summary = feature.properties.summary;
    const latLngCoords = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const distKm = +(summary.distance / 1000).toFixed(2);
    const durationMin = +(summary.duration / 60).toFixed(1);

    return {
        polyline: JSON.stringify(latLngCoords),
        totalDistance: distKm.toFixed(1) + ' km',
        totalDuration: Math.round(durationMin) + ' min',
        distanceKm: distKm,
        durationMin: durationMin,
        legs: []
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphHopper (free 500 req/day with key)
// ─────────────────────────────────────────────────────────────────────────────
async function callGraphHopper(waypoints) {
    const points = waypoints.map(w => {
        const parts = typeof w === 'string' ? w.split(',').map(Number) : w;
        return `point=${parts[0]},${parts[1]}`;
    }).join('&');

    const url = `https://graphhopper.com/api/1/route?${points}&vehicle=car&locale=en&calc_points=true&points_encoded=false&key=${GRAPHHOPPER_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });

    const path = response.data.paths?.[0];
    if (!path) return null;

    const latLngCoords = path.points.coordinates.map(([lng, lat]) => [lat, lng]);
    const distKm = +(path.distance / 1000).toFixed(2);
    const durationMin = +(path.time / 60000).toFixed(1);

    return {
        polyline: JSON.stringify(latLngCoords),
        totalDistance: distKm.toFixed(1) + ' km',
        totalDuration: Math.round(durationMin) + ' min',
        distanceKm: distKm,
        durationMin: durationMin,
        legs: []
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// OSRM (generic, accepts base URL)
// ─────────────────────────────────────────────────────────────────────────────
async function callOSRM(waypoints, baseUrl, maxRetries = 2) {
    const coords = waypoints.map(w => {
        const parts = typeof w === 'string' ? w.split(',').map(Number) : w;
        const lat = Array.isArray(parts) ? parts[0] : parseFloat(w);
        const lng = Array.isArray(parts) ? parts[1] : parseFloat(w.split(',')[1]);
        return `${lng},${lat}`;
    }).join(';');

    const url = `${baseUrl}${coords}?overview=full&geometries=geojson`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get(url, { timeout: 10000 });
            const data = response.data;
            if (data.code !== 'Ok' || !data.routes?.length) continue;

            const route = data.routes[0];
            const latLngCoords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
            const distKm = +(route.distance / 1000).toFixed(2);
            const durationMin = +(route.duration / 60).toFixed(1);

            return {
                polyline: JSON.stringify(latLngCoords),
                totalDistance: distKm.toFixed(1) + ' km',
                totalDuration: Math.round(durationMin) + ' min',
                distanceKm: distKm,
                durationMin: durationMin,
                legs: []
            };
        } catch (err) {
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, 800 * attempt));
            else throw err;
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Haversine straight-line fallback
// ─────────────────────────────────────────────────────────────────────────────
function buildStraightLineFallback(waypoints) {
    const points = waypoints.map(w => {
        const parts = typeof w === 'string' ? w.split(',').map(Number) : w;
        return [parts[0], parts[1]];
    });

    // Compute total haversine distance
    let totalKm = 0;
    for (let i = 0; i < points.length - 1; i++) {
        totalKm += haversineKm(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    }

    return {
        polyline: JSON.stringify(points),
        totalDistance: totalKm.toFixed(1) + ' km',
        totalDuration: Math.round(totalKm * 3) + ' min', // assume ~20 km/h avg
        distanceKm: +totalKm.toFixed(2),
        durationMin: Math.round(totalKm * 3),
        legs: [],
        isFallback: true
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Traffic block avoidance helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For each blockage, insert a detour waypoint perpendicular to the route
 * if any segment passes within 500m of the block.
 */
function insertDetourWaypoints(waypoints, avoidPoints) {
    if (!avoidPoints || avoidPoints.length === 0) return waypoints;

    const result = [...waypoints];
    for (const block of avoidPoints) {
        const [blat, blng] = Array.isArray(block) ? block : [block.lat || block[0], block.lng || block[1]];
        
        // Find which segment is closest to this block
        let minDist = Infinity, insertAfterIdx = -1;
        for (let i = 0; i < result.length - 1; i++) {
            const [lat1, lng1] = parsePt(result[i]);
            const [lat2, lng2] = parsePt(result[i + 1]);
            const midLat = (lat1 + lat2) / 2;
            const midLng = (lng1 + lng2) / 2;
            const d = haversineKm(midLat, midLng, blat, blng);
            if (d < minDist) { minDist = d; insertAfterIdx = i; }
        }

        // Insert detour only if within 500m
        if (minDist < 0.5 && insertAfterIdx >= 0) {
            const [lat1, lng1] = parsePt(result[insertAfterIdx]);
            const [lat2, lng2] = parsePt(result[insertAfterIdx + 1]);
            // Perpendicular offset ~300m north
            const detourLat = blat + 0.003;
            const detourLng = (lng1 + lng2) / 2;
            const detourPt = `${detourLat},${detourLng}`;
            result.splice(insertAfterIdx + 1, 0, detourPt);
        }
    }
    return result;
}

/**
 * Create a small polygon (~300m) around a block point for ORS avoid_polygons
 */
function createAvoidPolygon(lat, lng, r) {
    // r in degrees; 0.003 ≈ 330m
    const pts = [];
    for (let i = 0; i <= 8; i++) {
        const angle = (i / 8) * 2 * Math.PI;
        pts.push([lng + r * Math.cos(angle), lat + r * Math.sin(angle)]);
    }
    return [[pts]];
}

function parsePt(pt) {
    if (typeof pt === 'string') return pt.split(',').map(Number);
    if (Array.isArray(pt)) return [pt[0], pt[1]];
    return [pt.lat, pt.lng];
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}