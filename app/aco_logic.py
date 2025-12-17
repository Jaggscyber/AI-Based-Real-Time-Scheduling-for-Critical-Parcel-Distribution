import numpy as np
import random

class Graph:
    """
    Represents the graph for the TSP problem.
    It stores the distance matrix and pheromone levels between cities.
    """
    def __init__(self, distance_matrix):
        """
        Args:
            distance_matrix (np.ndarray): A square matrix where matrix[i][j] is the distance
                                          between city i and city j.
        """
        self.matrix = distance_matrix
        self.n_nodes = len(distance_matrix)
        # Initialize pheromone levels with a small constant value on all edges.
        # This prevents division by zero and gives ants an initial path to follow.
        self.pheromone = np.ones((self.n_nodes, self.n_nodes))

class ACO:
    """
    Ant Colony Optimization solver for the Traveling Salesperson Problem.
    """
    def __init__(self, n_ants, n_iterations, alpha, beta, rho, q):
        """
        Args:
            n_ants (int): The number of ants to use in each iteration.
            n_iterations (int): The number of iterations to run the algorithm.
            alpha (float): The importance of the pheromone trail.
            beta (float): The importance of the heuristic information (distance).
            rho (float): The pheromone evaporation rate (0 < rho <= 1).
            q (float): A constant used in pheromone update.
        """
        self.n_ants = n_ants
        self.n_iterations = n_iterations
        self.alpha = alpha
        self.beta = beta
        self.rho = rho
        self.q = q

    def solve(self, graph):
        """
        Runs the ACO simulation to find the best path.

        Args:
            graph (Graph): The graph object containing distance and pheromone info.

        Returns:
            tuple: A tuple containing the best path found and its total cost (distance).
        """
        best_path = None
        best_path_cost = float('inf')

        for _ in range(self.n_iterations):
            all_paths = self._build_paths(graph)
            self._update_pheromone(graph, all_paths)

            # Find the best path in the current iteration
            for path, cost in all_paths:
                if cost < best_path_cost:
                    best_path_cost = cost
                    best_path = path
        
        return best_path, best_path_cost

    def _update_pheromone(self, graph, all_paths):
        """
        Updates the pheromone levels on the graph edges.
        This involves evaporation and depositing new pheromones.
        """
        # Pheromone evaporation
        graph.pheromone *= (1 - self.rho)

        # Deposit new pheromone based on the paths taken by ants
        for path, cost in all_paths:
            if cost == 0: continue # Avoid division by zero for zero-cost paths
            for i in range(graph.n_nodes - 1):
                graph.pheromone[path[i], path[i+1]] += self.q / cost
            # Add pheromone to the edge returning to the start
            graph.pheromone[path[-1], path[0]] += self.q / cost

    def _build_paths(self, graph):
        """
        Manages the path construction for all ants in one iteration.
        """
        all_paths = []
        for _ in range(self.n_ants):
            path = self._build_path(graph)
            cost = self._calculate_path_cost(graph, path)
            all_paths.append((path, cost))
        return all_paths

    def _build_path(self, graph):
        """
        Constructs a single path (tour) for one ant.
        The ant starts at the depot (node 0) and probabilistically chooses the next node.
        """
        path = [0]  # Always start from the depot/driver's location
        visited = {0}
        
        while len(path) < graph.n_nodes:
            current_node = path[-1]
            probabilities = self._calculate_probabilities(graph, current_node, visited)
            
            # If there are no valid next moves, break to avoid errors
            if not probabilities:
                break
                
            next_node = self._select_next_node(probabilities)
            path.append(next_node)
            visited.add(next_node)
        
        # Complete the tour by returning to the start
        if len(path) == graph.n_nodes:
             path.append(path[0])

        return path

    def _calculate_probabilities(self, graph, current_node, visited):
        """
        Calculates the probability of moving from the current node to each unvisited node.
        """
        probabilities = {}
        pheromone = graph.pheromone[current_node]
        
        for node in range(graph.n_nodes):
            if node not in visited:
                # Heuristic is the inverse of distance (shorter is better)
                distance = graph.matrix[current_node][node]
                if distance == 0:
                    heuristic = np.inf # Handle zero distance to prioritize it
                else:
                    heuristic = 1.0 / distance

                # Calculate numerator for the probability formula
                probabilities[node] = (pheromone[node] ** self.alpha) * (heuristic ** self.beta)
        
        return probabilities

    def _select_next_node(self, probabilities):
        """
        Selects the next node based on the calculated probabilities using roulette wheel selection.
        """
        total_prob = sum(probabilities.values())
        if total_prob == 0:
            # If all probabilities are zero, pick a random unvisited node
            # This can happen if pheromones and heuristics are zero.
            return random.choice(list(probabilities.keys()))
        
        selection_point = random.uniform(0, total_prob)
        current_prob = 0
        
        for node, prob in probabilities.items():
            current_prob += prob
            if current_prob >= selection_point:
                return node
        
        # Fallback in case of floating point inaccuracies
        return list(probabilities.keys())[-1]

    def _calculate_path_cost(self, graph, path):
        """
        Calculates the total distance of a given path.
        """
        cost = 0
        for i in range(len(path) - 1):
            cost += graph.matrix[path[i]][path[i+1]]
        return cost
