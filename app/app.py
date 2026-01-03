import os
from dotenv import load_dotenv
import googlemaps
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from sklearn.cluster import KMeans

# --- FIX: ROBUST IMPORT ---
try:
    from .genetic_solver import GeneticScheduler
except ImportError:
    from genetic_solver import GeneticScheduler
# --------------------------

load_dotenv()
app = Flask(__name__)
CORS(app)

API_key = os.environ.get("GOOGLE_MAPS_API_KEY")
gmaps = googlemaps.Client(key=API_key) if API_key else None
WAREHOUSE_LOC = [13.0827, 80.2707]

def get_distance_matrix(locations, blockages=None):
    # (Keep your existing matrix logic exactly as it is)
    try:
        if not gmaps: raise Exception("No API Key")
        n = len(locations)
        matrix = np.zeros((n, n))
        CHUNK_SIZE = 10 
        print(f"🔄 Fetching Matrix for {n} stops...")

        for i in range(0, n, CHUNK_SIZE):
            for j in range(0, n, CHUNK_SIZE):
                origins = locations[i : i + CHUNK_SIZE]
                dests = locations[j : j + CHUNK_SIZE]
                try:
                    resp = gmaps.distance_matrix(origins, dests, mode="driving")
                    for r_idx, row in enumerate(resp['rows']):
                        for c_idx, element in enumerate(row['elements']):
                            if element['status'] == 'OK':
                                matrix[i + r_idx][j + c_idx] = element['duration']['value']
                            else:
                                matrix[i + r_idx][j + c_idx] = 99999
                except Exception as batch_err:
                    print(f"   ⚠️ Batch Error: {batch_err}")
        
        if blockages and len(blockages) > 0:
            print(f"🚦 Processing {len(blockages)} Traffic Jams...")
            loc_coords = np.array([(l[0], l[1]) for l in locations])
            for block in blockages:
                block_coord = np.array([block[0], block[1]])
                dists = np.linalg.norm(loc_coords - block_coord, axis=1)
                affected_indices = np.where(dists < 0.005)[0]
                if len(affected_indices) > 0:
                    for idx in affected_indices:
                        print(f"   ⛔ ROAD CLOSED near Stop #{idx}")
                        matrix[:, idx] *= 1000 
                        matrix[idx, :] *= 1000

        return matrix
    except Exception as e:
        print(f"❌ Matrix Error: {e}")
        from scipy.spatial import distance
        return distance.cdist(locations, locations, 'euclidean') * 1000 

def get_polyline(start, stops):
    if not gmaps or not stops: return [], "", "0 km", "0 min", []
    try:
        origin = start
        dest = stops[-1]['pickupLocation']['coordinates']
        dest = (dest[1], dest[0]) # Lat, Lng
        waypoints = []
        for s in stops[:-1]:
            c = s['pickupLocation']['coordinates']
            waypoints.append((c[1], c[0])) # Lat, Lng
            
        if len(waypoints) > 23: waypoints = waypoints[:23]

        res = gmaps.directions(origin, dest, waypoints=waypoints, optimize_waypoints=False, mode="driving")
        if res:
            route = res[0]
            poly = route['overview_polyline']['points']
            total_dist = sum([leg['distance']['value'] for leg in route['legs']]) / 1000
            total_dur = sum([leg['duration']['value'] for leg in route['legs']]) / 60
            legs = [{'distance': l['distance']['text'], 'duration': l['duration']['text']} for l in route['legs']]
            return poly, f"{total_dist:.1f} km", f"{total_dur:.0f} min", legs
    except Exception as e:
        print(f"❌ Polyline Error: {e}")
    return "", "", "", []

@app.route('/schedule', methods=['POST'])
def schedule_deliveries():
    data = request.get_json()
    deliveries = data.get('deliveries', [])
    drivers = data.get('drivers', [])
    blockages = data.get('blockages', []) 

    if not drivers or not deliveries: return jsonify({})

    delivery_coords = [[d['pickupLocation']['coordinates'][1], d['pickupLocation']['coordinates'][0]] for d in deliveries]
    
    if len(delivery_coords) < len(drivers):
        clusters = {0: deliveries}
    else:
        kmeans = KMeans(n_clusters=len(drivers), n_init=10).fit(delivery_coords)
        clusters = {}
        for i, label in enumerate(kmeans.labels_):
            clusters.setdefault(int(label), []).append(deliveries[i])

    final_routes = {}

    for i, driver in enumerate(drivers):
        if i not in clusters: continue 
        driver_load = clusters[i]
        
        d_lat = driver['currentLocation']['coordinates'][1]
        d_lng = driver['currentLocation']['coordinates'][0]
        driver_loc = [d_lat, d_lng]
        
        locs = [driver_loc] + [[d['pickupLocation']['coordinates'][1], d['pickupLocation']['coordinates'][0]] for d in driver_load]
        dist_matrix = get_distance_matrix(locs, blockages=blockages)

        cap = 1000 if driver.get('vehicleType') == 'Truck' else 30
        scheduler = GeneticScheduler(dist_matrix, driver_load, cap, 100)
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

if __name__ == '__main__':
    print("🚀 AI Service running on 5001...")
    app.run(port=5001, debug=True)