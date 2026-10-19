# Estacionamiento Medido Rosario — cliente alternativo

Investigación para construir un cliente propio (web app / app nativa) del sistema de
estacionamiento medido de Rosario, reutilizando el backend oficial.

- App oficial: **Movil TR / Estacionamiento Medido Rosario**
- Desarrollador: **TEKNOWARE SA** (owner Expo: `teknoware`)
- Paquete Android: `com.parkit.selfcare` — iOS: `com.parkit.selfcare.Estacionamiento-Medido-Rosario`
- Versión analizada: **5.17.0** (versionCode 108, Dic 2024)
- Stack: **Expo / React Native**, motor **Hermes**

El backend es un **gateway XML único** heredado del sistema MIDlet (Java ME) original.
Toda la app lo consume con requests y responses en XML.

## Estado de la investigación

- [x] Descompilación del APK (jadx) y del bundle Hermes (`hermes-dec`)
- [x] Mapa completo del protocolo y las 54 operaciones — ver [`docs/api-reference.md`](docs/api-reference.md)
- [x] Verificación en vivo de operaciones de lectura sin cuenta — ver [`docs/live-findings.md`](docs/live-findings.md)
- [ ] Flujo de `signin` / sesión autenticada (requiere credenciales reales)
- [ ] Formato de respuesta del resto de las operaciones
- [ ] Prototipo de cliente

## Documentos

- [`docs/api-reference.md`](docs/api-reference.md) — protocolo, envelope, catálogo de operaciones y campos
- [`docs/live-findings.md`](docs/live-findings.md) — resultados de las llamadas reales al gateway
- [`docs/samples/`](docs/samples/) — respuestas XML crudas capturadas

## Consideraciones

Proyecto de interoperabilidad para uso personal. Toca saldo real, tickets y actas:
cualquier prueba con operaciones de escritura o pago debe hacerse con cuidado y montos
mínimos. Es probable que los términos del servicio no contemplen clientes no oficiales;
revisar antes de distribuir a terceros.
