#!/usr/bin/env bash
# signin.sh — login contra el gateway de Movil TR y captura del XML de respuesta.
#
# VOS tipeás las credenciales; el script NO las imprime ni las deja en el
# historial ni en la línea de comandos (el PIN va por stdin, no por argv).
# La respuesta cruda se guarda en .secrets/ (ignorado por git) para analizarla.
#
# Uso:
#   ./tools/signin.sh            # pide usuario y PIN interactivamente
#   SRC=juan ./tools/signin.sh   # usuario por env, PIN se pide igual
#
set -euo pipefail

URL="https://moviltr.com.ar/MParkingGateway/midletGateway"
VER="11-RN"
APP_OS="RN-android"
APP_VER="5.17.0"
UA="okhttp/4.9.2"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEC="$DIR/.secrets"
mkdir -p "$SEC"; chmod 700 "$SEC"

ABH_FILE="$SEC/abh"
COOKIES="$SEC/cookies.txt"
RESP="$SEC/signin.response.xml"

# abh = UUID de instalación, estable entre corridas (como hace la app real)
if [[ ! -f "$ABH_FILE" ]]; then
  cat /proc/sys/kernel/random/uuid > "$ABH_FILE"
fi
ABH="$(cat "$ABH_FILE")"

# --- Credenciales (el PIN no se muestra) ---
SRC="${SRC:-}"
if [[ -z "$SRC" ]]; then
  read -rp "Usuario (src): " SRC
fi
read -rsp "PIN: " PIN; echo

# --- Armar el body en un archivo temporal con permisos restrictivos ---
# (no pasamos el PIN por la línea de comandos para que no sea visible en 'ps')
BODY="$(mktemp)"; chmod 600 "$BODY"
cleanup() { rm -f "$BODY"; PIN=""; }
trap cleanup EXIT

# Escapar XML mínimo (& < >) en src y pin
xmlesc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

cat > "$BODY" <<XML
<?xml version="1.0" encoding="utf-8"?>
<Request><ver>${VER}</ver><abh>${ABH}</abh><ser>signin</ser><src>$(xmlesc "$SRC")</src><pin>$(xmlesc "$PIN")</pin><app>user</app><app_os>${APP_OS}</app_os><app_ver>${APP_VER}</app_ver></Request>
XML

echo "→ POST signin (ver ${VER}, abh ${ABH:0:8}…) …"
HTTP=$(curl -s -m 20 -o "$RESP" -w '%{http_code}' \
  -X POST "$URL" \
  -H "Content-Type: text/xml" -A "$UA" \
  -c "$COOKIES" -b "$COOKIES" \
  --data-binary @"$BODY")

echo "HTTP $HTTP — respuesta guardada en: $RESP"
echo "Cookies (JSESSIONID) en: $COOKIES"
echo
echo "=== Tags presentes en la respuesta ==="
grep -oE '</?[a-zA-Z][a-zA-Z0-9_-]*>' "$RESP" | sort | uniq -c || true
echo
echo "=== <error> ==="; grep -oE '<error>[^<]*</error>' "$RESP" || echo "(sin tag error)"
echo
echo "Listo. Pasame el archivo $RESP (o su contenido, tapando lo que quieras)"
echo "para analizar la estructura. El PIN no quedó registrado en ningún lado."
