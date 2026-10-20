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
