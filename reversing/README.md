# reversing/

Pipeline de ingeniería inversa de la app (Expo / React Native, motor **Hermes**).

La lógica de la app está en `assets/index.android.bundle`: **bytecode Hermes** (HBC),
no JavaScript legible. Se reconstruye a pseudo-JS con [`hermes-dec`](https://github.com/P1sec/hermes-dec).

## Reproducir

1. Bajar el XAPK de `com.parkit.selfcare` (versionCode 108) desde APKPure y dejarlo
   en `work/moviltr.xapk`. La descarga es manual: APKPure está detrás de Cloudflare.
2. `./decompile.sh` → genera `work/bundle_decomp.js`.

## Qué está versionado y qué no

- **Versionado:** `decompile.sh`, este README.
- **Ignorado** (`.gitignore`): `work/` (XAPK, APK, bundle, pseudo-JS), `venv/`, `tools/`.
  Son pesados y propietarios (el APK es de TEKNOWARE SA); se regeneran con el script.

## Notas de hallazgos

- El protocolo y las operaciones están en [`../docs/api-reference.md`](../docs/api-reference.md).
- `index.android.bundle` es Hermes bytecode **version 89**.
- `hermes-dec` da pseudo-JS sin nombres de variables originales; sirve para seguir
  la lógica y ver literales (`'<ser>signin</ser>'`, nombres de tags, etc.).
- Las respuestas XML se parsean en el cliente con **fast-xml-parser** (los tags pasan
  a ser claves de un objeto), por eso los nombres de tag se acceden como propiedades
  (`Response.vehicles`) y no siempre como strings literales.
