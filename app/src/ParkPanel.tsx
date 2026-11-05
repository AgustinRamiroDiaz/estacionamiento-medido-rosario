// Estacionar: detectar la cuadra por GPS (o buscarla a mano), cotizar con el
// server y abrir el estacionamiento post-pago. También lista los abiertos para
// cerrarlos.

import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Slider from '@react-native-community/slider';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import {
  endParking,
  licenseInformation,
  parkingStatus,
  prepay,
  refreshDashboard,
  startParking,
} from './api/gateway';
import { Account, ActiveParking, Block, Config, LicenseInfo, ParkingTicket, StreetMap } from './api/types';
import { cancelAlarm, scheduleAlarm } from './alarms';
import { Candidate, blockLabel, blockSegment, findCandidates, searchBlocks } from './locate';
import { vehicleType } from './plates';
import { getStreetMap, getTariffTableJson } from './streets';
import {
  Quote,
  QuoteInput,
  TariffTable,
  isParkingTime,
  parseTariffTable,
  quoteByAmount,
  quoteByEnd,
  quoteByMinutes,
  quoteFree,
  sliderLimits,
} from './tariff';

const GEOCODE_TIMEOUT_MS = 4000;
/** Con más error que esto avisamos que la cuadra puede estar mal. */
const POOR_ACCURACY_M = 40;
/** Plaza 25 de Mayo: centro del mapa cuando no hay GPS ni cuadra elegida. */
const ROSARIO = { latitude: -32.9468, longitude: -60.6393 };
const ZOOM = { latitudeDelta: 0.004, longitudeDelta: 0.004 };
/** Los mismos bordes que las opciones de abajo. */
const BLOCK_COLOR = '#2a3850';
const SELECTED_COLOR = '#2f6df6';

const pesos = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
/** Hora, y la fecha si no es hoy. */
const when = (d: Date) =>
  (d.toDateString() === new Date().toDateString() ? '' : d.toLocaleDateString('es-AR') + ' ') +
  d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

/** Nombre de calle según el geocoder del sistema, o null si tarda o falla. */
async function geocodedStreet(lat: number, lng: number): Promise<string | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), GEOCODE_TIMEOUT_MS));
  const lookup = Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
    .then((res) => res[0]?.street ?? null)
    .catch(() => null);
  return Promise.race([lookup, timeout]);
}

type LatLng = { latitude: number; longitude: number };

type Step =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'choose'; candidates: Candidate[]; accuracy?: number; here?: LatLng; picked?: LatLng }
  | { kind: 'quote'; block: Block; plate: string; ticket: ParkingTicket }
  | {
      kind: 'prepaid';
      block: Block;
      plate: string;
      table: TariffTable;
      input: QuoteInput;
      info: LicenseInfo;
      free: boolean; // beneficio frentista
      /** El último control que movió el usuario; los otros se derivan de la cotización. */
      by: 'time' | 'amount' | 'end';
      value: number; // minutos, centavos o epoch ms según `by`
    };

export function ParkPanel({
  account,
  config,
  onAccount,
}: {
  account: Account;
  config?: Config;
  onAccount: (a: Account) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [map, setMap] = useState<StreetMap | null>(null);
  const [selected, setSelected] = useState<Block | null>(null);
  const [plate, setPlate] = useState(account.defaultPlate ?? account.vehicles[0]?.plate ?? '');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const loadMap = async () => {
    if (map) return map;
    const m = await getStreetMap(config?.streetMapHash);
    setMap(m);
    return m;
  };

  const locate = async () => {
    setStep({ kind: 'locating' });
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        throw new Error('Sin permiso de ubicación. Buscá la cuadra a mano.');
      }
      const [m, pos] = await Promise.all([
        loadMap(),
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      ]);
      const { latitude, longitude, accuracy } = pos.coords;
      const street = await geocodedStreet(latitude, longitude);
      const candidates = findCandidates(m.blocks, latitude, longitude, street);
      setSelected(candidates[0]?.block ?? null);
      setStep({ kind: 'choose', candidates, accuracy: accuracy ?? undefined, here: { latitude, longitude } });
    } catch (e: any) {
      Alert.alert('No se pudo ubicar', e?.message ?? 'Error');
      setStep({ kind: 'idle' });
    }
  };

  const startManual = async () => {
    try {
      await loadMap();
      setSelected(null);
      setStep({ kind: 'choose', candidates: [] });
    } catch (e: any) {
      Alert.alert('No se pudo bajar el callejero', e?.message ?? 'Error');
    }
  };

  /** Punto tocado en el mapa: reemplaza las cuadras sugeridas por las de ahí. */
  const pick = (p: LatLng) => {
    if (!map || step.kind !== 'choose') return;
    const candidates = findCandidates(map.blocks, p.latitude, p.longitude);
    setSelected(candidates[0]?.block ?? null);
    setStep({ ...step, candidates, picked: p });
  };

  const quote = async () => {
    if (!selected || !plate) return;
    setBusy(true);
    try {
      const ticket = await startParking(plate, selected.id, true);
      setStep({ kind: 'quote', block: selected, plate, ticket });
    } catch (e: any) {
      Alert.alert('No se puede estacionar ahí', e?.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  };

  const startPrepaid = async () => {
    if (!selected || !plate) return;
    setBusy(true);
    try {
      const [json, info] = await Promise.all([
        getTariffTableJson(config?.tariffTableHash),
        licenseInformation(plate, selected.id),
      ]);
      const input: QuoteInput = {
        zone: selected.zone,
        vehicleType: vehicleType(plate) as 0 | 1 | 2,
        homeZone: info.homeZone,
        start: new Date(),
        extendsFrom: info.paidUntil && info.paidUntil > new Date() ? info.paidUntil : undefined,
        paidSince: info.paidSince,
      };
      const table = parseTariffTable(json);
      if (!sliderLimits(table, input)) throw new Error('No se puede pagar por adelantado en esta cuadra.');
      setStep({ kind: 'prepaid', block: selected, plate, table, input, info, free: false, by: 'time', value: 60 });
    } catch (e: any) {
      Alert.alert('No se puede pagar por adelantado', e?.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  };

  const pay = (lic: string, block: Block, quote: Quote, free: boolean) =>
    Alert.alert('Pagar estacionamiento', `¿Confirmás el pago de ${pesos(quote.amount / 100)} hasta las ${when(quote.end)}?`, [
      { text: 'Volver', style: 'cancel' },
      {
        text: 'Pagar',
        onPress: async () => {
          setBusy(true);
          try {
            const ticket = await prepay(lic, block.id, quote.amount, free);
            await scheduleAlarm(lic, ticket.alarm);
            onAccount(await refreshDashboard());
            setStep({ kind: 'idle' });
            Alert.alert('Estacionamiento pagado', `${lic} en ${blockLabel(block)} hasta ${ticket.end ?? when(quote.end)}.`);
          } catch (e: any) {
            Alert.alert('No se pudo pagar', e?.message ?? 'Error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const confirm = async (block: Block, lic: string) => {
    setBusy(true);
    try {
      const ticket = await startParking(lic, block.id, false);
      await scheduleAlarm(lic, ticket.alarm);
      onAccount(await refreshDashboard());
      setStep({ kind: 'idle' });
      Alert.alert('Estacionamiento abierto', `${lic} en ${blockLabel(block)}.`);
    } catch (e: any) {
      Alert.alert('No se pudo abrir el estacionamiento', e?.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  };

  const close = (p: ActiveParking) =>
    Alert.alert('Finalizar estacionamiento', `¿Cerrar el de ${p.ticket.lic ?? 'tu vehículo'}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Finalizar',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await endParking(p.tra);
            if (p.ticket.lic) await cancelAlarm(p.ticket.lic);
            onAccount(await refreshDashboard());
          } catch (e: any) {
            Alert.alert('No se pudo finalizar', e?.message ?? 'Error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  /** Estado al día de los diferidos que se tocaron "Actualizar", por `tra`. */
  const [status, setStatus] = useState<Record<string, ParkingTicket>>({});
  const refreshStatus = async (p: ActiveParking) => {
    setBusy(true);
    try {
      const ticket = await parkingStatus(p.tra);
      setStatus((s) => ({ ...s, [p.tra]: ticket }));
    } catch (e: any) {
      Alert.alert('No se pudo actualizar', e?.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  };

  const results = useMemo(
    () => (map && query.trim() ? searchBlocks(map.blocks, query) : []),
    [map, query],
  );

  return (
    <View>
      {account.activeParkings.map((p) => {
        const t = { ...p.ticket, ...status[p.tra] };
        return (
          <View key={p.tra} style={styles.card}>
            <Text style={styles.cardLabel}>
              {p.postPayment ? 'Estacionamiento diferido' : 'Estacionamiento prepago'}
            </Text>
            <Text style={styles.big}>{t.lic ?? '—'}</Text>
            {p.postPayment && t.sta && (
              <Text style={styles.sub}>Estado: {t.sta === 'Ok' ? 'Abierto' : 'Vencido'}</Text>
            )}
            {t.tar && <Text style={styles.sub}>Tarifa: {t.tar}</Text>}
            {t.amoMax !== undefined && <Text style={styles.sub}>Máximo a cobrar: {pesos(t.amoMax)}</Text>}
            {t.end && <Text style={styles.sub}>{p.postPayment ? 'Vence' : 'Fin'}: {t.end}</Text>}
            {p.postPayment ? (
              <>
                <TouchableOpacity onPress={() => refreshStatus(p)} disabled={busy}>
                  <Text style={styles.link}>🔄  Actualizar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.danger, busy && styles.disabled]}
                  onPress={() => close(p)}
                  disabled={busy}
                >
                  <Text style={styles.buttonText}>Finalizar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.sub}>Los prepagos no se pueden cerrar antes.</Text>
            )}
          </View>
        );
      })}

      {step.kind === 'idle' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Estacionar</Text>
          <TouchableOpacity
            style={[styles.button, account.vehicles.length === 0 && styles.disabled]}
            onPress={locate}
            disabled={account.vehicles.length === 0}
          >
            <Text style={styles.buttonText}>📍  Estacionar acá</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={startManual} disabled={account.vehicles.length === 0}>
            <Text style={styles.link}>Elegir la cuadra a mano</Text>
          </TouchableOpacity>
          {account.vehicles.length === 0 && (
            <Text style={styles.sub}>Agregá un vehículo para estacionar.</Text>
          )}
        </View>
      )}

      {step.kind === 'locating' && (
        <View style={[styles.card, styles.row]}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.sub}>  Buscando tu ubicación…</Text>
        </View>
      )}

      {step.kind === 'choose' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>¿Dónde estacionás?</Text>
          {step.accuracy !== undefined && step.accuracy > POOR_ACCURACY_M && (
            <Text style={styles.warn}>
              GPS impreciso (±{Math.round(step.accuracy)} m): revisá la cuadra.
            </Text>
          )}
          <BlockMap
            here={step.here}
            allBlocks={map?.blocks ?? []}
            blocks={[...step.candidates.map((c) => c.block), ...results]}
            selected={selected}
            onSelect={setSelected}
            picked={step.picked}
            onPick={pick}
          />
          <Text style={styles.hint}>Tocá el mapa para elegir otro lugar.</Text>
          {step.here && (
            <TouchableOpacity onPress={locate}>
              <Text style={styles.link}>🔄  Actualizar ubicación</Text>
            </TouchableOpacity>
          )}
          {step.candidates.length === 0 && (step.accuracy !== undefined || step.picked) && (
            <Text style={styles.warn}>No hay cuadras con estacionamiento medido cerca.</Text>
          )}
          {step.candidates.map((c) => (
            <BlockOption
              key={c.block.id}
              block={c.block}
              detail={`a ${Math.round(c.distance)} m`}
              selected={selected?.id === c.block.id}
              onPress={() => setSelected(c.block)}
            />
          ))}

          <TextInput
            style={styles.input}
            placeholder="Buscar: calle y altura (ej. Córdoba 1250)"
            placeholderTextColor="#889"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
          />
          {results.map((b) => (
            <BlockOption
              key={b.id}
              block={b}
              selected={selected?.id === b.id}
              onPress={() => setSelected(b)}
            />
          ))}

          {account.vehicles.length > 1 && (
            <View style={styles.plates}>
              {account.vehicles.map((v) => (
                <TouchableOpacity
                  key={v.plate}
                  style={[styles.chip, plate === v.plate && styles.chipOn]}
                  onPress={() => setPlate(v.plate)}
                >
                  <Text style={styles.chipText}>{v.plate}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.line}>
            {selected ? `${plate} en ${blockLabel(selected)}` : 'Elegí una cuadra'}
          </Text>
          {busy ? (
            <ActivityIndicator color="#fff" style={styles.spinner} />
          ) : (
            <View style={styles.payRow}>
              <TouchableOpacity
                style={[styles.button, styles.payButton, !selected && styles.disabled]}
                onPress={startPrepaid}
                disabled={!selected}
              >
                <Text style={styles.buttonText}>Adelantado</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.payButton, !selected && styles.disabled]}
                onPress={quote}
                disabled={!selected}
              >
                <Text style={styles.buttonText}>Diferido</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.sub}>
            Diferido: se paga al cerrarlo; si no lo cerrás se cobra el máximo. Adelantado: pagás
            ahora un tiempo fijo.
          </Text>
          <TouchableOpacity onPress={() => setStep({ kind: 'idle' })}>
            <Text style={styles.link}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}

      {step.kind === 'prepaid' && <PrepaidCard step={step} busy={busy} onChange={setStep} onPay={pay} />}

      {step.kind === 'quote' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Confirmá</Text>
          <Text style={styles.big}>{step.plate}</Text>
          <Text style={styles.line}>{blockLabel(step.block)}</Text>
          {step.ticket.tar && <Text style={styles.sub}>Tarifa: {step.ticket.tar}</Text>}
          {step.ticket.amoMax !== undefined && (
            <Text style={styles.sub}>Máximo a cobrar: {pesos(step.ticket.amoMax)}</Text>
          )}
          {step.ticket.timMax && (
            <Text style={styles.sub}>Tiempo máximo: {step.ticket.timMax} hs</Text>
          )}
          {step.ticket.end && <Text style={styles.sub}>Vence: {step.ticket.end}</Text>}
          <Text style={styles.sub}>Se cobra lo usado al finalizar.</Text>
          <TouchableOpacity
            style={[styles.button, busy && styles.disabled]}
            onPress={() => confirm(step.block, step.plate)}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Abrir estacionamiento</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStep({ kind: 'idle' })} disabled={busy}>
            <Text style={styles.link}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

type PrepaidStep = Extract<Step, { kind: 'prepaid' }>;

/**
 * Tiempo, monto y hora de fin a la vez: el slider que se mueve cotiza (con la
 * calculadora de la app oficial) y los otros dos siguen a la cotización.
 */
function PrepaidCard({
  step,
  busy,
  onChange,
  onPay,
}: {
  step: PrepaidStep;
  busy: boolean;
  onChange: (s: PrepaidStep | { kind: 'idle' }) => void;
  onPay: (lic: string, block: Block, quote: Quote, free: boolean) => void;
}) {
  const { table, info, by, value, free } = step;
  // Re-cotiza con la hora actual: el prepago empieza cuando se paga, no cuando se abrió la pantalla.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const input = { ...step.input, start: now };
  const limits = sliderLimits(table, input)!;
  // quoteByEnd no aplica el tiempo máximo (igual que la app oficial): lo topea el slider.
  const maxEnd = Math.min(
    limits.maxEnd.getTime(),
    quoteByMinutes(table, input, limits.maxMinutes)?.end.getTime() ?? limits.maxEnd.getTime(),
  );
  const quote = free
    ? quoteFree(table, input)
    : by === 'time'
      ? quoteByMinutes(table, input, value)
      : by === 'amount'
        ? quoteByAmount(table, input, value)
        : quoteByEnd(table, input, new Date(value));
  const outOfHours = !isParkingTime(table, input);
  const set = (patch: Partial<PrepaidStep>) => onChange({ ...step, ...patch });
  /** Reloj del sistema: la hora elegida es del día de la banda y se acota como el slider. */
  const pickEnd = () =>
    DateTimePickerAndroid.open({
      value: quote?.end ?? limits.minEnd,
      mode: 'time',
      is24Hour: true,
      onChange: (e, d) => {
        if (e.type !== 'set' || !d) return;
        const end = new Date(limits.minEnd);
        end.setHours(d.getHours(), d.getMinutes(), 0, 0);
        set({ by: 'end', value: Math.min(Math.max(end.getTime(), limits.minEnd.getTime()), maxEnd) });
      },
    });
  // El slider que se arrastra muestra lo pedido; los demás, lo cotizado.
  const shown = (k: PrepaidStep['by'], quoted: number) => (by === k && !free ? value : quoted);
  const rows: { k: PrepaidStep['by']; label: string; text: string; min: number; max: number; step: number; v: number }[] =
    quote
      ? [
          {
            k: 'time',
            label: 'Tiempo',
            text: `${Math.floor(quote.minutes / 60)}:${String(Math.round(quote.minutes % 60)).padStart(2, '0')} h`,
            min: 0,
            max: limits.maxMinutes,
            step: 1,
            v: shown('time', quote.minutes),
          },
          {
            k: 'amount',
            label: 'Monto',
            text: pesos(quote.amount / 100),
            min: 0,
            max: limits.maxAmount,
            step: 100,
            v: shown('amount', quote.amount),
          },
          {
            k: 'end',
            label: 'Hora de fin',
            text: when(quote.end),
            min: limits.minEnd.getTime(),
            max: maxEnd,
            step: 60_000,
            v: shown('end', quote.end.getTime()),
          },
        ]
      : [];

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Pago adelantado</Text>
      <Text style={styles.line}>
        {step.plate} en {blockLabel(step.block)}
      </Text>
      {input.extendsFrom && <Text style={styles.sub}>Extiende el prepago que vence {when(input.extendsFrom)}.</Text>}
      {outOfHours && quote && (
        <Text style={styles.warn}>Fuera de horario: el tiempo empieza a contar {when(quote.start)}.</Text>
      )}
      {info.homeZone && info.freeAvailable && (
        <View style={styles.plates}>
          <TouchableOpacity style={[styles.chip, free && styles.chipOn]} onPress={() => set({ free: !free })}>
            <Text style={styles.chipText}>Beneficio frentista</Text>
          </TouchableOpacity>
        </View>
      )}

      {rows.map((r) => (
        <View key={r.k} style={styles.sliderRow}>
          <View style={styles.sliderHead}>
            <Text style={styles.sub}>{r.label}</Text>
            {r.k === 'end' ? (
              <TouchableOpacity onPress={pickEnd} disabled={free || busy} accessibilityLabel="Elegir hora de fin">
                <Text style={[styles.sliderValue, styles.pickable]}>🕒 {r.text}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.sliderValue}>{r.text}</Text>
            )}
          </View>
          <Slider
            minimumValue={r.min}
            maximumValue={r.max}
            step={r.step}
            value={Math.min(Math.max(r.v, r.min), r.max)}
            onValueChange={(v) => set({ by: r.k, value: v })}
            disabled={free || busy}
            minimumTrackTintColor="#2f6df6"
            maximumTrackTintColor="#2a3850"
            thumbTintColor="#fff"
            accessibilityLabel={r.label}
          />
        </View>
      ))}

      {quote ? (
        <Text style={styles.sub}>
          Desde {when(quote.start)}
          {free ? ' · beneficio frentista' : ''}
        </Text>
      ) : (
        <Text style={styles.warn}>No queda tiempo para comprar en esta cuadra.</Text>
      )}

      <TouchableOpacity
        style={[styles.button, (!quote || busy) && styles.disabled]}
        onPress={() => quote && onPay(step.plate, step.block, quote, free)}
        disabled={!quote || busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {quote ? `Pagar ${pesos(quote.amount / 100)}` : 'Pagar estacionamiento'}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onChange({ kind: 'idle' })} disabled={busy}>
        <Text style={styles.link}>Cancelar</Text>
      </TouchableOpacity>
    </View>
  );
}

function BlockMap({
  here,
  allBlocks,
  blocks,
  selected,
  onSelect,
  picked,
  onPick,
}: {
  here?: LatLng;
  allBlocks: Block[];
  picked?: LatLng;
  onPick: (p: LatLng) => void;
  blocks: Block[];
  selected: Block | null;
  onSelect: (b: Block) => void;
}) {
  const ref = useRef<MapView>(null);
  const focus = selected ? { latitude: selected.lat, longitude: selected.lng } : here ?? ROSARIO;
  useEffect(() => {
    ref.current?.animateToRegion({ ...focus, ...ZOOM }, 300);
  }, [focus.latitude, focus.longitude]);

  // Candidatos y resultados de búsqueda pueden repetir cuadra.
  const unique = [...new Map(blocks.map((b) => [b.id, b])).values()];
  return (
    <MapView
      ref={ref}
      style={styles.map}
      initialRegion={{ ...focus, ...ZOOM }}
      showsUserLocation={!!here}
      toolbarEnabled={false}
      onPress={(e) => onPick(e.nativeEvent.coordinate)}
    >
      {/* Circle y no Marker: el pin se come los toques cercanos y no se puede re-elegir al lado. */}
      {picked && (
        <Circle center={picked} radius={12} fillColor="#4ade80" strokeColor="#fff" strokeWidth={3} zIndex={3} />
      )}
      {unique.map((b) => {
        const on = selected?.id === b.id;
        const segment = blockSegment(allBlocks, b);
        // Android no repinta colores sin remontar: la selección va en la key.
        return segment ? (
          <Polyline
            key={`${b.id}-${on}`}
            coordinates={segment}
            strokeColor={on ? SELECTED_COLOR : BLOCK_COLOR}
            strokeWidth={on ? 10 : 7}
            zIndex={on ? 2 : 1}
            tappable
            onPress={() => onSelect(b)}
          />
        ) : (
          <Marker
            key={`${b.id}-${on}`}
            coordinate={{ latitude: b.lat, longitude: b.lng }}
            title={blockLabel(b)}
            pinColor={on ? SELECTED_COLOR : BLOCK_COLOR}
            onPress={() => onSelect(b)}
          />
        );
      })}
    </MapView>
  );
}

function BlockOption({
  block,
  detail,
  selected,
  onPress,
}: {
  block: Block;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.option, selected && styles.optionOn]} onPress={onPress}>
      <Text style={styles.optionText}>{blockLabel(block)}</Text>
      {detail && <Text style={styles.optionDetail}>{detail}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1b2638', borderRadius: 14, padding: 18, marginBottom: 14 },
  map: { height: 220, borderRadius: 10, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  cardLabel: { color: '#8b9bb4', fontSize: 13, textTransform: 'uppercase', marginBottom: 6 },
  big: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: 1 },
  line: { color: '#fff', fontSize: 17, marginTop: 4 },
  sub: { color: '#8b9bb4', fontSize: 14, marginTop: 6 },
  hint: { color: '#8b9bb4', fontSize: 13, marginBottom: 8 },
  warn: { color: '#fbbf24', fontSize: 14, marginBottom: 8 },
  link: { color: '#8b9bb4', fontSize: 15, textAlign: 'center', marginTop: 14 },
  input: {
    backgroundColor: '#0f1724',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 10,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a3850',
    padding: 12,
    marginTop: 8,
  },
  optionOn: { borderColor: '#2f6df6', backgroundColor: '#1e3260' },
  optionText: { color: '#fff', fontSize: 16 },
  optionDetail: { color: '#8b9bb4', fontSize: 13 },
  plates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: { borderRadius: 8, borderWidth: 1, borderColor: '#2a3850', paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: '#4ade80', backgroundColor: '#163a2a' },
  chipText: { color: '#fff', fontWeight: '600', letterSpacing: 1 },
  button: {
    backgroundColor: '#2f6df6',
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  danger: { backgroundColor: '#dc2626' },
  payRow: { flexDirection: 'row', gap: 10 },
  payButton: { flex: 1 },
  spinner: { marginTop: 16 },
  sliderRow: { marginTop: 14 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sliderValue: { color: '#fff', fontSize: 18, fontWeight: '700' },
  pickable: { textDecorationLine: 'underline' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
