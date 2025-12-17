const axios = require('axios');
require('dotenv').config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// This function takes a list of coordinates (Waypoints) and returns a Polyline (Blue line)
exports.calculateOptimizedRoute = async (waypoints) => {
    if (!waypoints || waypoints.length < 2) return null;

    try {
        // 1. Format coordinates for Google Maps API
        // Input format is like ["13.08,80.27", "12.97,80.25", ...]
        const origin = waypoints[0];
        const destination = waypoints[waypoints.length - 1];
        
        // Google Maps expects intermediates joined by pipes "|"
        const intermediates = waypoints.slice(1, -1).join('|');

        let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=${GOOGLE_MAPS_API_KEY}`;
        
        if (intermediates) {
            url += `&waypoints=optimize:true|${intermediates}`;
        }

        // 2. Call Google Maps
        const response = await axios.get(url);
        const data = response.data;

        if (data.status === 'OK' && data.routes.length > 0) {
            const route = data.routes[0];
            const polyline = route.overview_polyline.points;
            
            // 3. Calculate Totals
            let totalDistVal = 0;
            let totalDurVal = 0;
            route.legs.forEach(leg => {
                totalDistVal += leg.distance.value;
                totalDurVal += leg.duration.value;
            });

            // Convert meters/seconds to readable strings
            const totalDistance = (totalDistVal / 1000).toFixed(1) + ' km';
            const totalDuration = Math.round(totalDurVal / 60) + ' mins';
            
            const legs = route.legs.map(leg => ({
                distance: leg.distance.text,
                duration: leg.duration.text,
                start_address: leg.start_address,
                end_address: leg.end_address
            }));

            return { polyline, totalDistance, totalDuration, legs };
        } else {
            console.error('Google Maps Route Error:', data.status);
            return null;
        }
    } catch (error) {
        console.error('Route Optimization Error:', error.message);
        return null;
    }
};