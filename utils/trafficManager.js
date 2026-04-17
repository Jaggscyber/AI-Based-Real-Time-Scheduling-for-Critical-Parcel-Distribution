/**
 * Traffic Management System
 * Handles traffic blocks, route recalculation, and route versioning
 */

class TrafficManager {
    constructor() {
        this.trafficBlocks = new Map(); // Map<blockId, blockData>
        this.routeVersions = new Map(); // Map<driverId, versionHistory>
    }

    /**
     * Add traffic block to the system
     * @param {Object} blockData - { lat, lng, radius, severity, affectedStreet, eta }
     * @returns {String} Block ID
     */
    addTrafficBlock(blockData) {
        const blockId = `traffic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const block = {
            id: blockId,
            ...blockData,
            createdAt: new Date(),
            resolved: false
        };
        this.trafficBlocks.set(blockId, block);
        return blockId;
    }

    /**
     * Get active traffic blocks
     * @returns {Array} Active traffic blocks
     */
    getActiveBlocks() {
        return Array.from(this.trafficBlocks.values()).filter(block => !block.resolved);
    }

    /**
     * Check if route is affected by traffic
     * @param {Array} routePath - Array of [lat, lng] coordinates
     * @returns {Object} Impact assessment
     */
    checkRouteImpact(routePath) {
        const affectedBlocks = [];
        const activeBlocks = this.getActiveBlocks();

        for (const block of activeBlocks) {
            for (const [idx, point] of routePath.entries()) {
                const distance = this.calculateDistance(point[0], point[1], block.lat, block.lng);
                if (distance <= block.radius) {
                    affectedBlocks.push({
                        blockId: block.id,
                        blockInfo: block,
                        affectedPointIndex: idx,
                        distanceFromBlockCenter: distance
                    });
                }
            }
        }

        return {
            isAffected: affectedBlocks.length > 0,
            affectedBlocks,
            impactSeverity: affectedBlocks.length > 0 ? 'HIGH' : 'NONE',
            requiresReroute: affectedBlocks.length > 0
        };
    }

    /**
     * Create a new route version when traffic forces reroute
     * @param {String} driverId - Driver ID
     * @param {Array} newRoute - New route coordinates
     * @param {Object} routeMetadata - { originalRoute, reason, timeAdded, distanceChange }
     * @returns {Object} Version data
     */
    createRouteVersion(driverId, newRoute, routeMetadata) {
        if (!this.routeVersions.has(driverId)) {
            this.routeVersions.set(driverId, []);
        }

        const versions = this.routeVersions.get(driverId);
        const versionNumber = versions.length + 1;

        const versionData = {
            versionNumber,
            driverId,
            route: newRoute,
            createdAt: new Date(),
            reason: routeMetadata.reason || 'Traffic update',
            originalRoute: routeMetadata.originalRoute,
            distanceChange: routeMetadata.distanceChange || null,
            timeDelayMinutes: routeMetadata.timeDelayMinutes || null,
            trafficBlocksAvoided: routeMetadata.trafficBlocksAvoided || [],
            status: 'ACTIVE'
        };

        versions.push(versionData);
        return versionData;
    }

    /**
     * Get all route versions for a driver
     * @param {String} driverId - Driver ID
     * @returns {Array} Version history
     */
    getRouteHistory(driverId) {
        return this.routeVersions.get(driverId) || [];
    }

    /**
     * Compare two route versions
     * @param {String} driverId - Driver ID
     * @param {Number} version1 - Version number 1
     * @param {Number} version2 - Version number 2
     * @returns {Object} Comparison
     */
    compareRoutes(driverId, version1, version2) {
        const history = this.getRouteHistory(driverId);
        const v1 = history.find(v => v.versionNumber === version1);
        const v2 = history.find(v => v.versionNumber === version2);

        if (!v1 || !v2) {
            return { error: 'Version not found' };
        }

        return {
            version1Data: v1,
            version2Data: v2,
            comparison: {
                distanceDifference: Math.abs(v1.route.length - v2.route.length),
                timeDifference: v2.timeDelayMinutes - (v1.timeDelayMinutes || 0),
                reasonForChange: v2.reason,
                affectedAreas: v2.trafficBlocksAvoided
            }
        };
    }

    /**
     * Calculate distance between two coordinates (Haversine)
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
     * Resolve a traffic block
     * @param {String} blockId - Block ID
     */
    resolveBlock(blockId) {
        const block = this.trafficBlocks.get(blockId);
        if (block) {
            block.resolved = true;
            block.resolvedAt = new Date();
        }
    }

    /**
     * Get statistics about traffic incidents
     * @returns {Object} Statistics
     */
    getTrafficStatistics() {
        const allBlocks = Array.from(this.trafficBlocks.values());
        const activeBlocks = allBlocks.filter(b => !b.resolved);
        
        return {
            totalBlocks: allBlocks.length,
            activeBlocks: activeBlocks.length,
            resolvedBlocks: allBlocks.filter(b => b.resolved).length,
            averageSeverity: activeBlocks.length > 0 
                ? (activeBlocks.reduce((sum, b) => sum + (b.severity || 1), 0) / activeBlocks.length).toFixed(2)
                : 0,
            highSeverityBlocks: activeBlocks.filter(b => b.severity >= 3).length
        };
    }
}

module.exports = new TrafficManager();
