/**
 * Fuel Management System
 * Tracks fuel consumption, identifies range, and manages refueling stations
 */

// Fuel Station Database (mock - can be replaced with real data)
const FUEL_STATIONS = [
    { id: 1, name: 'Shell - Marina Bay', lat: 13.0456, lng: 80.2819, type: 'shell', diesel: true, ev: false },
    { id: 2, name: 'BP - Velachery', lat: 12.9691, lng: 80.2139, type: 'bp', diesel: true, ev: false },
    { id: 3, name: 'EV Charge - Nungambakkam', lat: 13.0511, lng: 80.2419, type: 'ev', diesel: false, ev: true },
    { id: 4, name: 'HP - OMR', lat: 12.8797, lng: 80.2266, type: 'hp', diesel: true, ev: false },
    { id: 5, name: 'EV Fast Charge - Downtown', lat: 13.0584, lng: 80.2693, type: 'ev', diesel: false, ev: true },
    { id: 6, name: 'Reliance - Thiruvanmiyur', lat: 12.9825, lng: 80.2489, type: 'bp', diesel: true, ev: false },
    { id: 7, name: 'EV Slow Charge - Adyar', lat: 13.0039, lng: 80.2489, type: 'ev', diesel: false, ev: true },
    { id: 8, name: 'Shell - Guindy', lat: 13.0035, lng: 80.1887, type: 'shell', diesel: true, ev: false },
];

const CHARGING_STATIONS = [
    { id: 1, name: 'EV Charge - Nungambakkam', lat: 13.0511, lng: 80.2419, type: 'fast', time: 30, power: 150 },
    { id: 2, name: 'EV Fast Charge - Downtown', lat: 13.0584, lng: 80.2693, type: 'fast', time: 20, power: 350 },
    { id: 3, name: 'EV Slow Charge - Adyar', lat: 13.0039, lng: 80.2489, type: 'slow', time: 120, power: 7 },
    { id: 4, name: 'Tech Park Charger', lat: 12.9726, lng: 80.1998, type: 'standard', time: 45, power: 50 },
];

// FUEL CONSUMPTION RATES (per 100km)
const FUEL_CONSUMPTION_RATES = {
    LCV: { diesel: 10, petrol: 12, range: 500 },          // Light Commercial Vehicle
    HCV: { diesel: 15, petrol: null, range: 600 },         // Heavy Commercial Vehicle
    EV: { diesel: null, petrol: null, electric: 15, range: 300 },  // Electric Vehicle
    Mini: { diesel: 8, petrol: 10, range: 400 }            // Mini truck
};

class FuelManager {
    /**
     * Calculate fuel consumption for a trip
     * @param {String} vehicleType - Vehicle type (LCV, HCV, EV, Mini)
     * @param {String} fuelType - Fuel type (diesel, petrol, electric)
     * @param {Number} distanceKm - Distance traveled in km
     * @returns {Object} Consumption data
     */
    calculateFuelConsumption(vehicleType, fuelType, distanceKm) {
        const rates = FUEL_CONSUMPTION_RATES[vehicleType] || FUEL_CONSUMPTION_RATES['LCV'];
        const consumptionRate = rates[fuelType];

        if (!consumptionRate) {
            return { error: `Invalid fuel type ${fuelType} for ${vehicleType}` };
        }

        const fuelUsed = (distanceKm * consumptionRate) / 100;
        const remainingRange = rates.range - distanceKm;

        return {
            vehicleType,
            fuelType,
            distanceKm,
            fuelUsed: parseFloat(fuelUsed.toFixed(2)),
            consumptionRate,
            remainingRange: Math.max(0, remainingRange),
            percentageUsed: Math.min(100, (distanceKm / rates.range) * 100),
            totalRange: rates.range,
            needsRefuel: remainingRange < 50 // Alert if less than 50km range
        };
    }

    /**
     * Find nearby fuel/charging stations
     * @param {Number} latitude - Current location latitude
     * @param {Number} longitude - Current location longitude
     * @param {String} vehicleType - Vehicle type (EV, etc)
     * @param {Number} radiusKm - Search radius in km
     * @returns {Array} Nearby stations
     */
    findNearbyStations(latitude, longitude, vehicleType, radiusKm = 10) {
        const isEV = vehicleType === 'EV';
        const stations = isEV ? CHARGING_STATIONS : FUEL_STATIONS;

        const nearbyStations = stations
            .filter(station => {
                const distance = this.calculateDistance(latitude, longitude, station.lat, station.lng);
                return distance <= radiusKm;
            })
            .map(station => ({
                ...station,
                distance: parseFloat(this.calculateDistance(latitude, longitude, station.lat, station.lng).toFixed(2)),
                eta_minutes: Math.ceil(this.calculateDistance(latitude, longitude, station.lat, station.lng) / 40 * 60) // Assuming 40 km/h avg speed
            }))
            .sort((a, b) => a.distance - b.distance);

        return nearbyStations;
    }

    /**
     * Calculate distance between two coordinates (Haversine formula)
     * @param {Number} lat1 - Latitude 1
     * @param {Number} lon1 - Longitude 1
     * @param {Number} lat2 - Latitude 2
     * @param {Number} lon2 - Longitude 2
     * @returns {Number} Distance in km
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Check if vehicle can reach destination
     * @param {String} vehicleType - Vehicle type
     * @param {String} fuelType - Fuel type
     * @param {Number} remainingFuel - Remaining fuel percentage (0-100)
     * @param {Number} distanceToDestination - Distance in km
     * @returns {Object} Feasibility and recommendations
     */
    canReachDestination(vehicleType, fuelType, remainingFuel, distanceToDestination) {
        const rates = FUEL_CONSUMPTION_RATES[vehicleType];
        const maxDistance = (remainingFuel / 100) * rates.range;

        return {
            canReach: maxDistance >= distanceToDestination,
            maxDistance: parseFloat(maxDistance.toFixed(2)),
            distanceToDestination,
            shortfall: Math.max(0, distanceToDestination - maxDistance),
            recommendedRefuelStop: maxDistance < distanceToDestination,
            nearestStationToCheck: this.findNearbyStations(0, 0, vehicleType)[0] // Will be updated with actual coords
        };
    }

    /**
     * Get all fuel station data
     * @returns {Array} All fuel stations
     */
    getAllFuelStations() {
        return FUEL_STATIONS;
    }

    /**
     * Get all charging stations
     * @returns {Array} All charging stations
     */
    getAllChargingStations() {
        return CHARGING_STATIONS;
    }
}

module.exports = new FuelManager();
