# Hallazgos en vivo — gateway real

Llamadas reales a `POST https://moviltr.com.ar/MParkingGateway/midletGateway`
(operaciones de lectura, sin cuenta). Fecha: 2026-10-18.

## Entorno del server

```
Server: Apache/2.2.34 (Amazon)
Strict-Transport-Security: max-age=63072000; includeSubdomains; preload
Set-Cookie: JSESSIONID=…; Path=/MParkingGateway; Secure; HttpOnly
Content-Type: text/xml;charset=UTF-8
```

- Acepta un `<abh>` (UUID) arbitrario para operaciones de lectura: no valida que
  corresponda a una instalación/cuenta real.
- `<error>0</error>` = éxito.

## `getConfiguration` — funciona sin cuenta

Request (ver 11-RN, abh aleatorio):
```xml
<Request><ver>11-RN</ver><abh>UUID</abh><ser>getConfiguration</ser>
  <app>user</app><app_os>RN-android</app_os><app_ver>5.17.0</app_ver></Request>
```

Response (HTTP 200, 255 bytes):
```xml
<Response>
  <error>0</error>
  <sth>85cbe1</sth>                              <!-- hash street map -->
  <tth>9ede35</tth>                              <!-- hash tabla tarifas -->
  <mpk>APP_USR-2e5215dd-b1c9-45f2-b7c7-d3660d533cda</mpk>  <!-- MP public key -->
  <mpe>true</mpe>
  <mpc>web</mpc>
  <mce>true</mce>
  <payment-method>MP</payment-method>
</Response>
```

Uso: el cliente compara `sth`/`tth` contra sus hashes locales para decidir si
re-descarga street map / tarifas. La MP public key habilita el checkout de MercadoPago
desde el cliente.

## `tariffTableUpdate` — el formato depende de `<ver>`

Mismo request salvo la versión:

- **`ver=7-RN`** → `<tto>` con **objeto Java serializado** (base64, `rO0AB…`).
  Clases `parkingServer.bussines.entities.tariff.*`. Inútil fuera de la JVM.
  Muestra: `samples/tariffTableUpdate.v7-legacy-java.response.xml`.

- **`ver=11-RN`** → `<tto>` con **JSON** (lo que parsea `deserializeJsonTariffTable`).
  Muestra: `samples/tariffTableUpdate.v11.response.xml`.

Estructura JSON de la tabla de tarifas (recortada):
```json
{
  "time-max-reg": 180, "time-max-hom": 180, "time-max-reg-spa": 720,
  "fine-tar": 987000, "fine-car-tar": 987000, "neg-cre": 528750, "cou-time": 10,
  "min-tar": { "dim-1": 3, "dim-2": 4, "dim-3": 3, "rec": [ ... ] },
  "tar-lev-dur": { "dim-1": 3, "rec": [60,60,0] },
  "band-labor": { "band": [
    { "start-tim-HH":9,"start-tim-MM":0,"end-tim-HH":19,"end-tim-MM":59,
      "tar-type":0,"veh-type":0,
      "zone":[
        {"tar-1":141000,"per-1":60,"tar-2":176250,"per-2":60,"tar-3":211500,"per-3":60,
         "tar-name":"Tariff Blue - Regular - Car"},
        {"tar-name":"Tariff Orange - Regular - Car", ...},
        {"tar-name":"Tariff Green - Regular - Car", ...}
      ]}
  ]},
  "band-sunday": { "band": [] }
}
```

Interpretación (a confirmar):
- `time-max-*`: minutos máximos de estadía (regular 180 = 3 h; especial 720 = 12 h).
- `cou-time`: minutos de cortesía (10).
- `band-*`: franjas horarias por día (labor/saturday/sunday/special).
- `tar-type`: 0 = regular, 1 = home zone. `veh-type`: 0 = auto, 1 = moto.
- `tar-N`/`per-N`: tarifa y duración (min) del tramo N; zonas por color (Blue/Orange/Green).
- Montos aparentan estar en **centavos** (ej. `tar-1:141000` → tramo de 60 min).
  Pendiente confirmar la escala contra la UI.

## `topUpAmountListUpdate` (ver 7-RN) — montos de recarga

```xml
<Response><error>0</error><tam><top-up-amounts>
  <top-up-amount><id>8</id><value>300000</value></top-up-amount>
  ... (9→400000, 10→500000, 11→1000000, 12→2000000, 13→3000000, 14→5000000)
  <hash>37f7f2</hash>
</top-up-amounts></tam></Response>
```

**Confirma la escala: los montos están en centavos (×100).**
`value=300000` = $3.000; opciones $3.000 / $4.000 / $5.000 / $10.000 / $20.000 / $30.000 / $50.000.
Esto aplica también a los montos de la tabla de tarifas.

## `streetMapUpdate` (ver 12-RN) — callejero de zonas medidas

`<stm><streets>[…]</streets></stm>` con JSON. Cada calle:
```json
{"number":"600","code":"3FE","zone":1,"name":"3 de Febrero","id":"2601","bis":"","lat":"-32.9538307, -60.6335182"}
```
~54 KB. Da nombre, código, zona, número, id y coordenadas de cada cuadra.
Muestra: `samples/streetMapUpdate.v12.response.xml`.

## `commerces` (ver 12-RN) — puntos de venta (recarga en efectivo)

```xml
<commerces><commerce><id>81</id><address>ALVEAR 483</address>
  <latitude>-32.9396591, -60.6536446</latitude></commerce> ... </commerces>
```
Muestra: `samples/commerces.v12.response.xml`.

## Pendientes (requieren cuenta real)

- `signin`: confirmar formato de respuesta, manejo de `JSESSIONID`, y si `src` es
  teléfono, DNI o nº de abonado.
- `refreshDashboard`: saldo, tickets activos, vehículos (la pantalla principal).
- Flujos de pago (`parkVehiculePayment`, `mercadoPagoCreatePreference`).

## Reproducir

```sh
URL="https://moviltr.com.ar/MParkingGateway/midletGateway"
ABH=$(cat /proc/sys/kernel/random/uuid)
curl -s -X POST "$URL" -H "Content-Type: text/xml" -A "okhttp/4.9.2" --data '
<?xml version="1.0" encoding="utf-8"?>
<Request><ver>11-RN</ver><abh>'"$ABH"'</abh><ser>getConfiguration</ser>
<app>user</app><app_os>RN-android</app_os><app_ver>5.17.0</app_ver></Request>'
```
