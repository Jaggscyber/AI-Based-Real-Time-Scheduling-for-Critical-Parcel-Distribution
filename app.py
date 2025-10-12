import os
from dotenv import load_dotenv  # Import the library
import googlemaps
from flask import Flask, request, jsonify
from flask_cors import CORS
from sklearn.cluster import KMeans
import numpy as np

# --- THIS IS THE FIX ---
# Load environment variables from the .env file in the same directory
load_dotenv()

app = Flask(__name__)
CORS(app)

# Securely get the API key from the environment variables
API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY")
if not API_KEY:
    raise ValueError("No GOOGLE_MAPS_API_KEY set. Please check your .env file.")

# Initialize the client with a timeout
gmaps = googlemaps.Client(key=API_KEY, timeout=10)


def solve_tsp_for_batch_with_gmaps(start_location, batch_deliveries):
    """
    Solves the Traveling Salesperson Problem using Google's optimization.
    Returns the optimized tour, polyline, total distance, total duration, and legs.
    """
    if not batch_deliveries:
        return [], "", "N/A", "N/A", []

    # The waypoints are the delivery locations
    waypoints = [(d['pickupLocation']['coordinates'][1], d['pickupLocation']['coordinates'][0]) for d in batch_deliveries]
    
    try:
        # The API call now starts from the 'start_location' (the warehouse or driver's position)
        directions_result = gmaps.directions(start_location,
                                             start_location, # The route should end back at the start
                                             waypoints=waypoints,
                                             optimize_waypoints=True,
                                             mode="driving")

        if not directions_result:
            return batch_deliveries, "", "N/A", "N/A", []

        result = directions_result[0]
        optimized_order = result['waypoint_order']
        optimized_tour = [batch_deliveries[i] for i in optimized_order]
        polyline_str = result['overview_polyline']['points']

        # Extract total distance, duration, and leg details
        total_distance = sum(leg['distance']['value'] for leg in result['legs'])
        total_duration = sum(leg['duration']['value'] for leg in result['legs'])
        
        # Convert to readable format
        total_distance_text = f"{total_distance / 1000:.1f} km"
        total_duration_text = f"{total_duration // 3600}h {(total_duration % 3600) // 60}m"

        legs_details = [{
            'distance': leg['distance']['text'],
            'duration': leg['duration']['text']
        } for leg in result['legs']]

        return optimized_tour, polyline_str, total_distance_text, total_duration_text, legs_details

    except googlemaps.exceptions.ApiError as e:
        print(f"Google Maps API Error: {e}")
        return batch_deliveries, "", "N/A", "N/A", []
    except (IndexError, KeyError) as e:
        print(f"Error parsing Google Maps response: {e}")
        return batch_deliveries, "", "N/A", "N/A", []
    except googlemaps.exceptions.Timeout:
        print("Google Maps API request timed out.")
        return [], "", "N/A", "N/A", []


@app.route('/schedule', methods=['POST'])
def schedule_deliveries():
    data = request.get_json()
    deliveries = data.get('deliveries', [])
    drivers = data.get('drivers', [])
    start_location_coords = data.get('start_location') # Expecting [lng, lat]

    if not deliveries or not drivers or not start_location_coords:
        return jsonify({})

    # The single starting point for all routes (the warehouse)
    start_location = (start_location_coords[1], start_location_coords[0]) # Convert to (lat, lng)

    delivery_locations = np.array([[d['pickupLocation']['coordinates'][1], d['pickupLocation']['coordinates'][0]] for d in deliveries])
    num_clusters = min(len(drivers), len(deliveries))
    if num_clusters == 0: return jsonify({})

    kmeans = KMeans(n_clusters=num_clusters, random_state=42, n_init=10)
    kmeans.fit(delivery_locations)
    
    clusters = [[] for _ in range(num_clusters)]
    for i, delivery in enumerate(deliveries):
        clusters[kmeans.labels_[i]].append(delivery)

    final_routes = {}
    available_drivers = list(drivers) # Create a mutable copy

    for cluster_batch in clusters:
        if not cluster_batch or not available_drivers: continue
        
        batch_size = sum(d.get('size', 1) for d in cluster_batch)
        eligible_drivers = [d for d in available_drivers if d.get('vehicleCapacity', 0) >= batch_size]
        
        if not eligible_drivers:
            print(f"No eligible drivers for batch size {batch_size}. Skipping.")
            continue

        # In this model, all drivers start at the same location.
        # We can simply assign the first eligible driver.
        assigned_driver = eligible_drivers[0]
        
        available_drivers = [d for d in available_drivers if d['_id'] != assigned_driver['_id']]
        
        # Solve TSP for the batch starting from the warehouse
        optimized_tour, polyline_str, total_dist, total_dur, legs = solve_tsp_for_batch_with_gmaps(start_location, cluster_batch)
        
        if optimized_tour:
            final_routes[assigned_driver['_id']] = {
                'driver': assigned_driver,
                'stops': optimized_tour,
                'polyline': polyline_str,
                'total_distance': total_dist,
                'total_duration': total_dur,
                'legs': legs
            }

    return jsonify(final_routes)

if __name__ == '__main__':
    app.run(port=5000, debug=True)

