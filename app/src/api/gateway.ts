// Cliente del gateway XML de Movil TR (estacionamiento medido de Rosario).
//
// La app nativa le pega directo al backend: no hay CORS (no es un navegador) y
// no hace falta proxy. La sesión se sostiene con una cookie JSESSIONID que
// capturamos y reenviamos. Cada request lleva un `abh` nuevo derivado del UUID
// de instalación (ver antiBounceHash).
//
// Protocolo: POST text/xml a /MParkingGateway/midletGateway con un sobre
//   <Request><ver>..</ver><abh>..</abh><ser>OPERACION</ser>..campos..</Request>
// Respuesta: <Response><error>N</error>..</Response> (N=0 => OK).

import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync } from 'expo-crypto';
import { XMLParser } from 'fast-xml-parser';
import { getAbh } from '../storage';
import { vehicleType } from '../plates';
import {
  Account,
  ActiveParking,
  Block,
  Config,
  GatewayError,
  LicenseInfo,
  ParkingAlarm,
  ParkingTicket,
  SigninResult,
  StreetMap,
  Vehicle,
} from './types';

const BASE_URL = 'https://moviltr.com.ar';
const GATEWAY_PATH = '/MParkingGateway/midletGateway';
const APP_OS = 'RN-android';
const APP_VER = '5.17.0';
const UA = 'okhttp/4.9.2';

// Cookie de sesión en memoria (se setea en signin, se reenvía en el resto).
let sessionCookie: string | null = null;

export function clearSession(): void {
  sessionCookie = null;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // dejamos todo como string; convertimos nosotros
  trimValues: true,
});

function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface CallOpts {
  ver: string;
  fields?: Record<string, string>;
  includeAbh?: boolean; // default true
}

/**
 * Réplica de `generateAntiBounceHash` de la app oficial: MD5(uuid + Date.now())
 * en hex, primeros 16 caracteres, nuevo en cada request. El server rechaza un abh
 * ya usado con error B98 (también en signin).
 */
async function antiBounceHash(): Promise<string> {
  const hex = await digestStringAsync(
    CryptoDigestAlgorithm.MD5,
    (await getAbh()) + Date.now(),
    { encoding: CryptoEncoding.HEX },
  );
  return hex.substring(0, 16);
}

/** Hace una operación del gateway y devuelve el objeto <Response> parseado. */
async function call(ser: string, opts: CallOpts): Promise<Record<string, any>> {
  const { ver, fields = {}, includeAbh = true } = opts;

  let body = `<?xml version="1.0" encoding="utf-8"?>\n<Request><ver>${ver}</ver>`;
  if (includeAbh) {
    body += `<abh>${await antiBounceHash()}</abh>`;
  }
  body += `<ser>${ser}</ser>`;
  for (const [k, v] of Object.entries(fields)) {
    body += `<${k}>${xmlEscape(v)}</${k}>`;
  }
  body += `</Request>`;

  const headers: Record<string, string> = {
    'Content-Type': 'text/xml',
    'User-Agent': UA,
  };
  if (sessionCookie) headers['Cookie'] = sessionCookie;

  let res: Response;
  try {
    res = await fetch(BASE_URL + GATEWAY_PATH, { method: 'POST', headers, body });
  } catch (e: any) {
    throw new GatewayError(`No se pudo conectar: ${e?.message ?? e}`);
  }

  // Capturar JSESSIONID si el server lo manda.
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const m = setCookie.match(/JSESSIONID=[^;]+/);
    if (m) sessionCookie = m[0];
  }

  const text = await res.text();
  if (!res.ok) {
    throw new GatewayError(`HTTP ${res.status}`, String(res.status));
  }

  const parsed = parser.parse(text);
  const response = parsed?.Response;
  if (!response) throw new GatewayError('Respuesta sin <Response>');

  const code = String(response.error ?? '');
  if (code !== '0') {
    // Las operaciones de estacionar mandan el texto en <msg>.
    const desc = response.errorDescription ?? response.msg ?? response.errorCode ?? code;
    throw new GatewayError(`Error del servidor: ${desc}`, code);
  }
  return response;
}

// --- Normalizadores ----------------------------------------------------------

function toArray<T>(v: T | T[] | undefined | ''): T[] {
  if (v === undefined || v === '' || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * El saldo (`balance.credit`/`available`) viene en pesos con decimales: la app
 * oficial lo muestra con `credit.toFixed()` sin escalar. Ojo: los montos de
 * recarga y tarifas sí vienen en centavos.
 */
function toPesos(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseVehicles(vehiclesNode: any): Vehicle[] {
  const list = toArray<any>(vehiclesNode?.vehicle);
  return list.map((v) => ({
    plate: String(v.lic ?? ''),
    isDefault: String(v.def) === 'true',
    notify: String(v.not) === 'true',
  }));
}

/** `con` viene como JSON dentro del tag XML. */
function parseTicket(con: unknown): ParkingTicket {
  let c: any = con;
  if (typeof con === 'string') {
    try {
      c = JSON.parse(con);
    } catch {
      return {};
    }
  }
  if (!c || typeof c !== 'object') return {};
  const num = (v: unknown) => (v == null || v === '' ? undefined : Number(v));
  return {
    lic: c.lic != null ? String(c.lic) : undefined,
    veh: c.veh != null ? String(c.veh) : undefined,
    tar: c.tar != null ? String(c.tar) : undefined,
    timMax: c['tim-max'] != null ? String(c['tim-max']) : undefined,
    amoMax: num(c['amo-max']),
    end: c.end != null ? String(c.end) : undefined,
    sta: c.sta != null ? String(c.sta) : undefined,
  };
}

/** 'DD/MM/YY HH:mm' en hora local, el formato de fechas del server. */
function parseServerDate(v: unknown): Date | undefined {
  const m = String(v ?? '').match(/^(\d{2})\/(\d{2})\/(\d{2,4}) (\d{2}):(\d{2})/);
  if (!m) return undefined;
  const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(year, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
}

/** `ala === 'set'` => el server pide avisar en `alt` con el texto `alm`. */
function parseAlarm(r: Record<string, any>): ParkingAlarm | undefined {
  const at = parseServerDate(r.alt);
  if (String(r.ala) !== 'set' || !at) return undefined;
  return { at, message: String(r.alm ?? 'Tu estacionamiento está por vencer.') };
}

function parseActiveParkings(node: any): ActiveParking[] {
  return toArray<any>(node?.rec)
    .filter((rec) => rec?.tra != null && rec.tra !== '')
    .map((rec) => ({
      tra: String(rec.tra),
      postPayment: rec.cmd === 'closePostPayment',
      ticket: parseTicket(rec.con),
    }));
}

function parseAccount(r: Record<string, any>): Account {
  const activeParking = r['active-parking-status'];
  return {
    uid: r.uid != null ? String(r.uid) : undefined,
    credit: toPesos(r.balance?.credit),
    available: toPesos(r.balance?.available),
    defaultPlate: r['default-car-license']?.lic
      ? String(r['default-car-license'].lic)
      : undefined,
    vehicles: parseVehicles(r.vehicles),
    // vacío ('') => sin ticket; si trae contenido => hay estacionamiento en curso
    hasActiveParking: !!activeParking && activeParking !== '',
    activeParkings: parseActiveParkings(activeParking),
  };
}

function parseConfig(r: Record<string, any>): Config {
  return {
    mpPublicKey: r.mpk ? String(r.mpk) : undefined,
    mpEnabled: String(r.mpe) === 'true',
    mpMode: r.mpc ? String(r.mpc) : undefined,
    macroClickEnabled: String(r.mce) === 'true',
    streetMapHash: r.sth ? String(r.sth) : undefined,
    tariffTableHash: r.tth ? String(r.tth) : undefined,
    topUpAmountsHash: r.tah ? String(r.tah) : undefined,
  };
}

// --- Operaciones públicas ----------------------------------------------------

/** Login. `src` = usuario (número de celular); `pin` = PIN de la cuenta. */
export async function signin(src: string, pin: string): Promise<SigninResult> {
  clearSession();
  const r = await call('signin', {
    ver: '11-RN',
    fields: {
      src,
      pin,
      app: 'user',
      app_os: APP_OS,
      app_ver: APP_VER,
    },
  });
  return { account: parseAccount(r), config: parseConfig(r) };
}

/** Refresco del dashboard (saldo, vehículos, ticket activo). Requiere sesión. */
export async function refreshDashboard(): Promise<Account> {
  const r = await call('refreshDashboard', { ver: '7-RN' });
  return parseAccount(r);
}

/**
 * Marca `lic` como patente por defecto. La app oficial usa `carLicenseRegistration`
 * para esto (no hay otra operación); el server responde con la lista de
 * vehículos ya actualizada.
 */
export async function setDefaultVehicle(lic: string): Promise<Vehicle[]> {
  const r = await call('carLicenseRegistration', {
    ver: '7-RN',
    fields: { lic },
  });
  return parseVehicles(r.vehicles);
}

/** Agrega un vehículo a la cuenta. Responde con la lista actualizada. */
export async function addVehicle(lic: string): Promise<Vehicle[]> {
  const r = await call('addUserVehicle', { ver: '11-RN', fields: { lic } });
  return parseVehicles(r.vehicles);
}

/** Borra un vehículo de la cuenta. Responde con la lista actualizada. */
export async function removeVehicle(lic: string): Promise<Vehicle[]> {
  const r = await call('removeUserVehicle', { ver: '11-RN', fields: { lic } });
  return parseVehicles(r.vehicles);
}

/**
 * Callejero de cuadras con estacionamiento medido. No requiere sesión.
 * `<streets>` trae un array JSON; `lat` es "lat, lng" en un solo string.
 */
export async function streetMapUpdate(): Promise<StreetMap> {
  const r = await call('streetMapUpdate', { ver: '12-RN' });
  const stm = r.stm ?? {};
  let raw: any[] = [];
  try {
    raw = JSON.parse(String(stm.streets ?? '[]'));
  } catch {
    throw new GatewayError('Callejero con formato inesperado');
  }
  const blocks: Block[] = [];
  for (const s of raw) {
    const [lat, lng] = String(s.lat ?? '').split(',').map((x) => Number(x.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    blocks.push({
      id: String(s.id),
      name: String(s.name),
      code: String(s.code ?? ''),
      number: Number(s.number),
      bis: String(s.bis ?? '').toLowerCase() === 'bis',
      zone: Number(s.zone ?? 0),
      lat,
      lng,
    });
  }
  return { hash: String(stm.hash ?? ''), blocks };
}

/**
 * Inicia un estacionamiento post-pago (se cobra al cerrarlo) en la cuadra `str`.
 *
 * `simulate: true` manda `<fak>true</fak>`: el server devuelve el ticket que se
 * abriría (tarifa, máximo, vencimiento) sin abrirlo. La app oficial lo usa así
 * para la pantalla de confirmación y después repite la llamada con `false`.
 */
export async function startParking(
  lic: string,
  str: string,
  simulate: boolean,
): Promise<ParkingTicket> {
  const r = await call('parkVehiculeStartPostPayment', {
    ver: '7-RN',
    fields: {
      fak: String(simulate),
      lic,
      'car-type': String(vehicleType(lic)),
      str,
    },
  });
  return { ...parseTicket(r.con), alarm: parseAlarm(r) };
}

/** Cierra un estacionamiento post-pago (`tra` de active-parking-status). */
export async function endParking(tra: string): Promise<ParkingTicket> {
  const r = await call('parkVehiculeEndPostPayment', { ver: '7-RN', fields: { tra } });
  return parseTicket(r.con);
}

/** Estado actual de un post-pago abierto (lo que muestra la app oficial al tocarlo). */
export async function parkingStatus(tra: string): Promise<ParkingTicket> {
  const r = await call('updateParkPostPaymentVehicule', { ver: '7-RN', fields: { tra } });
  return parseTicket(r.con);
}

/** Tabla de tarifas (JSON de `<tto>`), para calcular prepagos en el cliente. */
export async function tariffTableUpdate(): Promise<{ hash: string; json: string }> {
  const r = await call('tariffTableUpdate', { ver: '11-RN' });
  const t = r.tta?.['tariff-table'];
  if (!t?.tto) throw new GatewayError('Tabla de tarifas con formato inesperado');
  return { hash: String(t.hash ?? ''), json: String(t.tto) };
}

export async function licenseInformation(lic: string, str: string): Promise<LicenseInfo> {
  const r = await call('carLicenseInformation', { ver: '10-RN', fields: { lic, str } });
  const homeStreets = toArray<any>(r.streets?.street).map((s) => String(s['str-num']));
  return {
    homeZone: homeStreets.includes(str),
    freeAvailable: String(r.fpc) === 'true',
    paidUntil: parseServerDate(r['end-last-payment']),
    paidSince: parseServerDate(r['start-first-payment']),
  };
}

/**
 * Prepago: cobra `amo` (centavos, calculado en el cliente con la tabla de
 * tarifas) en el momento. No tiene simulación ni se puede cerrar antes.
 * `free` usa el beneficio frentista.
 *
 * Ojo: viaja en pesos con dos decimales ("352.50", como getAmountInCurrency de
 * la app oficial). Mandado en centavos, el server lo toma como pesos y cobra el
 * máximo permitido.
 */
export async function prepay(
  lic: string,
  str: string,
  amo: number,
  free: boolean,
): Promise<ParkingTicket> {
  const r = await call('parkVehiculePayment', {
    ver: '7-RN',
    fields: {
      fak: 'false',
      lic,
      'car-type': String(vehicleType(lic)),
      amo: `${Math.trunc(amo / 100)}.${String(amo % 100).padStart(2, '0')}`,
      str,
      tcm: free ? 'free' : 'dinamic', // sic, como la app oficial
    },
  });
  return { ...parseTicket(r.con), alarm: parseAlarm(r) };
}
