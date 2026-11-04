// @ts-nocheck: script de node (tipos de node y import .ts), fuera del build de Expo.
// Chequeo de tariff.ts contra la tabla real (docs/samples).
// Correr: cd app && node --experimental-strip-types src/tariff.check.ts
// Los casos salen de leer el TariffCalculator del bundle a mano.

process.env.TZ = 'America/Argentina/Cordoba'; // la tabla y las bandas son hora local

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isParkingTime,
  parseTariffTable,
  quoteByAmount,
  quoteByEnd,
  quoteByMinutes,
  quoteFree,
  sliderLimits,
  type Quote,
  type QuoteInput,
} from './tariff.ts';

const xml = readFileSync(new URL('../../docs/samples/tariffTableUpdate.v11.response.xml', import.meta.url), 'utf8');
const t = parseTariffTable(xml.match(/<tto>([\s\S]*?)<\/tto>/)![1]);

const at = (d: string, hm: string) => new Date(`${d}T${hm}:00.000-03:00`);
const WED = '2026-11-04';
const car = (start: Date, more: Partial<QuoteInput> = {}): QuoteInput => ({
  zone: 0,
  vehicleType: 0,
  homeZone: false,
  start,
  ...more,
});
const hm = (d: Date) => d.toTimeString().slice(0, 8);
function expect(q: Quote | null, amount: number, start: string, end: string, minutes: number) {
  assert.ok(q, 'sin cotización');
  assert.equal(q.amount, amount, 'monto');
  assert.equal(hm(q.start), start, 'inicio');
  assert.equal(hm(q.end), end, 'fin');
  assert.equal(q.minutes, minutes, 'minutos');
}
const cases: [string, () => void][] = [];
const it = (name: string, fn: () => void) => cases.push([name, fn]);

const ten = car(at(WED, '10:00'));

it('azul auto 60 min = tar-1', () => expect(quoteByMinutes(t, ten, 60), 141000, '10:00:00', '11:00:00', 60));
it('120 min = tar-1 + tar-2', () => expect(quoteByMinutes(t, ten, 120), 141000 + 176250, '10:00:00', '12:00:00', 120));
it('180 min = tar-1 + tar-2 + tar-3', () => expect(quoteByMinutes(t, ten, 180), 528750, '10:00:00', '13:00:00', 180));
it('240 min se limita a time-max-reg', () => expect(quoteByMinutes(t, ten, 240), 528750, '10:00:00', '13:00:00', 180));
it('61 min: 2937,5 del nivel 2, HALF_EVEN', () => expect(quoteByMinutes(t, ten, 61), 143938, '10:00:00', '11:01:00', 61));
it('5 min cobra min-tar (35250) y da 15 min', () => expect(quoteByMinutes(t, ten, 5), 35250, '10:00:00', '10:15:00', 15));
it('naranja y verde', () => {
  expect(quoteByMinutes(t, { ...ten, zone: 1 }, 60), 118100, '10:00:00', '11:00:00', 60);
  expect(quoteByMinutes(t, { ...ten, zone: 2 }, 60), 93700, '10:00:00', '11:00:00', 60);
});
it('frentista azul 60 min', () => expect(quoteByMinutes(t, { ...ten, homeZone: true }, 60), 70500, '10:00:00', '11:00:00', 60));
it('moto azul 60 min', () => expect(quoteByMinutes(t, { ...ten, vehicleType: 1 }, 60), 35250, '10:00:00', '11:00:00', 60));
it('volquete con tarifa normal: no permitido', () => assert.equal(quoteByMinutes(t, { ...ten, vehicleType: 2 }, 60), null));
it('moto en Parque España: no permitido', () => assert.equal(quoteByMinutes(t, { ...ten, vehicleType: 1, zone: 3 }, 60), null));

it('monto → tiempo', () => {
  expect(quoteByAmount(t, ten, 141000), 141000, '10:00:00', '11:00:00', 60);
  expect(quoteByAmount(t, ten, 317250), 317250, '10:00:00', '12:00:00', 120);
  expect(quoteByAmount(t, ten, 99_999_999), 528750, '10:00:00', '13:00:00', 180); // tope
  expect(quoteByAmount(t, ten, 100), 35250, '10:00:00', '10:15:00', 15); // mínima
  for (const m of [1, 17, 61, 95, 133, 180]) {
    const q = quoteByAmount(t, ten, quoteByMinutes(t, ten, m)!.amount)!;
    assert.ok(Math.abs(q.minutes - Math.max(m, 15)) < 1 / 60, `ida y vuelta ${m} min → ${q.minutes}`);
  }
});

it('19:30 + 60 min: corta en el fin de banda (20:00), cobra 30 min', () =>
  expect(quoteByMinutes(t, car(at(WED, '19:30')), 60), 70500, '19:30:00', '20:00:00', 30));
it('sábado 11:30 + 60 min: corta a las 12:00', () =>
  expect(quoteByMinutes(t, car(at('2026-11-07', '11:30')), 60), 70500, '11:30:00', '12:00:00', 30));
it('19:55 por monto: la mínima sigue al día siguiente', () => {
  const q = quoteByAmount(t, car(at(WED, '19:55')), 1)!;
  assert.equal(q.amount, 35250);
  assert.equal(q.end.toISOString(), at('2026-11-05', '09:10').toISOString());
  assert.equal(q.minutes, 15);
});
it('antes de hora: arranca a las 9', () => expect(quoteByMinutes(t, car(at(WED, '08:00')), 60), 141000, '09:00:00', '10:00:00', 60));

it('domingo: no se cobra; el lunes 9 es feriado, arranca el martes 10 a las 9:00', () => {
  const sun = car(at('2026-11-08', '10:00'));
  assert.equal(isParkingTime(t, sun), false);
  const q = quoteByMinutes(t, sun, 60)!;
  assert.equal(q.start.toISOString(), at('2026-11-10', '09:00').toISOString());
  assert.equal(q.amount, 141000);
});
it('feriado 2026-11-20 (viernes): no se cobra, próximo es el sábado 21', () => {
  const fer = car(at('2026-11-20', '10:00'));
  assert.equal(isParkingTime(t, fer), false);
  assert.equal(quoteByMinutes(t, fer, 60)!.start.toISOString(), at('2026-11-21', '09:00').toISOString());
});
it('isParkingTime en horario', () => {
  assert.equal(isParkingTime(t, ten), true);
  assert.equal(isParkingTime(t, car(at(WED, '19:59'))), true);
  // El eod es fin + 1 min, pero pasado 19:59:59 la banda ya es la de mañana.
  assert.equal(isParkingTime(t, car(at(WED, '20:00'))), false);
  assert.equal(isParkingTime(t, car(at(WED, '08:59'))), false);
});

it('extensión: sigue en el nivel 2 y respeta el tope', () => {
  const ext = car(at(WED, '10:30'), { paidSince: at(WED, '10:00'), extendsFrom: at(WED, '11:00') });
  expect(quoteByMinutes(t, ext, 60), 176250, '11:00:00', '12:00:00', 60);
  expect(quoteByAmount(t, ext, 176250), 176250, '11:00:00', '12:00:00', 60);
  expect(quoteByAmount(t, ext, 99_999_999), 176250 + 211500, '11:00:00', '13:00:00', 120);
  expect(quoteByAmount(t, ext, 100), 100, '11:00:00', '11:00:02', 2043 / 60000); // sin mínima
});

it('Parque España cruza bandas: 30 min a 3500/h + 30 min a 663/h', () =>
  expect(quoteByMinutes(t, { ...car(at(WED, '20:30')), zone: 3 }, 60), 2082, '20:30:00', '21:30:00', 60));

it('por hora de fin', () => {
  expect(quoteByEnd(t, ten, at(WED, '11:30')), 141000 + 88125, '10:00:00', '11:30:00', 90);
  expect(quoteByEnd(t, car(at(WED, '19:30')), at(WED, '23:00')), 70500, '19:30:00', '20:00:00', 30);
});

it('frentista gratis: 180 min, monto 0', () => {
  expect(quoteFree(t, ten), 0, '10:00:00', '13:00:00', 180);
  expect(quoteFree(t, car(at(WED, '18:00'))), 0, '18:00:00', '20:00:00', 120);
});

it('límites de sliders', () => {
  assert.deepEqual(sliderLimits(t, ten), {
    maxMinutes: 180,
    maxAmount: 528750,
    minEnd: at(WED, '10:00'),
    maxEnd: new Date(at(WED, '20:00').getTime() + 59_000),
  });
  assert.equal(sliderLimits(t, car(at(WED, '19:55')))!.maxAmount, 35250); // cortesía → mínima
  assert.equal(sliderLimits(t, { ...ten, zone: 3 })!.maxMinutes, 1440);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').join('\n     ')}`);
  }
}
console.log(failed ? `${failed} fallaron` : `${cases.length} ok`);
process.exit(failed ? 1 : 0);
