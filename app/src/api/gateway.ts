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
import { Account, Config, GatewayError, SigninResult, Vehicle } from './types';

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
    const desc = response.errorDescription ?? response.errorCode ?? code;
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
