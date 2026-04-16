import { pool } from "../db/client";
import { geocodeAddress, reverseGeocode } from "./maps";

export interface AddTripParams {
  origin: string;
  destination: string;
  startAt: Date;
  endAt?: Date;
  mode?: string;
  notes?: string;
}

export async function addTrip(params: AddTripParams): Promise<string> {
  const originGeo = await geocodeAddress(params.origin);
  const destGeo = await geocodeAddress(params.destination);

  const { rows } = await pool.query(
    `INSERT INTO trip_ref
       (user_id, external_source, origin_name, origin_place_id, origin_lat, origin_lng,
        destination_name, destination_place_id, destination_lat, destination_lng,
        start_at, end_at, mode, notes)
     VALUES ('default', 'manual', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      originGeo?.formatted_address || params.origin,
      originGeo?.place_id || null,
      originGeo?.lat || null,
      originGeo?.lng || null,
      destGeo?.formatted_address || params.destination,
      destGeo?.place_id || null,
      destGeo?.lat || null,
      destGeo?.lng || null,
      params.startAt,
      params.endAt || null,
      params.mode || null,
      params.notes || null,
    ]
  );
  return rows[0].id;
}

interface TakeoutActivitySegment {
  activityType?: string;
  distance?: number;
  startLocation?: { latitudeE7?: number; longitudeE7?: number };
  endLocation?: { latitudeE7?: number; longitudeE7?: number };
  duration?: { startTimestamp?: string; endTimestamp?: string };
}

interface TakeoutTimelineObject {
  activitySegment?: TakeoutActivitySegment;
}

interface TakeoutFile {
  timelineObjects?: TakeoutTimelineObject[];
}

const TRANSIT_ACTIVITY_TYPES = new Set([
  "FLYING",
  "IN_PASSENGER_VEHICLE",
  "IN_VEHICLE",
  "IN_BUS",
  "IN_SUBWAY",
  "IN_TRAIN",
  "IN_TRAM",
  "IN_FERRY",
  "MOTORCYCLING",
  "CYCLING",
  "RUNNING",
  "WALKING",
  "SAILING",
]);

function mapActivityToMode(activityType: string | undefined): string | null {
  if (!activityType) return null;
  const a = activityType.toUpperCase();
  if (a === "FLYING") return "flight";
  if (a.includes("PASSENGER_VEHICLE") || a.includes("VEHICLE"))
    return "drive";
  if (a.includes("TRAIN") || a.includes("SUBWAY") || a.includes("TRAM"))
    return "train";
  if (a.includes("BUS")) return "bus";
  if (a.includes("FERRY") || a.includes("SAIL")) return "ferry";
  if (a.includes("CYCLING")) return "bike";
  if (a.includes("WALKING") || a.includes("RUNNING")) return "walk";
  if (a.includes("MOTORCYCLING")) return "motorcycle";
  return a.toLowerCase();
}

export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
}

export async function importTakeoutTimeline(
  json: TakeoutFile,
  options: { minDistanceMeters?: number; onlyTransit?: boolean } = {}
): Promise<ImportResult> {
  const minDistance = options.minDistanceMeters ?? 5000;
  const onlyTransit = options.onlyTransit ?? true;

  let imported = 0;
  let skipped = 0;
  const total = json.timelineObjects?.length || 0;

  for (const obj of json.timelineObjects || []) {
    const seg = obj.activitySegment;
    if (!seg) {
      skipped++;
      continue;
    }

    if (
      onlyTransit &&
      seg.activityType &&
      !TRANSIT_ACTIVITY_TYPES.has(seg.activityType.toUpperCase())
    ) {
      skipped++;
      continue;
    }

    if (seg.distance !== undefined && seg.distance < minDistance) {
      skipped++;
      continue;
    }

    const startTs = seg.duration?.startTimestamp;
    const endTs = seg.duration?.endTimestamp;
    if (!startTs || !endTs) {
      skipped++;
      continue;
    }

    const startLat =
      seg.startLocation?.latitudeE7 !== undefined
        ? seg.startLocation.latitudeE7 / 1e7
        : null;
    const startLng =
      seg.startLocation?.longitudeE7 !== undefined
        ? seg.startLocation.longitudeE7 / 1e7
        : null;
    const endLat =
      seg.endLocation?.latitudeE7 !== undefined
        ? seg.endLocation.latitudeE7 / 1e7
        : null;
    const endLng =
      seg.endLocation?.longitudeE7 !== undefined
        ? seg.endLocation.longitudeE7 / 1e7
        : null;

    if (
      startLat === null ||
      startLng === null ||
      endLat === null ||
      endLng === null
    ) {
      skipped++;
      continue;
    }

    const externalId = `${startTs}_${endTs}`;
    const mode = mapActivityToMode(seg.activityType);

    await pool.query(
      `INSERT INTO trip_ref
         (user_id, external_source, external_id,
          origin_lat, origin_lng, destination_lat, destination_lng,
          start_at, end_at, mode, distance_meters)
       VALUES ('default', 'takeout', $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (external_source, external_id) DO NOTHING`,
      [
        externalId,
        startLat,
        startLng,
        endLat,
        endLng,
        new Date(startTs),
        new Date(endTs),
        mode,
        seg.distance || null,
      ]
    );
    imported++;
  }

  return { imported, skipped, total };
}

export async function enrichTripWithPlaceNames(tripId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT origin_lat, origin_lng, origin_name,
            destination_lat, destination_lng, destination_name
     FROM trip_ref WHERE id = $1`,
    [tripId]
  );
  if (rows.length === 0) return;
  const trip = rows[0];

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (!trip.origin_name && trip.origin_lat && trip.origin_lng) {
    const geo = await reverseGeocode(trip.origin_lat, trip.origin_lng);
    if (geo) {
      updates.push(`origin_name = $${idx++}`, `origin_place_id = $${idx++}`);
      values.push(geo.formatted_address, geo.place_id);
    }
  }

  if (!trip.destination_name && trip.destination_lat && trip.destination_lng) {
    const geo = await reverseGeocode(trip.destination_lat, trip.destination_lng);
    if (geo) {
      updates.push(
        `destination_name = $${idx++}`,
        `destination_place_id = $${idx++}`
      );
      values.push(geo.formatted_address, geo.place_id);
    }
  }

  if (updates.length === 0) return;

  values.push(tripId);
  await pool.query(
    `UPDATE trip_ref SET ${updates.join(", ")}, updated_at = now() WHERE id = $${idx}`,
    values
  );
}
