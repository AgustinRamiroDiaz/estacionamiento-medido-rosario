// Callejero de zonas medidas, cacheado en AsyncStorage. Es público (~55 KB) y
// cambia poco: se baja una vez y se reusa; `signin` trae el hash vigente (`sth`)
// para saber cuándo re-bajarlo.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { streetMapUpdate } from './api/gateway';
import { StreetMap } from './api/types';

const KEY = 'moviltr.streetMap';

let cached: StreetMap | null = null;

export async function getStreetMap(expectedHash?: string): Promise<StreetMap> {
  if (!cached) {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) cached = JSON.parse(raw);
    } catch {
      cached = null;
    }
  }
  const stale = !cached || cached.blocks.length === 0 || (!!expectedHash && cached.hash !== expectedHash);
  if (stale) {
    const fresh = await streetMapUpdate();
    cached = fresh;
    await AsyncStorage.setItem(KEY, JSON.stringify(fresh));
  }
  return cached!;
}
