// De coordenadas GPS a cuadra del callejero.
//
// El callejero trae un punto por cuadra (sin geometría de calle). Unimos los
// puntos de cuadras consecutivas de una misma calle en una polilínea y medimos
// la distancia del GPS a cada calle: así se distingue en qué calle estás aunque
// el punto más cercano sea el de la transversal. La altura sale de la cuadra de
// esa calle más cercana al GPS.
//
// El reverse geocoding del sistema (Google en Android) se usa sólo para
// desempatar en esquinas: sus nombres no coinciden 1:1 con los del callejero
// ("Boulevard Oroño" vs "Bv. Oroño", "Moreno" vs "MORENO MARIANO").

import type { Block } from './api/types';

export interface Candidate {
  block: Block;
  distance: number; // metros del GPS a la calle
  geocoderMatch: boolean;
}

/** Más allá de esto no estás en una cuadra medida. */
export const MAX_DISTANCE_M = 60;
/**
 * Una cuadra mide ~130 m. El callejero oficial tiene puntos mal cargados (p. ej.
 * Mendoza 1000 está a 9 km de Mendoza 900): no unimos puntos más lejanos que esto.
 */
const MAX_SEGMENT_M = 250;
/** Cuánto pesa que el geocoder coincida con la calle, en metros. */
const GEOCODER_BONUS_M = 20;

interface XY {
  x: number;
  y: number;
}

/** Proyección equirectangular local: alcanza para distancias de cuadras. */
function toXY(lat: number, lng: number, lat0: number): XY {
  return {
    x: lng * 111_320 * Math.cos((lat0 * Math.PI) / 180),
    y: lat * 110_540,
  };
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Minúsculas, sin tildes, sin abreviaturas ni palabras de relleno. */
function nameTokens(name: string): string[] {
  const STOP = new Set([
    'av', 'avenida', 'bv', 'boulevard', 'bulevar', 'pje', 'pasaje', 'calle',
    'pte', 'presidente', 'sgto', 'sargento', 'gral', 'general', 'dr', 'doctor',
    'p', 'poeta', 'de', 'del', 'la', 'el', 'y',
  ]);
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t));
}

/** ¿El nombre del geocoder y el del callejero son la misma calle? */
export function sameStreet(geocoded: string, mapName: string): boolean {
  const a = nameTokens(geocoded);
  const b = nameTokens(mapName);
  if (a.length === 0 || b.length === 0) return false;
  // "Mitre" ⊂ "Bartolomé Mitre", "Moreno" ⊂ "Moreno Mariano", "Rosas" ⊂ "Juan Manuel de Rosas"
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((t) => long.includes(t));
}

/**
 * Cuadras candidatas para la posición, una por calle, de la más probable a la
 * menos. Vacío si no hay ninguna calle medida a menos de MAX_DISTANCE_M.
 */
export function findCandidates(
  blocks: Block[],
  lat: number,
  lng: number,
  geocodedStreet?: string | null,
  limit = 3,
): Candidate[] {
  const p = toXY(lat, lng, lat);

  const byStreet = new Map<string, Block[]>();
  for (const b of blocks) {
    const list = byStreet.get(b.name);
    if (list) list.push(b);
    else byStreet.set(b.name, [b]);
  }

  const out: Candidate[] = [];
  for (const [name, list] of byStreet) {
    // Polilínea por cuadras consecutivas (sin "bis", que son pasajes aparte).
    const main = list.filter((b) => !b.bis).sort((a, b) => a.number - b.number);
    const pts = main.map((b) => toXY(b.lat, b.lng, lat));
    let streetDist = Infinity;
    for (let i = 0; i < main.length; i++) {
      streetDist = Math.min(streetDist, dist(p, pts[i]));
      if (
        i + 1 < main.length &&
        main[i + 1].number - main[i].number === 100 &&
        dist(pts[i], pts[i + 1]) <= MAX_SEGMENT_M
      ) {
        streetDist = Math.min(streetDist, distToSegment(p, pts[i], pts[i + 1]));
      }
    }
    for (const b of list.filter((b) => b.bis)) {
      streetDist = Math.min(streetDist, dist(p, toXY(b.lat, b.lng, lat)));
    }
    if (streetDist > MAX_DISTANCE_M) continue;

    let nearest = list[0];
    let nearestDist = Infinity;
    for (const b of list) {
      const d = dist(p, toXY(b.lat, b.lng, lat));
      if (d < nearestDist) {
        nearest = b;
        nearestDist = d;
      }
    }
    out.push({
      block: nearest,
      distance: streetDist,
      geocoderMatch: !!geocodedStreet && sameStreet(geocodedStreet, name),
    });
  }

  const score = (c: Candidate) => c.distance - (c.geocoderMatch ? GEOCODER_BONUS_M : 0);
  return out.sort((a, b) => score(a) - score(b)).slice(0, limit);
}

export function blockLabel(b: Block): string {
  return `${b.name} al ${b.number}${b.bis ? ' bis' : ''}`;
}

/**
 * Búsqueda manual: "cordoba 1250" → Córdoba al 1200. Sin altura devuelve las
 * cuadras de las calles que coinciden.
 */
export function searchBlocks(blocks: Block[], query: string, limit = 8): Block[] {
  const m = query.trim().match(/^(.*?)\s*(\d+)?$/);
  const namePart = m?.[1] ?? '';
  const qTokens = nameTokens(namePart);
  if (qTokens.length === 0) return [];
  const hundred = m?.[2] ? Math.floor(Number(m[2]) / 100) * 100 : undefined;
  return blocks
    .filter((b) => {
      const tokens = nameTokens(b.name);
      // prefijos, para que "cor" encuentre Córdoba y Corrientes mientras se tipea
      const nameOk = qTokens.every((q) => tokens.some((t) => t.startsWith(q)));
      return nameOk && (hundred === undefined || b.number === hundred);
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.number - b.number || Number(a.bis) - Number(b.bis))
    .slice(0, limit);
}
