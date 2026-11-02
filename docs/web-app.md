# ¿Web app / PWA en vez de app nativa?

Análisis de noviembre 2026. Motivo: desarrollar con el emulador de Android en la PC es
engorroso, y una web app se podría instalar desde el navegador.

## Resumen

La app no puede hablar con el gateway directo desde un navegador. Hace falta un proxy en
el medio, y ese proxy ve el PIN y la sesión de cada usuario en texto plano. Para uso
propio es viable. Para ofrecerla a terceros, no: no tienen forma de verificar que el
proxy no guarda sus credenciales.

## Por qué el navegador no puede llamar al gateway

Expo ya compila para web (`pnpm web`), y `expo-location`, AsyncStorage y
`fast-xml-parser` funcionan en el navegador. Los bloqueos están en el gateway
(`https://moviltr.com.ar/MParkingGateway/midletGateway`) y en las reglas del navegador:

- **Sin CORS.** El preflight `OPTIONS` responde 200 sin `Access-Control-Allow-Origin`,
  así que el navegador bloquea las respuestas a cualquier página de otro origen.
  `http://localhost` también es otro origen, así que el bloqueo aplica en desarrollo.
- **Headers prohibidos.** [`gateway.ts`](../app/src/api/gateway.ts) setea
  `User-Agent: okhttp/4.9.2`, manda `Cookie` a mano y lee `Set-Cookie` de la respuesta.
  Desde JS en el navegador no se puede hacer ninguna de las tres cosas.
- **MD5 (sin verificar).** El hash anti-rebote usa MD5 vía `expo-crypto`. En web,
  `expo-crypto` se apoya en SubtleCrypto, que no tiene MD5. Habría que reemplazar esa
  llamada por una librería chica de MD5.

Lanzar Chrome con `--disable-web-security` saltea CORS, pero apaga la protección para
todos los sitios y sigue sin permitir setear `User-Agent`.

## Proxy en Cloudflare Workers

Un Worker de unas 30 líneas puede reenviar el POST, fijar los headers y devolver la cookie
de sesión en un header propio. Plan gratuito, verificado el 2026-11-01
([pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[limits](https://developers.cloudflare.com/workers/platform/limits/)):

| Límite | Free |
|---|---|
| Requests | 100.000/día (se reinicia a medianoche UTC; al pasarse, error 1027) |
| CPU | 10 ms por request (la espera de red no cuenta) |
| Subrequests | 50 por request (el proxy usa 1) |

El plan pago arranca en USD 5/mes y no hace falta.

## Seguridad: el proxy ve todo

- `signin` manda **celular y PIN en texto plano** dentro del XML. El resto de las
  operaciones usa la cookie de sesión. El TLS termina en el Worker, así que quien lo
  controle puede guardar ambos y usar la cuenta: pagar estacionamiento o gastar saldo.
  Eso incluye al dueño del Worker, a quien comprometa su cuenta de Cloudflare y a
  Cloudflare mismo.
- **Un usuario no puede verificar qué código corre en el Worker.** Publicar el código no
  prueba nada, porque Cloudflare no ofrece attestation del deploy. Deployar desde GitHub
  Actions en un repo público deja trazabilidad, pero igual hay que confiar en quien
  controla la cuenta.
- La PWA tiene el mismo problema: su JS se baja en cada carga y puede cambiar sin aviso.
  Una versión del APK es un archivo fijo que se puede inspeccionar.
- Todo el tráfico llegaría al gateway desde IPs de Cloudflare. Si lo bloquean, se corta
  para todos.

Opciones, de mayor a menor confianza:

1. Cada usuario deploya su propio Worker. Es gratis, pero solo sirve para gente técnica.
2. APK para terceros; PWA más Worker solo para uso propio.
3. Un Worker compartido. Es un modelo de "confiá en mí"; no lo recomiendo con PIN en
   claro y plata real en juego.

## Opción intermedia: web solo para desarrollo

Para que desarrollar en la PC sea más cómodo, alcanza con `expo start --web` y un proxy
**local** de desarrollo (middleware de Metro o un script de Node), sin hostear nada. La
URL base del gateway pasaría a ser configurable, y la distribución seguiría siendo el APK.

## Idea: Tauri v2

Tauri v2 empaqueta un frontend web como app de escritorio, Android e iOS. Se podría
compilar el mismo bundle web para todos los destinos:

- **Navegador / desarrollo:** el bundle web contra el proxy local de arriba.
- **App Tauri (Android/iOS/escritorio):** las llamadas HTTP pasan por el lado Rust con
  `tauri-plugin-http`, que no está sujeto a CORS. Así, la app instalada no necesita
  proxy y las credenciales van directo del dispositivo al gateway, como hoy con el APK.

Sin verificar, a confirmar antes de adoptarlo:

- Si `tauri-plugin-http` permite setear `User-Agent` y `Cookie` y leer `Set-Cookie`.
  Creo que lo permite con su feature `unsafe-headers`.
- La geolocalización dentro del WebView de Android/iOS: hay un plugin de geolocalización
  para mobile, pero falta probar permisos y precisión.
- El frontend: la UI actual es React Native. Habría que usar el export web de Expo
  (react-native-web) como bundle, o reescribir la UI en React DOM. Además, `fetch` tiene
  que poder cambiarse por el `fetch` del plugin cuando la app corre dentro de Tauri.
- El costo: la cadena de build de Tauri para Android (Rust, NDK) es más pesada que la de
  Expo, y se pierde Expo Go para iterar en el teléfono.

Ventaja extra: la app de escritorio de Tauri corre nativa en Linux, sin emulador, con el
mismo camino de red que la versión mobile.
