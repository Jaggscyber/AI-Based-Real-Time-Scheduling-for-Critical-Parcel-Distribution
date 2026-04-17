/**
 * Driver Breakdown & Emergency Assistance System
 * Handles driver breakdowns and reassigns deliveries to nearby drivers
 */

class BreakdownAssistanceManager {
    constructor() {
        this.activeBreakdowns = new Map(); // Map<breakdownId, breakdownData>
    }

    /**
     * Report a driver breakdown
     * @param {String} driverId - Driver ID
     * @param {Array} location - [lat, lng]
     * @param {String} breakdownType - Type of breakdown (mechanical, accident, flat_tire, etc)
     * @param {String} severity - Severity level (low, medium, high)
     * @returns {String} Breakdown ID
     */
    reportBreakdown(driverId, location, breakdownType, severity = 'medium') {
        const breakdownId = `breakdown_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const breakdown = {
            id: breakdownId,
            driverId,
            location: { lat: location[0], lng: location[1] },
            type: breakdownType,
            severity,
            reportedAt: new Date(),
            status: 'ACTIVE',
            assistanceRequested: false,
            nearbyDrivers: [],
            reassignedDeliveries: []
        };
        this.activeBreakdowns.set(breakdownId, breakdown);
        return breakdownId;
    }

    /**
     * Find nearby healthy drivers for assistance
     * @param {String} breakdownId - Breakdown ID
     * @param {Array} allAvailableDrivers - Array of driver objects with location
     * @param {Number} radiusKm - Search radius in km
     * @param {Boolean} considerCapacity - Filter by vehicle capacity
     * @returns {Array} Nearby available drivers ranked by suitability
     */
    findNearbyDriversForAssistance(breakdownId, allAvailableDrivers, radiusKm = 15, considerCapacity = true) {
        const breakdown = this.activeBreakdowns.get(breakdownId);
        if (!breakdown) return { error: 'Breakdown not found' };

        const { location } = breakdown;
        const nearbyDrivers = [];

        for (const driver of allAvailableDrivers) {
            if (!driver.location || driver.id === breakdown.driverId) continue;

            const distance = this.calculateDistance(
                location.lat, location.lng,
                driver.location.lat, driver.location.lng
            );

            if (distance <= radiusKm) {
                nearbyDrivers.push({
                    driverId: driver.id,
                    driverName: driver.name,
                    distance: parseFloat(distance.toFixed(2)),
                    vehicleType: driver.vehicleType,
                    currentCapacity: driver.currentCapacity || 0,
                    maxCapacity: driver.maxCapacity || 1000,
                    availableCapacity: (driver.maxCapacity || 1000) - (driver.currentCapacity || 0),
                    location: driver.location,
                    eta_minutes: Math.ceil((distance / 40) * 60), // Assuming 40 km/h avg
                    suitabilityScore: this.calculateSuitabilityScore(driver, distance, considerCapacity)
                });
            }
        }

        // Sort by suitability score (highest first)
        nearbyDrivers.sort((a, b) => b.suitabilityScore - a.suitabilityScore);

        breakdown.nearbyDrivers = nearbyDrivers;
        breakdown.assistanceRequested = true;

        return nearbyDrivers;
    }

    /**
     * Calculate suitability score for a driver to assist
     * @param {Object} driver - Driver object
     * @param {Number} distance - Distance in km
     * @param {Boolean} considerCapacity - Include capacity in score
     * @returns {Number} Score 0-100
     */
    calculateSuitabilityScore(driver, distance, considerCapacity = true) {
        const maxDistance = 20;
        const distanceScore = Math.max(0, (1 - (distance / maxDistance)) * 50); // 50 points for distance

        let capacityScore = 0;
        if (considerCapacity) {
            const availableCapacity = (driver.maxCapacity || 1000) - (driver.currentCapacity || 0);
            capacityScore = Math.min(30, (availableCapacity / (driver.maxCapacity || 1000)) * 30); // 30 points for capacity
        }

        const availabilityScore = driver.status === 'available' ? 20 : 0; // 20 points for availability

        return distanceScore + capacityScore + availabilityScore;
    }

    /**
     * Reassign deliveries from broken driver to nearby driver
     * @param {String} breakdownId - Breakdown ID
     * @param {String} targetDriverId - Target driver to reassign to
     * @param {Array} deliveriesToReassign - Delivery IDs to reassign
     * @returns {Object} Reassignment result
     */
    reassignDeliveries(breakdownId, targetDriverId, deliveriesToReassign) {
        const breakdown = this.activeBreakdowns.get(breakdownId);
        if (!breakdown) return { error: 'Breakdown not found' };

        const targetDriver = breakdown.nearbyDrivers.find(d => d.driverId === targetDriverId);
        if (!targetDriver) return { error: 'Target driver not found in nearby list' };

        const reassignmentRecord = {
            fromDriver: breakdown.driverId,
            toDriver: targetDriverId,
            deliveries: deliveriesToReassign,
            reassignedAt: new Date(),
            reason: `Emergency pickup due to driver breakdown at ${breakdown.location.lat}, ${breakdown.location.lng}`,
            status: 'COMPLETED'
        };

        breakdown.reassignedDeliveries.push(reassignmentRecord);

        return {
            success: true,
            reassignmentId: `reassign_${Date.now()}`,
            details: reassignmentRecord,
            receivingDriver: targetDriver,
            deliveriesReassigned: deliveriesToReassign.length
        };
    }

    /**
     * Resolve a breakdown
     * @param {String} breakdownId - Breakdown ID
     * @param {String} resolution - How it was resolved
     */
    resolveBreakdown(breakdownId, resolution = 'RESOLVED') {
        const breakdown = this.activeBreakdowns.get(breakdownId);
        if (breakdown) {
            breakdown.status = 'RESOLVED';
            breakdown.resolvedAt = new Date();
            breakdown.resolution = resolution;
        }
    }

    /**
     * Get all active breakdowns
     * @returns {Array} Active breakdown incidents
     */
    getActiveBreakdowns() {
        return Array.from(this.activeBreakdowns.values()).filter(b => b.status === 'ACTIVE');
    }

    /**
     * Get breakdown details
     * @param {String} breakdownId - Breakdown ID
     * @returns {Object} Breakdown details
     */
    getBreakdownDetails(breakdownId) {
        return this.activeBreakdowns.get(breakdownId);
    }

    /**
     * Calculate distance between coordinates
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // km
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
     * Get breakdown statistics
     * @returns {Object} Statistics
     */
    getBreakdownStatistics() {
        const allBreakdowns = Array.from(this.activeBreakdowns.values());
        return {
            totalIncidents: allBreakdowns.length,
            activeIncidents: allBreakdowns.filter(b => b.status === 'ACTIVE').length,
            resolvedIncidents: allBreakdowns.filter(b => b.status === 'RESOLVED').length,
            byType: this.groupByType(allBreakdowns),
            bySeverity: this.groupBySeverity(allBreakdowns)
        };
    }

    groupByType(breakdowns) {
        return breakdowns.reduce((acc, b) => {
            acc[b.type] = (acc[b.type] || 0) + 1;
            return acc;
        }, {});
    }

    groupBySeverity(breakdowns) {
        return breakdowns.reduce((acc, b) => {
            acc[b.severity] = (acc[b.severity] || 0) + 1;
            return acc;
        }, {});
    }
}

module.exports = new BreakdownAssistanceManager();
