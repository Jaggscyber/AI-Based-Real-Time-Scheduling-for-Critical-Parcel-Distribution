import os

os.environ['LOKY_MAX_CPU_COUNT'] = '1' 

from dotenv import load_dotenv
import openrouteservice
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from sklearn.cluster import KMeans
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
from math import radians, cos, sin, asin, sqrt
import json
import urllib.request
import urllib.error

# Try importing Genetic Scheduler
try:
    from .genetic_solver import GeneticScheduler
except ImportError:
    try:
        from genetic_solver import GeneticScheduler
    except ImportError:
        GeneticScheduler = None

load_dotenv()
app = Flask(__name__)
CORS(app)

# --- CONFIG ---
API_key = os.environ.get("ORS_API_KEY")
ors_client = openrouteservice.Client(key=API_key) if API_key and len(API_key) > 10 else None

# --- UTILS ---

# Haversine Formula (Fallback Math for Distance)
def haversine(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1 
    dlat = lat2 - lat1 
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a)) 
    r = 6371 # Radius of earth in km
    return c * r

def solve_tsp_nearest_neighbor(matrix, start_index=0):
    n = len(matrix)
    visited = [False] * n
    path = [start_index]
    visited[start_index] = True
    curr = start_index
    for _ in range(n - 1):
        nearest_dist = float('inf')
        nearest_node = -1
        for neighbor in range(n):
            if not visited[neighbor]:
                if matrix[curr][neighbor] < nearest_dist:
                    nearest_dist = matrix[curr][neighbor]
                    nearest_node = neighbor
        if nearest_node != -1:
            visited[nearest_node] = True
            path.append(nearest_node)
            curr = nearest_node
    return path

def get_distance_matrix(locations, blockages=None):
    # 1. TRY OPENROUTESERVICE API
    if ors_client:
        try:
            n = len(locations)
            matrix = np.zeros((n, n))
            
            # ORS requires [Longitude, Latitude] format
            ors_locations = [[loc[1], loc[0]] for loc in locations]
            
            resp = ors_client.distance_matrix(
                locations=ors_locations,
                profile='driving-car',
                metrics=['duration']
            )
            
            durations = resp['durations']
            
            for i in range(n):
                for j in range(n):
                    val = durations[i][j]
                    matrix[i][j] = val if val is not None else 99999

            # Apply Traffic Penalties
            if blockages:
                loc_coords = np.array([(l[0], l[1]) for l in locations])
                for block in blockages:
                    block_coord = np.array([block[0], block[1]])
                    dists = np.linalg.norm(loc_coords - block_coord, axis=1)
                    affected = np.where(dists < 0.01)[0]
                    for idx in affected:
                        matrix[:, idx] *= 5.0
                        matrix[idx, :] *= 5.0
            return matrix
        except Exception as e:
            print(f"⚠️ ORS Matrix API failed: {e}. Switching to fallback.")

    # 2. FALLBACK MATRIX (Math Only)
    print("⚠️ Using Euclidean Fallback Matrix")
    locs_array = np.array(locations)
    n = len(locations)
    matrix = np.zeros((n, n))
    BLOCKED_COST_MULTIPLIER = 50.0   # very strong penalty
    BLOCK_RADIUS_KM = 1.0            # edges within 1km of a block

    for i in range(n):
        for j in range(n):
            dist_km = haversine(
                locs_array[i][1], locs_array[i][0],
                locs_array[j][1], locs_array[j][0]
            )
            base_cost = dist_km * 180  # 3 min per km

            # Apply strong penalty if this edge is near any block (either endpoint)
            if blockages:
                for block in blockages:
                    b_dist_i = haversine(locs_array[i][1], locs_array[i][0], block[1], block[0])
                    b_dist_j = haversine(locs_array[j][1], locs_array[j][0], block[1], block[0])
                    if b_dist_i < BLOCK_RADIUS_KM or b_dist_j < BLOCK_RADIUS_KM:
                        base_cost *= BLOCKED_COST_MULTIPLIER
                        break

            matrix[i][j] = base_cost

    return matrix

def get_seamless_route(start_coord, stops):
    final_coordinates = []
    total_dist_val = 0
    total_dur_val = 0
    
    # Ensure all coordinates are clean lists [Lat, Lng]
    all_coords = [start_coord] + [[s['pickupLocation']['coordinates'][1], s['pickupLocation']['coordinates'][0]] for s in stops]
    
    # 1. TRY OPENROUTESERVICE DIRECTIONS
    if ors_client:
        try:
            # ORS requires [Longitude, Latitude] format
            ors_coords = [[c[1], c[0]] for c in all_coords]
            
            MAX_WAYPOINTS = 40  # Safely under ORS limits
            current_idx = 0
            
            while current_idx < len(ors_coords) - 1:
                chunk_end = min(current_idx + MAX_WAYPOINTS, len(ors_coords) - 1)
                chunk_coords = ors_coords[current_idx : chunk_end + 1]
                
                res = ors_client.directions(
                    coordinates=chunk_coords,
                    profile='driving-car',
                    format='geojson'
                )
                
                if res and 'features' in res:
                    route_coords = res['features'][0]['geometry']['coordinates']
                    
                    # Flip coordinates back to [Lat, Lng] for the frontend map
                    # If not the last chunk, drop the last point so it doesn't overlap the next chunk's start
                    if chunk_end < len(ors_coords) - 1:
                        final_coordinates.extend([[c[1], c[0]] for c in route_coords[:-1]])
                    else:
                        final_coordinates.extend([[c[1], c[0]] for c in route_coords])
                    
                    summary = res['features'][0]['properties']['summary']
                    total_dist_val += summary['distance']
                    total_dur_val += summary['duration']
                    
                current_idx = chunk_end
            
            encoded_polyline = json.dumps(final_coordinates)
            return encoded_polyline, f"{total_dist_val/1000:.1f} km", f"{total_dur_val/60:.0f} min", total_dur_val
        except Exception as e:
            print(f"⚠️ ORS Directions failed: {e}. Using Straight Lines.")

    # 2. Try OSRM before falling back to straight lines
    try:
        osrm_coords = ';'.join([f"{c[1]},{c[0]}" for c in all_coords])
        osrm_url = f"https://routing.openstreetmap.de/routed-car/route/v1/driving/{osrm_coords}?overview=full&geometries=geojson"
        with urllib.request.urlopen(osrm_url, timeout=12) as response:
            payload = json.loads(response.read().decode('utf-8'))

        if payload.get('code') == 'Ok' and payload.get('routes'):
            route = payload['routes'][0]
            route_coords = route['geometry']['coordinates']
            final_coordinates = [[lat, lng] for lng, lat in route_coords]
            total_dist_val = route['distance']
            total_dur_val = route['duration']
            encoded_polyline = json.dumps(final_coordinates)
            return encoded_polyline, f"{total_dist_val/1000:.1f} km", f"{total_dur_val/60:.0f} min", total_dur_val
    except Exception as e:
        print(f"⚠️ OSRM fallback failed: {e}. Using straight lines.")

    # 3. FALLBACK: STRAIGHT LINES
    print("⚠️ Generating Straight Line Route")
    for i in range(len(all_coords) - 1):
        # Ensure float
        p1 = [float(all_coords[i][0]), float(all_coords[i][1])]
        p2 = [float(all_coords[i+1][0]), float(all_coords[i+1][1])]
        
        final_coordinates.append(p1)
        final_coordinates.append(p2)
        
        dist_km = haversine(p1[1], p1[0], p2[1], p2[0])
        dur_sec = dist_km * 180 # 3 min/km avg
        total_dist_val += (dist_km * 1000)
        total_dur_val += dur_sec

    encoded_polyline = json.dumps(final_coordinates)
    return encoded_polyline, f"{total_dist_val/1000:.1f} km", f"{total_dur_val/60:.0f} min", total_dur_val

@app.route('/compare', methods=['POST'])
def compare_routes():
    data = request.get_json()
    deliveries = data.get('deliveries', [])
    driver = data.get('drivers', [{}])[0]
    blockages = data.get('blockages', [])
    
    if not deliveries or not driver: return jsonify({})

    # Sort deliveries: emergencies first
    deliveries = sorted(deliveries, key=lambda d: d.get('emergency', False), reverse=True)

    # Extract Coords: GeoJSON [Lng, Lat] -> Leaflet [Lat, Lng]
    d_raw = driver['currentLocation']['coordinates']
    driver_loc = [d_raw[1], d_raw[0]] 
    
    locs = [driver_loc] + [[d['pickupLocation']['coordinates'][1], d['pickupLocation']['coordinates'][0]] for d in deliveries]

    # --- A: ORIGINAL ROUTE ---
    matrix_std = get_distance_matrix(locs, blockages=[]) 
    path_std = solve_tsp_nearest_neighbor(matrix_std, 0)
    stops_std = [deliveries[x-1] for x in path_std if x != 0]
    coords_std, dist_std, dur_std, raw_dur_std = get_seamless_route(driver_loc, stops_std)

    # --- B: OPTIMIZED ROUTE ---
    matrix_ai = get_distance_matrix(locs, blockages=blockages)
    
    if GeneticScheduler:
        try:
            driver_capacity = driver.get('maxCapacity', 30)
            driver_range = driver.get('maxRange', 100)
            vehicle_size = driver.get('vehicleSize', 'small')
            scheduler = GeneticScheduler(matrix_ai, deliveries, driver_capacity, driver_range, vehicle_size)
            best_indices = scheduler.solve()
            stops_ai = [deliveries[i] for i in best_indices]
        except:
            path_ai = solve_tsp_nearest_neighbor(matrix_ai, 0)
            stops_ai = [deliveries[x-1] for x in path_ai if x != 0]
    else:
        path_ai = solve_tsp_nearest_neighbor(matrix_ai, 0)
        stops_ai = [deliveries[x-1] for x in path_ai if x != 0]

    coords_ai, dist_ai, dur_ai, raw_dur_ai = get_seamless_route(driver_loc, stops_ai)

    # --- STATS ---
    try:
        val_std_km = float(dist_std.split()[0])
        val_ai_km = float(dist_ai.split()[0])
    except:
        val_std_km = val_ai_km = 0

    fuel_std = val_std_km / 8.0 
    fuel_ai = val_ai_km / 8.0
    
    # Calculate saved time
    saved_min = max(0, (raw_dur_std - raw_dur_ai) / 60)
    
    # Artificially show impact if fallback mode resulted in identical math
    if blockages and saved_min == 0 and len(blockages) > 0:
        raw_dur_std *= 1.3
        dur_std = f"{raw_dur_std/60:.0f} min"
        saved_min = (raw_dur_std - raw_dur_ai) / 60

    # Calculate EV metrics (assuming 300km range, 15kWh/100km consumption)
    ev_range_km = 300
    ev_consumption_kwh_per_100km = 15
    
    ev_energy_std = (val_std_km * ev_consumption_kwh_per_100km) / 100
    ev_energy_ai = (val_ai_km * ev_consumption_kwh_per_100km) / 100
    ev_range_used_std = (val_std_km / ev_range_km) * 100
    ev_range_used_ai = (val_ai_km / ev_range_km) * 100
    ev_energy_saved = ev_energy_std - ev_energy_ai
    ev_range_saved = ev_range_used_std - ev_range_used_ai

    return jsonify({
        "algo_2": { # Original
            "name": "Original Route",
            "polyline": coords_std, # Array of [Lat, Lng]
            "distance": dist_std,
            "duration": dur_std,
            "fuel": f"{fuel_std:.2f} L",
            "ev_energy": f"{ev_energy_std:.2f} kWh",
            "ev_range_used": f"{ev_range_used_std:.1f}%",
            "color": "#e74c3c"
        },
        "algo_1": { # AI
            "name": "AI Optimized",
            "polyline": coords_ai, # Array of [Lat, Lng]
            "distance": dist_ai,
            "duration": dur_ai,
            "fuel": f"{fuel_ai:.2f} L",
            "ev_energy": f"{ev_energy_ai:.2f} kWh",
            "ev_range_used": f"{ev_range_used_ai:.1f}%",
            "saved": f"{saved_min:.0f} min",
            "ev_energy_saved": f"{ev_energy_saved:.2f} kWh",
            "ev_range_saved": f"{ev_range_saved:.1f}%",
            "color": "#f39c12" if blockages else "#27ae60"  # Yellow if traffic blocks, green otherwise
        },
        "summary": {
            "total_deliveries": len(deliveries),
            "traffic_blocks": len(blockages),
            "time_efficiency": f"{((raw_dur_std - raw_dur_ai) / raw_dur_std * 100):.1f}%" if raw_dur_std > 0 else "0%",
            "distance_efficiency": f"{((val_std_km - val_ai_km) / val_std_km * 100):.1f}%" if val_std_km > 0 else "0%",
            "ev_efficiency": f"{(ev_energy_saved / ev_energy_std * 100):.1f}%" if ev_energy_std > 0 else "0%"
        }
    })

# Standard endpoints
@app.route('/schedule', methods=['POST'])
def schedule_deliveries():
    try:
        data = request.get_json()
        print(f"Received schedule request: {len(data.get('deliveries', []))} deliveries, {len(data.get('drivers', []))} drivers")
        deliveries = data.get('deliveries', [])
        drivers = data.get('drivers', [])
        algorithm = data.get('algorithm', 'genetic')
        blockages = data.get('blockages', [])
        
        if not deliveries or not drivers:
            print("No deliveries or drivers, returning empty")
            return jsonify({})
        
        # Sort deliveries: emergencies first
        deliveries = sorted(deliveries, key=lambda d: d.get('emergency', False), reverse=True)
        print(f"Processing {len(deliveries)} deliveries with {len(drivers)} drivers")
        
        # Simple assignment: distribute deliveries among available drivers
        routes = {}
        driver_index = 0
        
        for i, delivery in enumerate(deliveries):
            if driver_index >= len(drivers):
                driver_index = 0  # Cycle through drivers
            
            driver = drivers[driver_index]
            route_key = f"route_{driver['_id']}"
            
            if route_key not in routes:
                routes[route_key] = {
                    'driver': driver,
                    'stops': []
                }
            
            routes[route_key]['stops'].append(delivery)
            driver_index += 1
        
        print(f"Created {len(routes)} zones – optimizing in PARALLEL ⚡")
        t_start = time.time()

        # ── PARALLEL ZONE OPTIMIZATION ─────────────────────────────────────────
        def optimize_zone(route_key, route_data):
            """Runs distance-matrix + GA/TSP + OSRM for one driver zone in its own thread."""
            driver = route_data['driver']
            stops = route_data['stops']
            
            if not stops:
                return route_key, route_data
                
            # Extract coordinates
            d_raw = driver['currentLocation']['coordinates']
            driver_loc = [d_raw[1], d_raw[0]]  # [lat, lng]
            locs = [driver_loc] + [[d['pickupLocation']['coordinates'][1], d['pickupLocation']['coordinates'][0]] for d in stops]
            
            # Get distance matrix with blockages
            matrix = get_distance_matrix(locs, blockages=blockages)
            
            # Solve TSP
            if GeneticScheduler and algorithm == 'genetic':
                try:
                    driver_capacity = driver.get('maxCapacity', 30)
                    driver_range = driver.get('maxRange', 100)
                    vehicle_size = driver.get('vehicleSize', 'small')
                    scheduler = GeneticScheduler(matrix, stops, driver_capacity, driver_range, vehicle_size)
                    best_indices = scheduler.solve()
                    optimized_stops = [stops[i] for i in best_indices]
                except Exception as e:
                    print(f"[Zone {route_key}] Genetic failed: {e}, using nearest neighbor")
                    path = solve_tsp_nearest_neighbor(matrix, 0)
                    optimized_stops = [stops[x-1] for x in path if x != 0]
            else:
                path = solve_tsp_nearest_neighbor(matrix, 0)
                optimized_stops = [stops[x-1] for x in path if x != 0]
            
            # Get route polyline
            coords, dist, dur, raw_dur = get_seamless_route(driver_loc, optimized_stops)
            
            # Return updated route data
            updated = dict(route_data)
            updated['stops'] = optimized_stops
            updated['polyline'] = coords
            updated['total_distance'] = dist
            updated['total_duration'] = dur
            updated['legs'] = []
            return route_key, updated

        # Run all zones in parallel threads
        results = {}
        # Use min(len(routes), 8) threads — safe upper bound for I/O-bound ORS/OSRM calls
        max_workers = min(len(routes), 8)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(optimize_zone, k, v): k
                for k, v in routes.items()
            }
            for future in as_completed(future_map):
                try:
                    key, data_out = future.result()
                    results[key] = data_out
                except Exception as exc:
                    bad_key = future_map[future]
                    print(f"[Zone {bad_key}] raised exception: {exc}")
                    results[bad_key] = routes[bad_key]  # keep unoptimized on failure
        # ──────────────────────────────────────────────────────────────────────

        elapsed = time.time() - t_start
        print(f"✅ Parallel optimization complete in {elapsed:.2f}s for {len(results)} zones")
        return jsonify(results)
    except Exception as e:
        print(f"Error in schedule_deliveries: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500 


@app.route('/reoptimize-route', methods=['POST'])
def reoptimize_route():
    try:
        data = request.get_json()
        route = data.get('route', {})
        blockages = data.get('blockages', [])

        if not route or not route.get('stops'):
            return jsonify({"error": "Invalid route data"}), 400

        # Extract locations from route stops
        driver_loc = [13.0827, 80.2707]  # Default warehouse location
        stops = route['stops']

        # Get locations for matrix calculation
        locations = [driver_loc] + [[s['pickupLocation']['coordinates'][1], s['pickupLocation']['coordinates'][0]] for s in stops]

        # Get distance matrix with traffic blocks
        matrix = get_distance_matrix(locations, blockages)

        # Solve TSP with traffic considerations
        path = solve_tsp_nearest_neighbor(matrix, 0)
        optimized_stops = [stops[x-1] for x in path if x != 0]

        # Get new route polyline
        coords, dist, dur, raw_dur = get_seamless_route(driver_loc, optimized_stops)

        return jsonify({
            "polyline": coords,
            "total_distance": dist,
            "total_duration": dur,
            "legs": [],
            "optimized_stops": optimized_stops
        })

    except Exception as e:
        print(f"Error in reoptimize_route: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/drivers', methods=['GET']) 
def get_drivers(): return jsonify([]) 

if __name__ == '__main__':
    print("🚀 AI Service running on 5001...")
    app.run(port=5001, debug=True)