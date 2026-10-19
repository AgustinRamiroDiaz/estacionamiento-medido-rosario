# App — cliente alternativo (React Native + TypeScript)

PoC de un cliente propio del estacionamiento medido de Rosario. **App nativa**: le
pega directo al gateway de `moviltr.com.ar` desde el teléfono (sin CORS, sin proxy,
sin servidor propio). Cada usuario se loguea con **sus** credenciales en su dispositivo.

Stack: Expo (React Native 0.88, React 19) + TypeScript.

## Qué hace hoy

- **Login** (`signin`) con usuario (celular) + PIN.
- **Dashboard** (`refreshDashboard`): saldo, vehículos y si hay estacionamiento activo.

No persiste credenciales: el PIN se usa sólo para el login. La sesión se sostiene con
la cookie `JSESSIONID` + un `abh` (UUID de instalación) estable en `AsyncStorage`.

## Estructura

```
App.tsx              UI (login + dashboard)
src/api/gateway.ts   cliente del gateway XML (protocolo, cookies, parseo)
src/api/types.ts     tipos de las respuestas
src/storage.ts       abh persistente
```

El protocolo está documentado en [`../docs/`](../docs/).

## Desarrollo

```sh
npm install
npx expo start          # abrir en Expo Go o emulador
npx tsc --noEmit        # typecheck
```

> Nota: `fetch` nativo en Android no sufre CORS. En Expo Go el manejo de cookies es
> el del runtime; en un build nativo va por OkHttp. El cliente igual captura y
> reenvía `JSESSIONID` manualmente por robustez.

## Build del APK

Lo hace una GitHub Action (`.github/workflows/build-apk.yml`), **todo en el runner**,
sin EAS ni servicios externos:

- **Release:** pushear un tag `vX.Y.Z` → compila y publica el `.apk` en un GitHub Release.
  ```sh
  git tag v1.0.0 && git push origin v1.0.0
  ```
- **Manual:** correr el workflow a mano (workflow_dispatch) → el `.apk` queda como artifact.

El APK se firma con la clave de **debug** (sirve para sideload; no para Google Play).
Para una clave propia, agregar un keystore por GitHub Secrets y un `signingConfig` de
release en `android/app/build.gradle`.

## Pendiente

- Estacionar / pagar (`parkVehiculePayment`, MercadoPago).
- Notificación de vencimiento de ticket (`expo-notifications`).
- Capturar `active-parking-status` con ticket activo para tipar su contenido.
