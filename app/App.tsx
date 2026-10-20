// Cliente alternativo del estacionamiento medido de Rosario — PoC.
// Login + dashboard reales contra el gateway de moviltr.com.ar.
//
// No persiste credenciales: el PIN se usa sólo para el signin.

import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  addVehicle,
  clearSession,
  refreshDashboard,
  removeVehicle,
  setDefaultVehicle,
  signin,
} from './src/api/gateway';
import { Account, SigninResult, Vehicle } from './src/api/types';
import { ParkPanel } from './src/ParkPanel';
import { MAX_VEHICLES, isValidPlate, normalizePlate } from './src/plates';

const pesos = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [streetMapHash, setStreetMapHash] = useState<string>();
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {account ? (
        <Dashboard
          account={account}
          streetMapHash={streetMapHash}
          onAccount={setAccount}
          onLogout={() => {
            clearSession();
            setAccount(null);
          }}
        />
      ) : (
        <Login
          onLogin={({ account, config }) => {
            setStreetMapHash(config.streetMapHash);
            setAccount(account);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function Login({ onLogin }: { onLogin: (r: SigninResult) => void }) {
  const [src, setSrc] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!src || !pin) {
      Alert.alert('Faltan datos', 'Ingresá usuario y PIN.');
      return;
    }
    setLoading(true);
    try {
      onLogin(await signin(src.trim(), pin));
    } catch (e: any) {
      Alert.alert('No se pudo ingresar', e?.message ?? 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Estacionamiento Rosario</Text>
      <Text style={styles.subtitle}>Cliente alternativo</Text>

      <TextInput
        style={styles.input}
        placeholder="Usuario (celular)"
        placeholderTextColor="#889"
        keyboardType="number-pad"
        autoCapitalize="none"
        value={src}
        onChangeText={setSrc}
      />
      <TextInput
        style={styles.input}
        placeholder="PIN"
        placeholderTextColor="#889"
        secureTextEntry
        value={pin}
        onChangeText={setPin}
      />
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={submit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Ingresar</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function Dashboard({
  account,
  streetMapHash,
  onAccount,
  onLogout,
}: {
  account: Account;
  streetMapHash?: string;
  onAccount: (a: Account) => void;
  onLogout: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      onAccount(await refreshDashboard());
    } catch (e: any) {
      Alert.alert('No se pudo actualizar', e?.message ?? 'Error');
    } finally {
      setRefreshing(false);
    }
  }, [onAccount]);

  const [busyPlate, setBusyPlate] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newPlate, setNewPlate] = useState('');

  /** Corre una operación que devuelve la lista de vehículos y actualiza la cuenta. */
  const mutateVehicles = async (
    plate: string,
    op: (lic: string) => Promise<Vehicle[]>,
    errorTitle: string,
  ): Promise<boolean> => {
    setBusyPlate(plate);
    try {
      const vehicles = await op(plate);
      // Si la respuesta no trae <vehicles>, no pisamos la lista con una vacía.
      if (vehicles.length === 0) {
        onAccount(await refreshDashboard());
        return true;
      }
      const def = vehicles.find((v) => v.isDefault)?.plate;
      onAccount({ ...account, vehicles, defaultPlate: def });
      return true;
    } catch (e: any) {
      Alert.alert(errorTitle, e?.message ?? 'Error');
      return false;
    } finally {
      setBusyPlate(null);
    }
  };

  const makeDefault = (plate: string) =>
    mutateVehicles(plate, setDefaultVehicle, 'No se pudo cambiar la patente');

  const confirmRemove = (plate: string) =>
    Alert.alert('Borrar vehículo', `¿Borrar ${plate} de tu cuenta?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => mutateVehicles(plate, removeVehicle, 'No se pudo borrar el vehículo'),
      },
    ]);

  const submitNewPlate = async () => {
    const plate = normalizePlate(newPlate);
    if (!isValidPlate(plate)) {
      Alert.alert('Patente inválida', 'Formatos válidos: ABC123, AB123CD, 123ABC o A123BCD.');
      return;
    }
    if (account.vehicles.some((v) => v.plate === plate)) {
      Alert.alert('Ya está cargada', `${plate} ya está en tu cuenta.`);
      return;
    }
    setAdding(true);
    const ok = await mutateVehicles(plate, addVehicle, 'No se pudo agregar el vehículo');
    setAdding(false);
    if (ok) setNewPlate('');
  };

  const canAdd = account.vehicles.length < MAX_VEHICLES;

  return (
    <ScrollView
      contentContainerStyle={styles.dashboard}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Mi cuenta</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logout}>Salir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Saldo</Text>
        <Text style={styles.balance}>{pesos(account.credit)}</Text>
        {account.available !== account.credit && (
          <Text style={styles.cardSub}>Disponible: {pesos(account.available)}</Text>
        )}
      </View>

      {/* active-parking-status con contenido que no supimos leer como <rec> */}
      {account.hasActiveParking && account.activeParkings.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Estado</Text>
          <Text style={styles.status}>🅿️  Estacionamiento en curso</Text>
        </View>
      )}

      <ParkPanel account={account} streetMapHash={streetMapHash} onAccount={onAccount} />

      <Text style={styles.section}>Vehículos</Text>
      {account.vehicles.length === 0 && (
        <Text style={styles.cardSub}>No hay vehículos cargados.</Text>
      )}
      {account.vehicles.map((v) => (
        <TouchableOpacity
          key={v.plate}
          style={styles.vehicleRow}
          onPress={() => makeDefault(v.plate)}
          disabled={v.isDefault || busyPlate !== null}
        >
          <Text style={styles.plate}>{v.plate}</Text>
          <View style={styles.badges}>
            {busyPlate === v.plate && <ActivityIndicator color="#fff" size="small" />}
            {v.isDefault && <Text style={styles.badge}>Default</Text>}
            {v.notify && <Text style={styles.badgeAlt}>Notifica</Text>}
            <TouchableOpacity
              onPress={() => confirmRemove(v.plate)}
              disabled={busyPlate !== null}
              hitSlop={10}
              accessibilityLabel={`Borrar ${v.plate}`}
            >
              <Text style={styles.remove}>✕</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      ))}

      {account.vehicles.length > 1 && (
        <Text style={styles.hint}>Tocá una patente para dejarla por defecto</Text>
      )}

      {canAdd ? (
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.addInput]}
            placeholder="Nueva patente"
            placeholderTextColor="#889"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={9}
            value={newPlate}
            onChangeText={setNewPlate}
            onSubmitEditing={submitNewPlate}
            editable={busyPlate === null}
          />
          <TouchableOpacity
            style={[styles.addButton, (busyPlate !== null || !newPlate) && styles.buttonDisabled]}
            onPress={submitNewPlate}
            disabled={busyPlate !== null || !newPlate}
          >
            {adding ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Agregar</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.hint}>Máximo {MAX_VEHICLES} vehículos.</Text>
      )}
      <Text style={styles.hint}>Deslizá para actualizar</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1724' },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' },
  subtitle: { color: '#8b9bb4', fontSize: 15, marginBottom: 28 },
  input: {
    backgroundColor: '#1b2638',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginTop: 12,
  },
  button: {
    backgroundColor: '#2f6df6',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  dashboard: { padding: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  logout: { color: '#8b9bb4', fontSize: 15 },
  card: { backgroundColor: '#1b2638', borderRadius: 14, padding: 18, marginBottom: 14 },
  cardLabel: { color: '#8b9bb4', fontSize: 13, textTransform: 'uppercase' },
  cardSub: { color: '#8b9bb4', fontSize: 14, marginTop: 6 },
  balance: { color: '#4ade80', fontSize: 34, fontWeight: '700', marginTop: 4 },
  status: { color: '#fff', fontSize: 17, marginTop: 6 },
  section: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 8, marginBottom: 10 },
  vehicleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1b2638',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  plate: { color: '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 1 },
  badges: { flexDirection: 'row', gap: 6 },
  badge: {
    color: '#0f1724',
    backgroundColor: '#4ade80',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
    overflow: 'hidden',
  },
  badgeAlt: {
    color: '#fff',
    backgroundColor: '#2f6df6',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
    overflow: 'hidden',
  },
  remove: { color: '#8b9bb4', fontSize: 18, paddingLeft: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  addInput: { flex: 1, marginTop: 0, letterSpacing: 1 },
  addButton: {
    backgroundColor: '#2f6df6',
    borderRadius: 10,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  hint: { color: '#5a6b84', fontSize: 13, textAlign: 'center', marginTop: 20 },
});
