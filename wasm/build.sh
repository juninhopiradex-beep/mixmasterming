#!/bin/sh
# Compila wasm/mm_dsp.c e embute o binário em js/core/wasm-bin.js (base64). Requer clang com alvo wasm32 + wasm-ld.
set -e
cd "$(dirname "$0")/.."
clang --target=wasm32 -O3 -msimd128 -nostdlib -fno-builtin -Wl,--no-entry -Wl,--export-memory -Wl,--initial-memory=1048576 -Wl,--max-memory=4294901760 -Wl,--growable-table 2>/dev/null \
  -o wasm/mm_dsp.wasm wasm/mm_dsp.c || \
clang --target=wasm32 -O3 -msimd128 -nostdlib -fno-builtin -Wl,--no-entry -Wl,--export-memory -Wl,--initial-memory=1048576 -Wl,--max-memory=4294901760 -o wasm/mm_dsp.wasm wasm/mm_dsp.c
B64=$(base64 -w0 wasm/mm_dsp.wasm)
printf '/* gerado por wasm/build.sh a partir de wasm/mm_dsp.c — não editar à mão */\n(function () { const MM = (window.MM = window.MM || {}); MM.WASM_B64 = "%s"; })();\n' "$B64" > js/core/wasm-bin.js
echo "wasm: $(wc -c < wasm/mm_dsp.wasm) bytes"
