#!/usr/bin/env bash
# decompile.sh — rearma el pipeline de ingeniería inversa del bundle Hermes.
#
# Produce work/bundle_decomp.js (pseudo-JS) para buscar operaciones, tags y lógica.
# Los artefactos (work/, venv/) están gitignoreados: esto los regenera.
#
# Requiere: el XAPK en work/moviltr.xapk.
#   La descarga es manual porque APKPure está detrás de Cloudflare (curl no pasa):
#   bajar com.parkit.selfcare (versionCode 108) desde
#   https://apkpure.com/estacionamiento-medido-rosario/com.parkit.selfcare/download
#   y dejarlo en reversing/work/moviltr.xapk
#
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p work

if [[ ! -f work/moviltr.xapk ]]; then
  echo "Falta work/moviltr.xapk — ver instrucciones arriba." >&2
  exit 1
fi

# venv con hermes-dec
if [[ ! -x venv/bin/hbc-decompiler ]]; then
  python3 -m venv venv
  ./venv/bin/pip install -q hermes-dec
fi

# XAPK -> APK base -> bundle Hermes
unzip -q -o work/moviltr.xapk com.parkit.selfcare.apk -d work/
unzip -q -o work/com.parkit.selfcare.apk assets/index.android.bundle -d work/
file work/assets/index.android.bundle

# Bytecode Hermes -> pseudo-JS
./venv/bin/hbc-decompiler work/assets/index.android.bundle work/bundle_decomp.js
echo "OK -> work/bundle_decomp.js ($(wc -l < work/bundle_decomp.js) líneas)"
echo
echo "Ejemplos de búsqueda:"
echo "  grep -oE '<ser>[a-zA-Z]+' work/bundle_decomp.js | sort -u      # operaciones"
echo "  grep -nE '[^a-z]thm[^a-z]' work/bundle_decomp.js               # uso de un tag"
