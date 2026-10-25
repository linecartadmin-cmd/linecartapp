/**
 * Delivery Routing Service Utility
 * 
 * Arranges stops in a road-distance-efficient order using an available routing service (OSRM).
 * If the external routing service is unavailable or times out, falls back gracefully to a
 * road-distance heuristic (Haversine Nearest-Neighbor).
 * 
 * NOTE: As required by safety guidelines, this service does not claim the route is
 * mathematically shortest unless guaranteed by the routing service.
 */

// Haversine formula for spherical distance between two coordinates in meters
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Fallback route arrangement using Nearest-Neighbor heuristic
 */
export function calculateNearestNeighborRoute(stops) {
  if (!stops || stops.length <= 1) {
    return {
      orderedStops: stops || [],
      polyline: (stops || []).filter(s => s.latitude && s.longitude).map(s => [s.latitude, s.longitude]),
      distanceMeters: 0,
      durationSeconds: 0,
      serviceUsed: 'Offline Nearest-Neighbor Heuristic',
      guaranteeShortest: false,
      disclaimer: 'Offline fallback order (road routing service unavailable).'
    };
  }

  // Separate stops with valid coordinates vs without
  const validStops = stops.filter(s => s.latitude && s.longitude && !isNaN(s.latitude) && !isNaN(s.longitude));
  const unmappedStops = stops.filter(s => !s.latitude || !s.longitude || isNaN(s.latitude) || isNaN(s.longitude));

  const unvisited = [...validStops];
  const ordered = [];
  let current = unvisited.shift();
  ordered.push(current);

  let totalDist = 0;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minD = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const d = calculateHaversineDistance(
        current.latitude,
        current.longitude,
        unvisited[i].latitude,
        unvisited[i].longitude
      );
      if (d < minD) {
        minD = d;
        nearestIdx = i;
      }
    }

    totalDist += minD;
    current = unvisited.splice(nearestIdx, 1)[0];
    ordered.push(current);
  }

  // Append unmapped stops at the end
  const finalStops = [...ordered, ...unmappedStops];
  const polyline = ordered.map(s => [s.latitude, s.longitude]);

  return {
    orderedStops: finalStops,
    polyline,
    distanceMeters: Math.round(totalDist),
    durationSeconds: Math.round(totalDist / 8.33), // Approx 30 km/h average city driving speed
    serviceUsed: 'Offline Nearest-Neighbor Heuristic',
    guaranteeShortest: false,
    disclaimer: 'Offline fallback order (road routing service unavailable).'
  };
}

/**
 * Optimize stops using OSRM Road Routing Service with fallback
 */
export async function planRoadDeliveryRoute(stops) {
  if (!stops || stops.length === 0) {
    return {
      orderedStops: [],
      polyline: [],
      distanceMeters: 0,
      durationSeconds: 0,
      serviceUsed: 'None',
      guaranteeShortest: false,
      disclaimer: 'No stops provided.'
    };
  }

  const validStops = stops.filter(s => s.latitude && s.longitude && !isNaN(s.latitude) && !isNaN(s.longitude));
  const unmappedStops = stops.filter(s => !s.latitude || !s.longitude || isNaN(s.latitude) || isNaN(s.longitude));

  if (validStops.length <= 1) {
    return calculateNearestNeighborRoute(stops);
  }

  try {
    // Construct OSRM Trip API request: coords in longitude,latitude order
    // Limit to reasonable stop count for public OSRM API (max ~15-20 stops)
    const coordsStr = validStops
      .map(s => `${parseFloat(s.longitude).toFixed(6)},${parseFloat(s.latitude).toFixed(6)}`)
      .join(';');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const url = `https://router.project-osrm.org/trip/v1/driving/${coordsStr}?source=first&overview=full&geometries=geojson&roundtrip=false`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`OSRM HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.code === 'Ok' && Array.isArray(data.trips) && data.trips.length > 0 && Array.isArray(data.waypoints)) {
      const trip = data.trips[0];
      
      // Order the valid stops based on waypoints order
      // OSRM returns waypoints with `waypoint_index` pointing to the order in the trip
      const sortedWaypoints = [...data.waypoints].sort((a, b) => a.waypoint_index - b.waypoint_index);
      const orderedValid = sortedWaypoints.map(wp => validStops[wp.location_index] || validStops[0]);

      // Extract polyline [lat, lng] from geojson [lng, lat]
      const polyline = (trip.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]);

      return {
        orderedStops: [...orderedValid, ...unmappedStops],
        polyline,
        distanceMeters: Math.round(trip.distance || 0),
        durationSeconds: Math.round(trip.duration || 0),
        serviceUsed: 'OSRM Road Routing Service',
        guaranteeShortest: false,
        disclaimer: 'Route arranged in road-distance-efficient order using routing service.'
      };
    } else {
      throw new Error('OSRM response did not contain valid trip');
    }
  } catch (err) {
    console.warn('[Routing] Public OSRM routing service unavailable, using offline fallback:', err.message);
    return calculateNearestNeighborRoute(stops);
  }
}
