// Persistencia local. UUID de instalación: se genera una vez y se reusa como
// base del `abh` de cada request (ver antiBounceHash en api/gateway.ts). No es
// un dato sensible.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

const ABH_KEY = 'moviltr.abh';

let cachedAbh: string | null = null;

export async function getAbh(): Promise<string> {
  if (cachedAbh) return cachedAbh;
  let abh = await AsyncStorage.getItem(ABH_KEY);
  if (!abh) {
    abh = randomUUID();
    await AsyncStorage.setItem(ABH_KEY, abh);
  }
  cachedAbh = abh;
  return abh;
}
