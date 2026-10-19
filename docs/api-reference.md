# API reference — Movil TR gateway

Reconstruido de la decompilación del bundle Hermes de la v5.17.0.

## Transporte

- **Endpoint único:** `POST https://moviltr.com.ar/MParkingGateway/midletGateway`
- **Content-Type:** `text/xml`
- **Cookies:** `withCredentials: true`. El server setea `JSESSIONID` (scope `/MParkingGateway`, `Secure; HttpOnly`).
- **Timeout** cliente: 7000 ms
- Request y response en **XML** (no hay `JSON.parse` en el bundle; el XML a veces *contiene* JSON como texto, ver `<ver>`).
- `baseUrl = https://moviltr.com.ar`
- `otherFinesUrl = https://www.rosario.gob.ar/gdm/patente.do?accion=ir` (lookup de patente, web externa)
- MercadoPago public key se obtiene de `getConfiguration` (`<mpk>APP_USR-…</mpk>`).

## Envelope de request

```xml
<?xml version="1.0" encoding="utf-8"?>
<Request>
  <ver>11-RN</ver>        <!-- versión de protocolo, POR OPERACIÓN (ver tabla) -->
  <abh>UUID</abh>         <!-- installationId del dispositivo (Expo getInstallationIdAsync),
                               generado y persistido por el cliente -->
  <ser>operacion</ser>    <!-- nombre de la operación -->
  <!-- ...campos específicos... -->
</Request>
```

### `<ver>` controla el formato del payload

Verificado en vivo: una misma operación responde distinto según la versión.
- `7-RN` (legacy MIDlet) → objetos **Java serializados** base64 (`rO0AB…`).
- `11-RN` / `12-RN` → el mismo contenido en **JSON** (dentro del tag XML).

👉 Usar siempre las versiones que usa la app RN (tabla abajo) para recibir JSON.

## Envelope de response

```xml
<?xml version="1.0" encoding="utf-8"?>
<Response>
  <error>0</error>        <!-- 0 = OK; !=0 = error -->
  <!-- ...campos... -->
</Response>
```

El cliente lee de la respuesta: `type`, `error`, `errorCode`, `errorDescription`.

## Autenticación

- **`signin`**: `<src>` (usuario/abonado) + `<pin>` (PIN) + `<app>user</app>` + `<app_os>RN-…</app_os>` + `<app_ver>`.
- `<abh>` (UUID de instalación) viaja en casi todas las operaciones, incluido `signin`.
- No se observó token tipo bearer: la sesión se sostiene por **cookie `JSESSIONID`** + `abh`.
- **`registration`**: alta de cuenta (`<src><fir><las><ema>…`).

## Diccionario de campos

| tag | significado |
|-----|-------------|
| `ver` | versión de protocolo (`N-RN`) |
| `abh` | UUID de instalación del cliente |
| `ser` | operación |
| `src` | subscriber / usuario (abonado) |
| `pin` | PIN / clave |
| `lic` | patente |
| `car-type` | tipo de vehículo |
| `amo` | monto |
| `str` | calle / cuadra |
| `ema` | email |
| `fak` | emitir factura (bool) |
| `fir` / `las` | nombre / apellido |
| `dni` | DNI |
| `fin` | id de multa (fine) |
| `tra` | id de transacción / ticket (post-pago diferido) |
| `aid` | id de preferencia de pago (MercadoPago / MacroClick) |
| `bbu` / `bbut` | back URL del checkout |
| `dst` | destino (p2p top-up) |
| `pag`/`pgs`/`pcd`/`rtp` | paginación/filtros de facturas |
| `alias` | alias de cuenta |
| `sta` | estado (SOS credit) |
| `sug` | texto de sugerencia |
| `nc` | flag onboarding |
| `ivc` | config de facturación |
| `act-code` | código de acta |
| `mop` | método de pago (wheel lock) |
| `app`/`app_os`/`app_ver` | metadata de la app |
| `test` | flag de prueba (getConfiguration) |

### Respuesta de `getConfiguration`

| tag | significado |
|-----|-------------|
| `sth` | hash del street map |
| `tth` | hash de la tabla de tarifas |
| `mpk` | MercadoPago public key (`APP_USR-…`) |
| `mpe` | MercadoPago habilitado (bool) |
| `mpc` / `mpMode` | modo de checkout MP (`web`/`browser`) |
| `mce` | MacroClick habilitado (bool) |
| `payment-method` | método por defecto (`MP`) |

## Catálogo de operaciones (54)

Formato: `operación` (ver) — campos del request además de `ver`/`abh`/`ser`.

### Cuenta / sesión
- `registration` (7-RN) — `src, fir, las, ema, …`
- `signin` (11-RN) — `src, pin, app, app_os, app_ver`
- `changePassword` (7-RN) — `pin`
- `resetPassword` (7-RN) — `src, ema`
- `unregisterUser` (—) — (sólo abh)
- `getPersonalInfo` (11-RN) — (sin abh: sólo `ver`,`ser`)
- `setPersonalInfo` (11-RN) — `fir, las, ema, dni`
- `getAlias` (—) · `setAlias` (9-RN) — `alias`
- `onboardingApp` (12-RN) — `nc`

### Vehículos
- `getUserVehicle` (—) · `addUserVehicle` (11-RN) — `lic` · `removeUserVehicle` (11-RN) — `lic`
- `setVehicleNotificationUser` (11-RN) — `lic, …`

### Config / dashboard
- `getConfiguration` (11-RN) — `app, app_os, app_ver`, `test`  ← **no requiere abh ni cuenta**
- `refreshDashboard` (7-RN) · `refreshOcassionalDashboard` (—)
- `tariffTableUpdate` (11-RN) · `topUpAmountListUpdate` (—) · `streetMapUpdate` (—)
- `commerces` (—)

### Estacionar (core)
- `parkVehiculePayment` (7-RN) — `fak, lic, car-type, amo, str`  ← prepago
- `parkVehiculeStartPostPayment` (7-RN) — `fak, lic, car-type, str`  ← inicia diferido
- `parkVehiculeEndPostPayment` (7-RN) — `tra`  ← cierra diferido
- `updateParkPostPaymentVehicule` (7-RN) — `tra`
- `parkContainerPayment` (7-RN) — `fak, lic, str, …`
- `longTermParkingPayment` (11-RN) — `fak, lic, car-type, …`
- `ocassionalParkVehiculePayment` (9-RN) — `fak, lic, car-type, amo, …`

### Saldo / pagos
- `directTopUp` (7-RN) — `amo`
- `p2pTopUp` (7-RN) — `dst, amo`
- `mercadoPagoCreatePreference` (11-RN) — `aid, bbu, …` · `mercadoPagoUpdatePayment` (11-RN) — `aid`
- `macroClickCreatePreference` (11-RN) — `aid, bbu, …` · `macroClickUpdatePayment` (11-RN) — `aid`
- `getSOSCreditState` (—) · `setSOSCreditState` (7-RN) — `sta`

### Multas / actas / cepo / grúa
- `fineInformation` (7-RN) — `lic` · `finePayment` (7-RN) — `fak, fin, lic, …`
- `occasionalFineInformation` (11-RN) — `lic` · `occasionalFinePayment` (11-RN) — `fak, fin, lic, ema`
- `carWheelLockQuery` (11-RN) — `lic` · `carWheelLockPayment` (11-RN) — `fak, lic, mop, ema`
- `occasionalCarWheelLockQuery` (11-RN) — `lic` · `occasionalCarWheelLockPayment` (11-RN) — `fak, lic, ema`
- `towQuery` (11-RN) — `lic`  (sin abh)
- `getUrbioticaParkStateInfo` (—)
- `generateActCode` (7-RN) — `src` · `verifyActCode` (7-RN) — `src, act-code`

### Patente / varios
- `carLicenseInformation` (10-RN) — `lic, str`
- `carLicenseInformationAnonymous` (10-RN) — `lic, str`  (anónima)
- `carLicenseRegistration` (7-RN) — `lic`
- `suggestion` (7-RN) — `sug`

### Facturas
- `getInvoices` (12-RN) — `pag, pgs, pcd, rtp`
- `getInvoiceConfiguration` (12-RN) · `updateInvoiceConfiguration` (12-RN) — `ivc`

## Objetos del dominio (del blob Java legacy)

Clases del server (namespace `parkingServer.bussines.entities`):
`tariff.TariffTable`, `tariff.Band`, `tariff.Tariff`, `tariff.SpecialDay`, `tariff.SpecialDay$Day`.

## Estado Redux del cliente (shape esperado)

```
streetMapHash, tariffTableHash, mpKey, mpe, mce, mpMode,
tmh, streetMapData, tariffTableData, savedPlates, selectedPlate,
showPlatesModal, showPlatesError, platesErrorMessage, uuid,
counter, message, userAlert, notificationCounter,
endOfLifeVersion, borderEndOfLifeVersion
```
