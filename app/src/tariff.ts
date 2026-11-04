// Calculadora de tarifa del estacionamiento prepago.
//
// `parkVehiculePayment` no tiene cotización del servidor: la app oficial calcula
// el monto (centavos) en el cliente con la tabla de tarifas (`tariffTableUpdate`,
// el JSON de <tto>) y el servidor cobra lo que le mandamos. Esto es un port de su
// TariffCalculator (bundle Hermes), limitado a lo que usa PrepaidScreen:
//
//   - slider "Tiempo" / "Indicar hora de fin" → computeParkingTariffbyElapsedTimeWithCourtesy
//   - slider "Monto"                         → computeParkingTariffWithExtensionParking
//   - "Usar beneficio frentista."            → computeParkingTariffFree
//   - límites de los sliders                 → getConfigurationSeekBars
//
// Modelo: cada día tiene una lista de bandas horarias (domingo, hábil, sábado o
// la del feriado). Una banda aplica a un (tipo de tarifa, vehículo) y trae una
// tarifa por zona con tres niveles: la 1ª hora a tar-1, la 2ª a tar-2 y el resto
// a tar-3 (duraciones de `tar-lev-dur`; 0 = sin límite). Los niveles siguen
// contando a través de bandas y, al extender, desde el primer pago.
//
// Se respetan las rarezas del original porque el monto tiene que coincidir:
// fechas en hora local del dispositivo, las bandas terminan en HH:MM:59 y
// conservan los milisegundos de la fecha de referencia (moment.hour().minute()
// .second()), el redondeo es HALF_EVEN con 10 decimales intermedios.

const REGULAR = 0;
const HOME_ZONE = 1;
const ZONE_SPAIN = 3; // zonas: 0 Azul, 1 Naranja, 2 Verde, 3 Parque España
/** Hasta dónde buscar la próxima banda; el original no tiene tope y se cuelga. */
const MAX_DAYS = 400;

/** isPaymentAllowed: [tipo de tarifa][vehículo][zona]. */
const PAYMENT_ALLOWED = [
  [[true, true, true, true], [true, true, true, false], [false, false, false, false]],
  [[true, true, true, false], [true, true, true, false], [false, false, false, false]],
  [[false, false, false, false], [false, false, false, false], [true, true, true, false]],
];

interface Tariff {
  tar: number[]; // centavos por período, niveles 1..3
  per: number[]; // minutos
}

interface Band {
  sh: number;
  sm: number;
  eh: number;
  em: number;
  tarType: number;
  vehType: number;
  zones: (Tariff | null)[];
}

export interface TariffTable {
  maxRegular: number; // minutos
  maxHome: number;
  /** El original no lee `time-max-reg-spa`: queda en su default, 1440. */
  maxRegularSpain: number;
  courtesy: number; // minutos
  levelDur: number[]; // minutos por nivel
  minTariff: number[][][]; // [vehículo][zona][tipo de tarifa], centavos
  weekDays: Band[][]; // índice = Date.getDay()
  specialDays: { date: Date; bands: Band[] }[];
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function parseBands(j: Json): Band[] {
  return (j?.band ?? []).map((b: Json) => ({
    sh: b['start-tim-HH'],
    sm: b['start-tim-MM'],
    eh: b['end-tim-HH'],
    em: b['end-tim-MM'],
    tarType: b['tar-type'],
    vehType: b['veh-type'],
    zones: (b.zone ?? []).map((z: Json) =>
      z['tar-1'] == null
        ? null
        : { tar: [z['tar-1'], z['tar-2'], z['tar-3']], per: [z['per-1'], z['per-2'], z['per-3']] },
    ),
  }));
}

/** deserializeJsonTariffTable + initTariffTable. */
export function parseTariffTable(ttoJson: string): TariffTable {
  const j = JSON.parse(ttoJson);
  const m = j['min-tar'];
  const minTariff: number[][][] = [];
  let k = 0;
  for (let a = 0; a < m['dim-1']; a++) {
    minTariff.push([]);
    for (let b = 0; b < m['dim-2']; b++) {
      minTariff[a].push([]);
      for (let c = 0; c < m['dim-3']; c++) minTariff[a][b].push(m.rec[k++]);
    }
  }
  const labor = parseBands(j['band-labor']);
  const specialDays: TariffTable['specialDays'] = [];
  const days = j['special-days']?.day;
  for (const d of Array.isArray(days) ? days : days ? [days] : []) {
    const date = new Date(d.date);
    if (!specialDays.some((s) => sameDay(s.date, date))) specialDays.push({ date, bands: parseBands(d.bands) });
  }
  return {
    maxRegular: j['time-max-reg'],
    maxHome: j['time-max-hom'],
    maxRegularSpain: 1440,
    courtesy: j['cou-time'],
    levelDur: j['tar-lev-dur'].rec.slice(0, j['tar-lev-dur']['dim-1']),
    minTariff,
    weekDays: [parseBands(j['band-sunday']), labor, labor, labor, labor, labor, parseBands(j['band-saturday'])],
    specialDays,
  };
}

// --- Fechas -----------------------------------------------------------------

function sameDay(a: Date, b: Date): boolean {
  return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
}

/** moment(d).hour(h).minute(m).second(s): conserva los milisegundos de d. */
function at(d: Date, h: number, m: number, s: number): Date {
  const r = new Date(d);
  r.setHours(h, m, s);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

// --- Bandas con fecha -------------------------------------------------------

interface DateBand {
  band: Band;
  ref: Date; // desde dónde se cobra en esta banda
  start: Date;
  end: Date; // HH:MM:59
}

function dateBand(band: Band, ref: Date): DateBand {
  return { band, ref, start: at(ref, band.sh, band.sm, 0), end: at(ref, band.eh, band.em, 59) };
}

const sameBand = (a: DateBand, b: DateBand) =>
  a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();

/** Elapsed de la banda desde ref hasta el fin, que es inclusivo (+1 s). */
const restOfBand = (db: DateBand) => db.end.getTime() - db.ref.getTime() + 1000;

interface Key {
  tarType: number;
  vehType: number;
  zone: number;
}

/** Bandas del día que aplican; null si es feriado sin bandas (isDayOff). */
function bandsOfDay(t: TariffTable, d: Date, k: Key, skipDayOff: boolean): Band[] | null {
  const special = t.specialDays.find((s) => sameDay(s.date, d));
  if (special && skipDayOff && special.bands.length === 0) return null;
  return (special ? special.bands : t.weekDays[d.getDay()]).filter(
    (b) => b.tarType === k.tarType && b.vehType === k.vehType && b.zones[k.zone] != null,
  );
}

/** _getNextParkingDateBand: la banda que contiene `date` o la próxima que empieza. */
function nextParkingDateBand(t: TariffTable, date: Date, k: Key): DateBand {
  for (let i = 0; i < MAX_DAYS; i++) {
    const d = addDays(date, i);
    for (const b of bandsOfDay(t, d, k, true) ?? []) {
      const start = at(d, b.sh, b.sm, 0);
      if (date >= start && date <= at(d, b.eh, b.em, 59)) return dateBand(b, d);
      if (date < start) return dateBand(b, start);
    }
  }
  throw new Error('sin bandas para esta tarifa');
}

/** _getNextDateBand: la banda siguiente a `last` (mismo día o días siguientes). */
function nextDateBand(t: TariffTable, last: DateBand, k: Key): DateBand {
  const today = bandsOfDay(t, last.ref, k, false) ?? [];
  const i = today.indexOf(last.band);
  if (i >= 0 && i + 1 < today.length) return dateBand(today[i + 1], at(last.ref, today[i + 1].sh, today[i + 1].sm, 0));
  for (let n = 1; n < MAX_DAYS; n++) {
    const d = addDays(last.ref, n);
    const b = bandsOfDay(t, d, k, true)?.[0];
    if (b) return dateBand(b, at(d, b.sh, b.sm, 0));
  }
  throw new Error('sin bandas para esta tarifa');
}

// --- Aritmética (Big decimal del original, en enteros de 1e-10 centavos) -----

const SCALE = 10n ** 10n;

/** n / d redondeado HALF_EVEN, d > 0. */
function divHalfEven(n: bigint, d: bigint): bigint {
  let q = n / d;
  let r = n % d;
  if (r < 0n) {
    q -= 1n;
    r += d;
  }
  if (2n * r > d || (2n * r === d && (q & 1n) === 1n)) q += 1n;
  return q;
}

/** tarifa * ms / período / 60000, con 10 decimales en cada división. */
function cost(tf: Tariff, level: number, ms: number): bigint {
  const x = divHalfEven(BigInt(tf.tar[level]) * BigInt(ms) * SCALE, BigInt(tf.per[level]));
  return divHalfEven(x, 60000n);
}

/** ms que compra `amount` (escalado) en ese nivel, redondeado a ms. */
function msFor(tf: Tariff, level: number, amount: bigint): number {
  const x = divHalfEven(amount * BigInt(tf.per[level]) * 60000n, BigInt(tf.tar[level]));
  return Number(divHalfEven(x, SCALE));
}

// --- Calculadora ------------------------------------------------------------

class Calc {
  t: TariffTable;
  k: Key;
  f1 = new Date(0); // getNextParkingDate: inicio efectivo
  f2 = new Date(0);
  f3 = new Date(0); // getParkingExpirationDate
  bands: DateBand[] = [];
  charged = 0; // ms
  amount = 0; // centavos

  constructor(t: TariffTable, k: Key) {
    this.t = t;
    this.k = k;
  }

  /** Recorta una expiración que cae justo al inicio de otra banda al fin de la anterior. */
  private trimToBandEnd(s: DateBand, e: DateBand) {
    if (e.start.getTime() === this.f3.getTime() && !sameBand(s, e))
      this.f3 = plus(this.bands[Math.max(this.bands.length - 2, 0)].end, 1000);
  }

  /** _computeParkingExpirationDateByParkingTime */
  byTime(date: Date, seconds: number) {
    const s = nextParkingDateBand(this.t, date, this.k);
    this.f1 = s.ref;
    this.f2 = plus(this.f1, seconds * 1000);
    // No cruza la medianoche: corta en el fin de la banda de inicio.
    if (this.f1.getDate() !== this.f2.getDate()) this.f2 = plus(s.end, 1000);
    const e = nextParkingDateBand(this.t, this.f2, this.k);
    this.f3 = e.ref;
    this.bands = [s];
    if (!sameBand(s, e)) {
      let d = s;
      do this.bands.push((d = nextDateBand(this.t, d, this.k)));
      while (!sameBand(d, e));
    }
    this.trimToBandEnd(s, e);
  }

  /** _computeDateBandParkingAmountWithElapsedTime: monto de `elapsed` ms en la banda. */
  private bandAmount(db: DateBand, elapsed: number, prev: number): bigint {
    const tf = db.band.zones[this.k.zone]!;
    let pos = this.charged + prev;
    let rem = elapsed;
    let levelEnd = 0;
    let acc = 0n;
    for (let i = 0; i < 3; i++) {
      const dur = this.t.levelDur[i] * 60000;
      levelEnd += dur;
      // El último nivel se lleva todo lo que quede; dur 0 = sin límite.
      const take = pos <= levelEnd || i === 2 ? (dur !== 0 ? Math.min(levelEnd - pos, rem) : rem) : 0;
      acc += cost(tf, i, take);
      pos += take;
      rem -= take;
      if (rem <= 0) break;
    }
    return acc;
  }

  /** _computeParkingAmount sobre las bandas que dejó byTime. */
  computeAmount(prev: number) {
    this.charged = 0;
    let acc = 0n;
    const last = this.bands.length - 1;
    this.bands.forEach((db, i) => {
      let el: number;
      if (i < last) el = restOfBand(db);
      else if (this.f2 >= db.start && this.f2 <= db.end)
        el = this.f2.getTime() - (i === 0 ? this.f1 : db.start).getTime();
      else el = i === 0 ? restOfBand(db) : 0;
      acc += this.bandAmount(db, el, prev);
      this.charged += el;
    });
    this.amount = Number(divHalfEven(acc, SCALE));
  }

  /** _getDateBandExpirationDate: hasta dónde alcanza `rem` dentro de la banda. */
  private expirationInBand(db: DateBand, rem: bigint, prev: number): Date {
    const tf = db.band.zones[this.k.zone]!;
    let pos = this.charged + prev;
    let levelEnd = 0;
    let ms = 0;
    for (let i = 0; i < 3; i++) {
      const dur = this.t.levelDur[i] * 60000;
      const affordable = msFor(tf, i, rem);
      levelEnd += dur;
      const take = pos <= levelEnd || i === 2 ? (dur !== 0 ? Math.min(levelEnd - pos, affordable) : affordable) : 0;
      pos += take;
      rem -= cost(tf, i, take);
      ms += take;
      if (rem <= 0n) break;
    }
    return plus(db.ref, ms);
  }

  /** _computeParkingExpirationDateByParkingAmount (no toca this.amount). */
  byAmount(date: Date, amount: number, prev: number) {
    const s = nextParkingDateBand(this.t, date, this.k);
    this.f1 = s.ref;
    this.charged = 0;
    this.bands = [s];
    let rem = BigInt(amount) * SCALE;
    let db = s;
    for (;;) {
      const full = this.bandAmount(db, restOfBand(db), prev);
      if (full > rem) break;
      rem -= full;
      this.charged += restOfBand(db);
      this.bands.push((db = nextDateBand(this.t, db, this.k)));
    }
    this.f2 = this.f3 = this.expirationInBand(db, rem, prev);
    this.trimToBandEnd(s, db);
    if (db === s) this.charged += this.f2.getTime() - this.f1.getTime();
    else this.charged += this.f2.getTime() - db.start.getTime();
  }
}

// --- API --------------------------------------------------------------------

export interface QuoteInput {
  zone: number; // Block.zone tal cual: es el índice de zona de la tabla
  vehicleType: 0 | 1 | 2; // auto, moto, volquete
  homeZone: boolean; // tarifa frentista
  start: Date; // ahora
  /** Fin del período ya pago de la patente (licenseInfo end-last-payment), si hay. */
  extendsFrom?: Date;
  /**
   * Inicio del primer pago de ese período (start-first-payment). Hace falta para
   * seguir la escala de niveles y el tope de tiempo; sin él se cotiza como nuevo.
   */
  paidSince?: Date;
}

export interface Quote {
  amount: number; // centavos
  start: Date; // desde cuándo cobra (puede ser la próxima banda si ahora no se cobra)
  end: Date; // vencimiento
  minutes: number; // tiempo cobrado
}

interface Ctx {
  c: Calc;
  base: Date; // desde dónde se compra
  since: Date;
  prev: number; // ms ya pagos
  isExt: boolean;
  maxTime: number; // minutos
  minTariff: number;
}

function context(t: TariffTable, i: QuoteInput, tarType: number): Ctx | null {
  const k = { tarType, vehType: i.vehicleType, zone: i.zone };
  if (!PAYMENT_ALLOWED[tarType]?.[k.vehType]?.[k.zone]) return null;
  const base = i.extendsFrom ?? i.start;
  const since = i.extendsFrom ? (i.paidSince ?? i.extendsFrom) : i.start;
  const prev = base.getTime() - since.getTime();
  const maxTime =
    tarType === REGULAR && k.zone === ZONE_SPAIN ? t.maxRegularSpain : tarType === REGULAR ? t.maxRegular : t.maxHome;
  return { c: new Calc(t, k), base, since, prev, isExt: prev !== 0, maxTime, minTariff: t.minTariff[k.vehType][k.zone][tarType] };
}

const quoteOf = (c: Calc): Quote => ({ amount: c.amount, start: c.f1, end: c.f3, minutes: c.charged / 60000 });

/** Corre `fn` y devuelve null si la tarifa no aplica o la tabla no tiene bandas. */
function run<T>(t: TariffTable, i: QuoteInput, tarType: number, fn: (x: Ctx) => T | null): T | null {
  const x = context(t, i, tarType);
  if (!x) return null;
  try {
    return fn(x);
  } catch {
    return null;
  }
}

const tarTypeOf = (i: QuoteInput) => (i.homeZone ? HOME_ZONE : REGULAR);

/** computeParkingTariffWithExtensionParking(since, base, amount). */
function byAmount(x: Ctx, amount: number): Quote | null {
  const { c } = x;
  const allowed = Math.max(x.maxTime * 60 - x.prev / 1000, 0);
  c.byTime(x.base, allowed);
  c.computeAmount(x.prev); // c.amount = máximo comprable
  if (allowed === 0) return null;
  // Una extensión no puede pasar al día siguiente.
  if (x.isExt && x.since.getDate() !== c.f1.getDate()) return null;
  if (!x.isExt && (c.amount < x.minTariff || amount < x.minTariff)) {
    c.amount = x.minTariff;
    c.byAmount(x.base, c.amount, x.prev);
  } else if (amount < c.amount) {
    c.amount = amount;
    c.byAmount(x.base, amount, x.prev);
  }
  return quoteOf(c);
}

/** computeParkingTariffbyElapsedTimeWithCourtesy con courtesy = false (como el prepago). */
function byTime(x: Ctx, seconds: number): Quote | null {
  x.c.byTime(x.base, seconds);
  x.c.computeAmount(x.prev);
  // Menos que la tarifa mínima: se cobra la mínima y se da el tiempo que compra.
  if (!x.isExt && x.c.amount < x.minTariff) return byAmount({ ...x, since: x.base, prev: 0 }, x.minTariff);
  return quoteOf(x.c);
}

/**
 * Slider "Tiempo". Se limita a [0, tiempo máximo] como el slider; en una
 * extensión el original no descuenta lo ya pago (sí lo hace quoteByAmount).
 */
export function quoteByMinutes(t: TariffTable, i: QuoteInput, minutes: number): Quote | null {
  return run(t, i, tarTypeOf(i), (x) => byTime(x, Math.round(Math.min(Math.max(minutes, 0), x.maxTime) * 60)));
}

/** Slider "Monto": el monto se ajusta a [tarifa mínima, máximo comprable]. */
export function quoteByAmount(t: TariffTable, i: QuoteInput, amount: number): Quote | null {
  return run(t, i, tarTypeOf(i), (x) => byAmount(x, Math.round(amount)));
}

/**
 * "Indicar hora de fin": la hora se limita a [inicio, fin de banda + 1 min] y se
 * cotiza por tiempo. Como en el original, acá no se aplica el tiempo máximo.
 */
export function quoteByEnd(t: TariffTable, i: QuoteInput, end: Date): Quote | null {
  return run(t, i, tarTypeOf(i), (x) => {
    const db = nextParkingDateBand(t, x.base, x.c.k);
    const e = Math.min(Math.max(end.getTime(), db.ref.getTime()), db.end.getTime() + 60000);
    return byTime(x, Math.round((e - db.ref.getTime()) / 1000));
  });
}

/** Beneficio frentista: el tiempo máximo con tarifa HOME_ZONE, monto 0. */
export function quoteFree(t: TariffTable, i: QuoteInput): Quote | null {
  return run(t, i, HOME_ZONE, (x) => {
    x.c.byTime(x.base, x.maxTime * 60);
    x.c.computeAmount(0);
    x.c.amount = 0;
    return quoteOf(x.c);
  });
}

export interface SliderLimits {
  maxMinutes: number; // slider "Tiempo": 0..max, paso 1 min
  maxAmount: number; // slider "Monto": 0..max centavos, paso 1
  minEnd: Date; // "Indicar hora de fin": desde
  maxEnd: Date; // hasta (fin de banda + 1 min)
}

/** getConfigurationSeekBars. */
export function sliderLimits(t: TariffTable, i: QuoteInput): SliderLimits | null {
  return run(t, i, tarTypeOf(i), (x) => {
    const { c } = x;
    c.byTime(x.base, x.maxTime * 60);
    c.computeAmount(x.prev);
    // Cortesía (cou-time): si lo que queda de banda es menos, el máximo es 0... y
    // después pasa a la mínima. Sin extensión el máximo nunca baja de la mínima.
    let max = !x.isExt && c.charged < t.courtesy * 60000 ? 0 : c.amount;
    if (!x.isExt && max < x.minTariff) max = x.minTariff;
    const db = nextParkingDateBand(t, x.base, c.k);
    return { maxMinutes: x.maxTime, maxAmount: max, minEnd: db.ref, maxEnd: plus(db.end, 60000) };
  });
}

/** ¿Se cobra ahora? (entre el inicio de la banda y su fin + 1 min). */
export function isParkingTime(t: TariffTable, i: QuoteInput): boolean {
  return (
    run(t, i, tarTypeOf(i), (x) => {
      const db = nextParkingDateBand(t, i.start, x.c.k);
      return i.start >= db.start && i.start.getTime() <= db.end.getTime() + 60000;
    }) ?? false
  );
}
