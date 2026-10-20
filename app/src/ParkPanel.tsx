// Estacionar: detectar la cuadra por GPS (o buscarla a mano), cotizar con el
// server y abrir el estacionamiento post-pago. También lista los abiertos para
// cerrarlos.

import * as Location from 'expo-location';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { endParking, refreshDashboard, startParking } from './api/gateway';
import { Account, ActiveParking, Block, ParkingTicket, StreetMap } from './api/types';
import { Candidate, blockLabel, findCandidates, searchBlocks } from './locate';
import { getStreetMap } from './streets';

const GEOCODE_TIMEOUT_MS = 4000;
/** Con más error que esto avisamos que la cuadra puede estar mal. */
const POOR_ACCURACY_M = 40;

const pesos = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

/** Nombre de calle según el geocoder del sistema, o null si tarda o falla. */
async function geocodedStreet(lat: number, lng: number): Promise<string | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), GEOCODE_TIMEOUT_MS));
  const lookup = Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
    .then((res) => res[0]?.street ?? null)
    .catch(() => null);
  return Promise.race([lookup, timeout]);
}

type Step =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'choose'; candidates: Candidate[]; accuracy?: number }
  | { kind: 'quote'; block: Block; plate: string; ticket: ParkingTicket };

export function ParkPanel({
  account,
  streetMapHash,
  onAccount,
}: {
  account: Account;
  streetMapHash?: string;
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
    const m = await getStreetMap(streetMapHash);
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
      setStep({ kind: 'choose', candidates, accuracy: accuracy ?? undefined });
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

  const confirm = async (block: Block, lic: string) => {
    setBusy(true);
    try {
      await startParking(lic, block.id, false);
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
            onAccount(await refreshDashboard());
          } catch (e: any) {
            Alert.alert('No se pudo finalizar', e?.message ?? 'Error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const results = useMemo(
    () => (map && query.trim() ? searchBlocks(map.blocks, query) : []),
    [map, query],
  );

  return (
    <View>
      {account.activeParkings.map((p) => (
        <View key={p.tra} style={styles.card}>
          <Text style={styles.cardLabel}>Estacionamiento en curso</Text>
          <Text style={styles.big}>{p.ticket.lic ?? '—'}</Text>
          {p.ticket.tar && <Text style={styles.sub}>Tarifa: {p.ticket.tar}</Text>}
          {p.ticket.end && <Text style={styles.sub}>Vence: {p.ticket.end}</Text>}
          <TouchableOpacity
            style={[styles.button, styles.danger, busy && styles.disabled]}
            onPress={() => close(p)}
            disabled={busy}
          >
            <Text style={styles.buttonText}>Finalizar</Text>
          </TouchableOpacity>
        </View>
      ))}

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
          {step.candidates.length === 0 && step.accuracy !== undefined && (
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

          <TouchableOpacity
            style={[styles.button, (!selected || busy) && styles.disabled]}
            onPress={quote}
            disabled={!selected || busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {selected ? `Continuar con ${plate} en ${blockLabel(selected)}` : 'Elegí una cuadra'}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStep({ kind: 'idle' })}>
            <Text style={styles.link}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}

      {step.kind === 'quote' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Confirmá</Text>
          <Text style={styles.big}>{step.plate}</Text>
          <Text style={styles.line}>{blockLabel(step.block)}</Text>
          {step.ticket.tar && <Text style={styles.sub}>Tarifa: {step.ticket.tar}</Text>}
          {step.ticket.amoMax !== undefined && (
            <Text style={styles.sub}>Máximo a cobrar: {pesos(step.ticket.amoMax)}</Text>
          )}
          {step.ticket.timMaxHours !== undefined && (
            <Text style={styles.sub}>Tiempo máximo: {step.ticket.timMaxHours} hs</Text>
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
  row: { flexDirection: 'row', alignItems: 'center' },
  cardLabel: { color: '#8b9bb4', fontSize: 13, textTransform: 'uppercase', marginBottom: 6 },
  big: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: 1 },
  line: { color: '#fff', fontSize: 17, marginTop: 4 },
  sub: { color: '#8b9bb4', fontSize: 14, marginTop: 6 },
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
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
