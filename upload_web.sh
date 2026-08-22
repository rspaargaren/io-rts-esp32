#!/bin/bash
# Upload web files to the device.
# JS and CSS are uploaded as pre-compressed .gz only (saves LittleFS space).
# index.html and other files are uploaded as-is.
# With no arguments, uploads everything in web_data_v2/.
#
# Usage: ./upload_web.sh [file ...]   (paths relative to web_data_v2/)
#   DEVICE=192.168.1.x ./upload_web.sh   (override target IP)

set -e
DEVICE=${DEVICE:-192.168.178.57}
DIR="$(dirname "$0")/web_data_v2"

KEY=$(curl -s "http://$DEVICE/api/ota/key" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])")
if [ -z "$KEY" ]; then echo "ERROR: could not get OTA key from $DEVICE"; exit 1; fi
echo "Key: $KEY"

upload() {
  local file=$1
  local path=$2
  local result
  result=$(curl -s -X POST "http://$DEVICE/api/upload/web?path=/$path" \
    -H "X-OTA-Key: $KEY" --data-binary @"$file")
  echo "$path → $result"
  if echo "$result" | grep -q "Write failed"; then
    echo "  WARNING: write failed — LittleFS may be fragmented, retry may help"
  fi
}

upload_file() {
  local rel=$1
  local full="$DIR/$rel"
  if [ ! -f "$full" ]; then echo "Not found: $full"; return 1; fi

  case "$rel" in
    *.js|*.css)
      # Upload only the pre-compressed .gz (saves ~80% LittleFS space)
      local gz="${full}.gz"
      if [ ! -f "$gz" ]; then
        echo "Compressing $rel..."
        gzip -9 -k "$full"
      fi
      upload "$gz" "${rel}.gz"
      ;;
    *.gz)
      # Already compressed — upload as-is
      upload "$full" "$rel"
      ;;
    *)
      # HTML, images, etc — upload plain
      upload "$full" "$rel"
      ;;
  esac
}

if [ $# -eq 0 ]; then
  # No arguments — upload all files in web_data_v2/ automatically (no hardcoded list).
  # JS and CSS upload as .gz (compressed). All other files upload as-is.
  # Pre-existing .gz files for js/css are skipped — the *.js/css handler creates/uses them.
  while IFS= read -r -d '' full; do
    rel="${full#$DIR/}"
    case "$rel" in
      *.js.gz|*.css.gz) ;;  # skip — handled as part of *.js / *.css below
      *) upload_file "$rel" ;;
    esac
  done < <(find "$DIR" -type f -print0 | sort -z)
else
  for rel in "$@"; do
    upload_file "$rel"
  done
fi
