import numpy as np
import random

class GeneticScheduler:
    def __init__(self, distance_matrix, deliveries, driver_capacity, driver_range, vehicle_size='small', n_pop=50, n_gen=100):
        self.matrix = distance_matrix
        self.deliveries = deliveries
        self.capacity = driver_capacity
        self.max_range = driver_range
        self.vehicle_size = vehicle_size
        self.n_pop = n_pop
        self.n_gen = n_gen
        self.n_stops = len(distance_matrix) - 1 
        
        # Speed Assumption: 30km/h = 0.5 km/min
        self.speed_km_per_min = 0.5 

    def fitness(self, route):
        """
        Score = 1 / (Distance + Penalties)
        Penalties: Overload, Dead Battery, Late Arrival
        """
        total_dist_meters = 0
        current_load = 0
        penalty = 0
        current_time_min = 0 

        # 1. Driver -> First Stop
        first_idx = route[0] + 1
        dist_leg = self.matrix[0][first_idx]
        total_dist_meters += dist_leg
        
        travel_time = (dist_leg / 1000.0) / self.speed_km_per_min
        current_time_min += travel_time

        for i in range(len(route)):
            # A. WEIGHT CHECK
            pkg_weight = self.deliveries[route[i]].get('weight', 5) 
            current_load += pkg_weight
            
            # B. SIZE CHECK - Penalty for wrong vehicle-package size match
            pkg_size = self.deliveries[route[i]].get('size', 'small')
            if pkg_size == 'large' and self.vehicle_size != 'large':
                penalty += 5000  # Large packages need large vehicles
            elif pkg_size == 'medium' and self.vehicle_size == 'small':
                penalty += 2000  # Medium packages can't go on small vehicles
            # Small packages can go on any vehicle
            
            # C. AREA CHECK - Penalty for wrong area assignment
            pkg_area = self.deliveries[route[i]].get('area', 'urban')
            # Urban areas prefer faster vehicles, rural areas can use any
            if pkg_area == 'urban' and self.speed_km_per_min < 0.5:  # Urban needs faster vehicles
                penalty += 1500
            
            # D. TIME DEADLINE CHECK
            deadline = self.deliveries[route[i]].get('deadline', 9999)
            if current_time_min > deadline:
                penalty += 5000 # LATE!

            # Move to next stop
            if i < len(route) - 1:
                u = route[i] + 1
                v = route[i+1] + 1
                dist_leg = self.matrix[u][v]
                total_dist_meters += dist_leg
                
                travel_time = (dist_leg / 1000.0) / self.speed_km_per_min
                current_time_min += travel_time

        # C. BATTERY CHECK
        total_dist_km = total_dist_meters / 1000.0
        if total_dist_km > self.max_range:
            penalty += 10000 # BATTERY DEAD!

        # D. CAPACITY CHECK
        if current_load > self.capacity:
            penalty += 10000 # OVERLOADED!

        return 1 / (total_dist_meters + penalty + 1)

    def create_population(self):
        pop = []
        indices = list(range(self.n_stops))
        for _ in range(self.n_pop):
            random.shuffle(indices)
            pop.append(indices[:])
        return pop

    def solve(self):
        # SAFETY CHECK
        if self.n_stops == 0: return []
        if self.n_stops == 1: return [0]

        population = self.create_population()
        
        for gen in range(self.n_gen):
            population = sorted(population, key=self.fitness, reverse=True)
            next_gen = population[:int(self.n_pop * 0.3)]
            
            while len(next_gen) < self.n_pop:
                parent_pool = population[:20]
                parent1 = random.choice(parent_pool) 
                parent2 = random.choice(parent_pool)
                child = self.crossover(parent1, parent2)
                self.mutate(child)
                next_gen.append(child)
            
            population = next_gen

        return sorted(population, key=self.fitness, reverse=True)[0]

    def crossover(self, p1, p2):
        start, end = sorted(random.sample(range(len(p1)), 2))
        child = [-1] * len(p1)
        child[start:end] = p1[start:end]
        fill_pos = end
        for gene in p2:
            if gene not in child:
                if fill_pos >= len(p1): fill_pos = 0
                child[fill_pos] = gene
                fill_pos += 1
        return child

    def mutate(self, route):
        if len(route) < 2: return
        if random.random() < 0.2:
            idx1, idx2 = random.sample(range(len(route)), 2)
            route[idx1], route[idx2] = route[idx2], route[idx1]