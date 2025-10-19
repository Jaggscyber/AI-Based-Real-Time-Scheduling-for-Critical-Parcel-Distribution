const axios = require('axios');

// This is an EXAMPLE using the public OSRM server.
// If you have a local OSRM instance or use Mapbox, change this URL.
const OSRM_URL = "http://router.project-osrm.org";

exports.calculateOptimizedRoute = async (waypoints) => {
    try {
        // Waypoints should be in 'longitude,latitude' format, joined by ';'
        const coordinates = waypoints.join(';');
        const url = `${OSRM_URL}/route/v1/driving/${coordinates}?overview=full&geometries=polyline&steps=true`;

        const response = await axios.get(url);

        if (response.data.routes && response.data.routes.length > 0) {
            const route = response.data.routes[0];
            return {
                polyline: route.geometry, // The encoded polyline string
                totalDistance: `${(route.distance / 1000).toFixed(2)} km`,
                totalDuration: `${Math.round(route.duration / 60)} min`,
                legs: route.legs.map(leg => ({
                    distance: `${(leg.distance / 1000).toFixed(2)} km`,
                    duration: `${Math.round(leg.duration / 60)} min`,
                })),
            };
        }
        // Return null if the routing service finds no route
        return null;
    } catch (error) {
        // Log the detailed error from the routing service if it fails
        console.error("Error in calculateOptimizedRoute:", error.response ? error.response.data : error.message);
        throw new Error("Failed to calculate route from the routing service.");
    }
};
