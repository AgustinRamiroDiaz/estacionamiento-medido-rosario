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
import { refreshDashboard, signin, clearSession } from './src/api/gateway';
import { Account } from './src/api/types';

const pesos = (n: number) =>
  n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {account ? (
        <Dashboard
          account={account}
          onAccount={setAccount}
          onLogout={() => {
            clearSession();
            setAccount(null);
          }}
        />
      ) : (
        <Login onLogin={setAccount} />
      )}
    </SafeAreaView>
  );
}

function Login({ onLogin }: { onLogin: (a: Account) => void }) {
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
      const { account } = await signin(src.trim(), pin);
      onLogin(account);
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
  onAccount,
  onLogout,
}: {
  account: Account;
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

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Estado</Text>
        <Text style={styles.status}>
          {account.hasActiveParking
            ? '🅿️  Estacionamiento en curso'
            : 'Sin estacionamiento activo'}
        </Text>
      </View>

      <Text style={styles.section}>Vehículos</Text>
      {account.vehicles.length === 0 && (
        <Text style={styles.cardSub}>No hay vehículos cargados.</Text>
      )}
      {account.vehicles.map((v) => (
        <View key={v.plate} style={styles.vehicleRow}>
          <Text style={styles.plate}>{v.plate}</Text>
          <View style={styles.badges}>
            {v.isDefault && <Text style={styles.badge}>Default</Text>}
            {v.notify && <Text style={styles.badgeAlt}>Notifica</Text>}
          </View>
        </View>
      ))}

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
  hint: { color: '#5a6b84', fontSize: 13, textAlign: 'center', marginTop: 20 },
});
