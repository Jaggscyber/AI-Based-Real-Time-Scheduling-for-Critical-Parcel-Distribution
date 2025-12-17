import os
from dotenv import load_dotenv
import googlemaps
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from sklearn.cluster import KMeans
from scipy.spatial import distance
from .genetic_solver import GeneticScheduler 

load_dotenv()
app = Flask(__name__)
CORS(app)

API_key = os.environ.get("GOOGLE_MAPS_API_KEY")
gmaps = googlemaps.Client(key=API_key) if API_key else None

# VEHICLE SPECS (KG Capacity, KM Range)
VEHICLE_SPECS = {
    'Bike': {'cap': 30, 'range': 80},
    'Scooter': {'cap': 20, 'range': 50},
    'Small Van': {'cap': 500, 'range': 150},
    'Truck': {'cap': 1000, 'range': 300}
}

def get_distance_matrix(locations, simulate_traffic=False):
    try:
        if not gmaps: raise Exception("No API Key")
        matrix_res = gmaps.distance_matrix(locations, locations, mode="driving")
        matrix = np.array([[elem['duration']['value'] for elem in row['elements']] for row in matrix_res['rows']])
        if simulate_traffic:
            mask = np.random.choice([1, 3], size=matrix.shape, p=[0.7, 0.3])
            matrix = matrix * mask
        return matrix
    except:
        return distance.cdist(locations, locations, 'euclidean') * 1000 

def get_polyline(start, stops):
    if not gmaps or not stops: return "", "0 km", "0 min", []
    try:
        waypoints = [(d['pickupLocation']['coordinates'][1], d['pickupLocation']['coordinates'][0]) for d in stops]
        res = gmaps.directions(start, start, waypoints=waypoints, optimize_waypoints=False, mode="driving")[0]
        poly = res['overview_polyline']['points']
        dist = sum(leg['distance']['value'] for leg in res['legs']) / 1000
        dur = sum(leg['duration']['value'] for leg in res['legs']) // 60
        legs = [{'distance': l['distance']['text'], 'duration': l['duration']['text']} for l in res['legs']]
        return poly, f"{dist:.1f} km", f"{dur} min", legs
    except:
        return "", "N/A", "N/A", []

@app.route('/schedule', methods=['POST'])
def schedule_deliveries():
    data = request.get_json()
    deliveries = data.get('deliveries', [])
    drivers = data.get('drivers', [])
    simulate_traffic = data.get('simulate_traffic', False)

    if not drivers or not deliveries: return jsonify({})

    # 1. K-MEANS CLUSTERING
    delivery_coords = [[d['pickupLocation']['coordinates'][1], d['pickupLocation']['coordinates'][0]] for d in deliveries]
    n_clusters = min(len(drivers), len(deliveries))
    if len(delivery_coords) < 2:
        clusters = {0: deliveries}
    else:
        kmeans = KMeans(n_clusters=n_clusters, n_init=10).fit(delivery_coords)
        clusters = {}
        for i, label in enumerate(kmeans.labels_):
            clusters.setdefault(label, []).append(deliveries[i])

    final_routes = {}

    # 2. SOLVE PER DRIVER
    for i, driver in enumerate(drivers):
        if i not in clusters: continue 
        driver_load = clusters[i]
        driver_loc = [driver['currentLocation']['coordinates'][1], driver['currentLocation']['coordinates'][0]]
        
        v_type = driver.get('vehicleType', 'Bike')
        specs = VEHICLE_SPECS.get(v_type, VEHICLE_SPECS['Bike'])
        
        locs = [driver_loc] + [[d['pickupLocation']['coordinates'][1], d['pickupLocation']['coordinates'][0]] for d in driver_load]
        dist_matrix = get_distance_matrix(locs, simulate_traffic)

        # PASS NEW CONSTRAINTS
        scheduler = GeneticScheduler(dist_matrix, driver_load, specs['cap'], specs['range'])
        optimized_indices = scheduler.solve()
        
        optimized_stops = [driver_load[idx] for idx in optimized_indices]
        poly, total_dist, total_dur, legs = get_polyline(driver_loc, optimized_stops)

        final_routes[driver['_id']] = {
            'driver': driver,
            'stops': optimized_stops,
            'polyline': poly,
            'total_distance': total_dist,
            'total_duration': total_dur,
            'legs': legs
        }

    return jsonify(final_routes)