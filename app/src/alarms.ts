// Aviso local antes de que venza un estacionamiento. El server decide cuándo y
// con qué texto (ali/ala/alm/alt en la respuesta de estacionar), como en la app
// oficial. Un aviso por patente: estacionar de nuevo lo reemplaza y cerrar lo
// cancela.

import * as Notifications from 'expo-notifications';
import { ParkingAlarm } from './api/types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const id = (lic: string) => `parking-${lic}`;

export async function scheduleAlarm(lic: string, alarm?: ParkingAlarm): Promise<void> {
  await cancelAlarm(lic);
  if (!alarm || alarm.at.getTime() <= Date.now()) return;
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id(lic),
    content: { title: 'Estacionamiento', body: alarm.message },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: alarm.at },
  });
}

export async function cancelAlarm(lic: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id(lic)).catch(() => {});
}
