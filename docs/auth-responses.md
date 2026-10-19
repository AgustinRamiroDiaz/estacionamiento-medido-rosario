# Respuestas autenticadas — `signin` y `refreshDashboard`

Verificado en vivo con una cuenta real (valores reemplazados por ejemplos).
El `src` usado fue un **número de celular** (10 dígitos); el `pin` es el PIN de la cuenta.
`error=0` = éxito. La sesión queda en la cookie `JSESSIONID` (scope `/MParkingGateway`).

## `signin` (ver 11-RN)

Request: `src` (usuario), `pin`, `app=user`, `app_os=RN-android`, `app_ver`, más `abh`.

Response (~680 bytes) — trae **config + hashes de sync + dashboard** de una:

```xml
<Response>
  <error>0</error>

  <!-- hashes de sincronización: el cliente re-baja sólo lo que cambió -->
  <sth>85cbe1</sth>   <!-- street map hash   (cf. streetMapUpdate)      -->
  <tah>37f7f2</tah>   <!-- top-up amounts hash (cf. topUpAmountListUpdate) -->
  <tth>9ede35</tth>   <!-- tariff table hash  (cf. tariffTableUpdate)    -->

  <!-- config de pagos (igual que getConfiguration) -->
  <mpe>true</mpe>     <!-- MercadoPago habilitado -->
  <mpc>web</mpc>      <!-- modo checkout MP       -->
  <mce>true</mce>     <!-- MacroClick habilitado  -->
  <mpk>APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</mpk>  <!-- MP public key -->

  <!-- flags/counters -->
  <otm>true</otm>     <!-- IGNORADO por el cliente (no se lee en el bundle v5.17.0) -->
  <thm>6</thm>        <!-- entero; leído del estado user en pantallas de montos/tickets -->
  <qre>false</qre>    <!-- IGNORADO por el cliente (no se lee en el bundle v5.17.0) -->

  <uid>123456</uid>   <!-- id de usuario -->

  <!-- saldo (en centavos, ×100) -->
  <balance>
    <credit>50000</credit>      <!-- saldo = $500,00 -->
    <available>50000</available><!-- disponible = $500,00 -->
  </balance>

  <!-- patente por defecto -->
  <default-car-license><lic>ABC123</lic></default-car-license>

  <!-- street map: vacío si el hash coincide; si no, JSON de calles -->
  <streets></streets>

  <!-- vehículos de la cuenta -->
  <vehicles>
    <vehicle><lic>ABC123</lic><def>true</def><not>false</not></vehicle>
    <vehicle><lic>AD456DF</lic><def>false</def><not>false</not></vehicle>
  </vehicles>

  <!-- ticket activo: vacío si no hay estacionamiento en curso -->
  <active-parking-status></active-parking-status>
</Response>
```

### Campos

| tag | significado |
|-----|-------------|
| `sth` / `tah` / `tth` | hashes de street map / montos de recarga / tabla de tarifas |
| `mpe` `mpc` `mce` `mpk` | config MercadoPago / MacroClick (ver `getConfiguration`) |
| `otm` | booleano. **No lo usa el cliente** (sin referencias en el bundle v5.17.0) |
| `thm` | entero (obs. `6`). Lo lee el estado Redux `user` en pantallas de montos/tickets; significado exacto no resuelto desde el bytecode |
| `qre` | booleano. **No lo usa el cliente** (sin referencias en el bundle v5.17.0) |
| `uid` | id de usuario |
| `balance.credit` | saldo (centavos) |
| `balance.available` | saldo disponible (centavos) — puede diferir de `credit` si hay retenciones |
| `default-car-license.lic` | patente por defecto |
| `streets` | callejero (vacío si el hash local coincide) |
| `vehicles.vehicle` | lista de vehículos |
| `vehicle.lic` | patente |
| `vehicle.def` | es la patente por defecto (bool) |
| `vehicle.not` | notificaciones activadas para ese vehículo (bool) |
| `active-parking-status` | ticket en curso (vacío si no hay) |

## `refreshDashboard` (ver 7-RN)

Request: sólo `abh` (usa la cookie de sesión). Response (~459 bytes): el **subconjunto
de dashboard** de `signin`, sin config ni hashes ni `uid`:

```xml
<Response>
  <error>0</error>
  <balance><credit>50000</credit><available>50000</available></balance>
  <default-car-license><lic>ABC123</lic></default-car-license>
  <streets></streets>
  <vehicles>
    <vehicle><lic>ABC123</lic><def>true</def><not>false</not></vehicle>
    <vehicle><lic>AD456DF</lic><def>false</def><not>false</not></vehicle>
  </vehicles>
  <active-parking-status></active-parking-status>
</Response>
```

## Sesión

- `signin` setea `JSESSIONID`. `refreshDashboard` y el resto de las operaciones
  autenticadas funcionan mandando esa cookie + el mismo `abh`.
- No se observó token bearer ni expiración explícita en el body; la vigencia la
  maneja el `JSESSIONID` del lado del server (Tomcat/Wicket).

## Pendientes

- `otm` / `qre`: confirmados como no usados por el cliente. `thm`: usado pero sin
  etiqueta legible en el bytecode (ver `reversing/` para reproducir el análisis).
- Capturar `active-parking-status` **con un ticket activo** para ver su estructura
  (requiere iniciar un estacionamiento — operación de pago, con saldo real).
- `src`: confirmado que acepta número de celular; falta ver si también acepta DNI/abonado.
