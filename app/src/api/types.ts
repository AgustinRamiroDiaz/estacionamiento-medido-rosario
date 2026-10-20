// Tipos de las respuestas del gateway de Movil TR.
// Ver ../../docs/api-reference.md y ../../docs/auth-responses.md del repo.

export interface Vehicle {
  plate: string;
  isDefault: boolean;
  notify: boolean;
}

/** Estado de cuenta normalizado para la UI. Montos en pesos. */
export interface Account {
  uid?: string;
  credit: number; // ARS
  available: number; // ARS
  defaultPlate?: string;
  vehicles: Vehicle[];
  hasActiveParking: boolean;
  activeParkings: ActiveParking[];
}

/** Config de pagos / sync devuelta por signin y getConfiguration. */
export interface Config {
  mpPublicKey?: string; // MercadoPago public key (APP_USR-...)
  mpEnabled: boolean;
  mpMode?: string; // 'web' | 'browser'
  macroClickEnabled: boolean;
  streetMapHash?: string;
  tariffTableHash?: string;
  topUpAmountsHash?: string;
}

/** Una cuadra del callejero de zonas medidas (`streetMapUpdate`). */
export interface Block {
  id: string; // lo que va en <str> al estacionar
  name: string; // "Córdoba"
  code: string; // "COR"
  number: number; // altura de la cuadra: 1200 = 1200..1299
  bis: boolean;
  zone: number;
  lat: number;
  lng: number;
}

export interface StreetMap {
  hash: string;
  blocks: Block[];
}

/** `con` de parkVehiculeStartPostPayment / active-parking-status (JSON). */
export interface ParkingTicket {
  lic?: string;
  veh?: string; // "Auto" / "Moto"
  tar?: string; // tarifa, ya formateada por el server
  timMaxHours?: number;
  amoMax?: number; // ARS
  end?: string; // vencimiento, ya formateado
}

/** Un estacionamiento post-pago abierto (`active-parking-status.rec`). */
export interface ActiveParking {
  tra: string; // id de transacción, para cerrarlo
  ticket: ParkingTicket;
}

export interface SigninResult {
  account: Account;
  config: Config;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
