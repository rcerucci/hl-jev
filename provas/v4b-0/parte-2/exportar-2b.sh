#!/bin/bash
# V4b-0 parte 2b — export do checkpoint `typed-decisions` para ONNX.
# Corre FORA do repositório. Nada do repo é tocado. Log em $S/2b-export.log
# Regras da 2b (fixadas antes, em provas/v4b-0/parte-2/PLANO.md):
#   mesmo snapshot de 3144; reportar a parte e sem baixar o theta; recusa escrita se falhar ou p95 >= 2 s.
set -u
S=/home/cerucci/.hermes/profiles/appbuilder/cache/scratch/laya
W="$S/2b"
mkdir -p "$W" && cd "$W" || exit 1
log() { echo "[$(date -u +%H:%M:%SZ)] $*"; }

log "1/6 clonar o repo do export (receptron/laya)"
if [ ! -d laya ]; then
  git clone --depth 1 -q https://github.com/receptron/laya.git || { log "FALHA clone"; exit 1; }
fi
ls laya/export/export_onnx.py >/dev/null 2>&1 || { log "FALHA: export_onnx.py nao existe"; exit 1; }
cd laya/export || exit 1

log "2/6 venv 3.12 (uv)"
uv venv -p 3.12 .venv 2>&1 | tail -2 || { log "FALHA venv"; exit 1; }

log "3/6 deps (torch do indice CPU, para nao puxar CUDA)"
uv pip install -p .venv/bin/python --index-url https://download.pytorch.org/whl/cpu torch 2>&1 | tail -3
uv pip install -p .venv/bin/python transformers safetensors onnx onnxscript onnxruntime huggingface_hub 2>&1 | tail -3
.venv/bin/python -c "import torch, transformers, onnx, onnxruntime; print('  deps ok:', torch.__version__, transformers.__version__)" || { log "FALHA deps"; exit 1; }

log "4/6 checkpoint typed-decisions (846 MB) + os .py de referencia"
.venv/bin/python - <<'PY' || { log "FALHA download do checkpoint"; exit 1; }
from huggingface_hub import snapshot_download
snapshot_download('convaiinnovations/laya-typed-decisions', local_dir='model-typed',
                  allow_patterns=['model.safetensors', 'encoder/*', 'tokenizer/*', 'rl_agent_config.json'])
snapshot_download('convaiinnovations/laya', local_dir='model-typed',
                  allow_patterns=['rl_common.py', 'rl_agent_api.py'])
print('  checkpoint e .py no sitio')
PY
ls -la model-typed 2>/dev/null | tail -8
[ -f model-typed/model.safetensors ] || { log "FALHA: sem model.safetensors"; exit 1; }

log "5/6 export"
.venv/bin/python export_onnx.py model-typed ../onnx-typed 2>&1 | tail -15
rc=${PIPESTATUS[0]}
log "export terminou com rc=$rc"

log "6/6 bundle produzido?"
for f in laya.onnx laya.onnx.data laya_config.json tokenizer/tokenizer.json tokenizer/tokenizer_config.json; do
  if [ -e "../onnx-typed/$f" ]; then echo "  OK   $f"; else echo "  FALTA $f"; fi
done
du -sh ../onnx-typed 2>/dev/null
log "fim (bundle em $W/laya/onnx-typed)"
