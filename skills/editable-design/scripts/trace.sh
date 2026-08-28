#!/usr/bin/env bash
# Append-only execution trace for one poster build.
#
# Writes into `.trace/` inside the poster project: a manifest, one JSONL event
# stream, per-step command output, and copies of intermediate artefacts. The
# point is that "what was decided, and why" survives after the conversation is
# gone — a rendered poster on its own cannot tell you which prompt produced its
# backdrop or why a canvas size was chosen.
#
# Pure bash on purpose: this plugin has no runtime dependencies, and adding one
# just to keep a log would be a bad trade.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
cd "$project_root"

trace_dir="${POSTER_TRACE_DIR:-$project_root/.trace}"
events="$trace_dir/events.jsonl"

now() { date +"%Y-%m-%dT%H:%M:%S%z" | sed 's/\(..\)$/:\1/'; }

# Minimal JSON string escaping: backslash, quote, then control characters.
esc() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | awk 'BEGIN { ORS = "" } { if (NR > 1) print "\\n"; print }'
}

require_trace() {
  test -f "$events" || {
    echo "trace: no active trace. Run trace.sh init first" >&2
    exit 2
  }
}

append() {
  require_trace
  local seq
  seq=$(( $(wc -l <"$events") + 1 ))
  printf '{"seq":%d,"ts":"%s",%s}\n' "$seq" "$(now)" "$1" >>"$events"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  init)
    label="${1:-}"
    mkdir -p "$trace_dir/steps" "$trace_dir/artifacts"
    : >"$events"
    printf '{\n  "schema": "runlog/v1",\n  "run_id": "%s",\n  "created_at": "%s",\n  "skill": "poster-building",\n  "workspace": "%s",\n  "label": "%s",\n  "status": "running"\n}\n' \
      "$(date +%Y%m%d-%H%M%S)" "$(now)" "$(esc "$PWD")" "$(esc "$label")" \
      >"$trace_dir/manifest.json"
    append "\"type\":\"run_start\",\"label\":\"$(esc "$label")\""
    echo "$trace_dir"
    ;;

  start)
    step="${1:?usage: trace.sh start STEP [TITLE]}"
    append "\"type\":\"step_start\",\"step\":\"$(esc "$step")\",\"title\":\"$(esc "${2:-}")\""
    ;;

  done)
    step="${1:?usage: trace.sh done STEP [STATUS] [NOTE]}"
    append "\"type\":\"step_done\",\"step\":\"$(esc "$step")\",\"status\":\"${2:-ok}\",\"note\":\"$(esc "${3:-}")\""
    ;;

  decision)
    key="${1:?usage: trace.sh decision KEY VALUE WHY [STEP]}"
    value="${2:?}"
    why="${3:?why is required — a decision without a reason is not worth recording}"
    append "\"type\":\"decision\",\"step\":\"$(esc "${4:-}")\",\"key\":\"$(esc "$key")\",\"value\":\"$(esc "$value")\",\"why\":\"$(esc "$why")\""
    ;;

  note)
    append "\"type\":\"note\",\"step\":\"$(esc "${2:-}")\",\"text\":\"$(esc "${1:?usage: trace.sh note TEXT [STEP]}")\""
    ;;

  artifact)
    src="${1:?usage: trace.sh artifact PATH [STEP]}"
    step="${2:-_unassigned}"
    test -e "$src" || { echo "trace: no such path: $src" >&2; exit 2; }
    dest="$trace_dir/artifacts/$step"
    mkdir -p "$dest"
    # -X drops extended attributes on macOS; GNU cp does not accept the same
    # option, so keep the portable path everywhere else.
    if [[ "$(uname -s)" == "Darwin" ]]; then
      cp -RX "$src" "$dest/"
    else
      cp -R "$src" "$dest/"
    fi
    copied="$dest/$(basename "$src")"
    find "$dest" -name '._*' -delete 2>/dev/null || true
    if [[ -d "$copied" ]]; then
      size=$(find "$copied" -type f -exec wc -c {} + | tail -1 | awk '{print $1}')
    else
      size=$(wc -c <"$copied" | tr -d ' ')
    fi
    append "\"type\":\"artifact\",\"step\":\"$(esc "$step")\",\"name\":\"$(esc "$(basename "$src")")\",\"path\":\"artifacts/$(esc "$step")/$(esc "$(basename "$src")")\",\"bytes\":$size"
    ;;

  run)
    step="${1:?usage: trace.sh run STEP -- COMMAND...}"
    shift
    [[ "${1:-}" == "--" ]] && shift
    [[ $# -gt 0 ]] || { echo "trace: no command given" >&2; exit 2; }

    step_dir="$trace_dir/steps/$step"
    mkdir -p "$step_dir"
    index=$(( $(find "$step_dir" -name 'exec-*.json' | wc -l) + 1 ))
    stem=$(printf 'exec-%02d' "$index")

    append "\"type\":\"exec_start\",\"step\":\"$(esc "$step")\",\"label\":\"$stem\",\"command\":\"$(esc "$*")\""

    started=$(date +%s)
    set +e
    "$@" >"$step_dir/$stem.stdout" 2>"$step_dir/$stem.stderr"
    code=$?
    set -e
    elapsed=$(( $(date +%s) - started ))

    printf '{\n  "label": "%s",\n  "command": "%s",\n  "exit_code": %d,\n  "duration_s": %d,\n  "stdout": "%s.stdout",\n  "stderr": "%s.stderr"\n}\n' \
      "$stem" "$(esc "$*")" "$code" "$elapsed" "$stem" "$stem" >"$step_dir/$stem.json"

    append "\"type\":\"exec_done\",\"step\":\"$(esc "$step")\",\"label\":\"$stem\",\"exit_code\":$code,\"duration_s\":$elapsed"

    cat "$step_dir/$stem.stdout"
    cat "$step_dir/$stem.stderr" >&2
    exit $code
    ;;

  finish)
    require_trace
    status="${1:-ok}"
    append "\"type\":\"run_finish\",\"status\":\"$status\""
    sed -i.bak "s/\"status\": \"running\"/\"status\": \"$status\"/" "$trace_dir/manifest.json"
    rm -f "$trace_dir/manifest.json.bak"
    printf '{\n  "status": "%s",\n  "finished_at": "%s",\n  "events": %d\n}\n' \
      "$status" "$(now)" "$(wc -l <"$events")" >"$trace_dir/result.json"
    echo "$trace_dir"
    ;;

  *)
    cat >&2 <<'USAGE'
usage: trace.sh <command>

  init [LABEL]                     start a trace in ./.trace/
  start STEP [TITLE]               mark a step as started
  done STEP [ok|skip|fail] [NOTE]  mark a step as finished
  decision KEY VALUE WHY [STEP]    record a choice and its reason (why is required)
  note TEXT [STEP]                 record an observation
  artifact PATH [STEP]             copy an intermediate artefact into the trace
  run STEP -- COMMAND...           run a command, capturing output and exit code
  finish [ok|fail]                 close the trace
USAGE
    exit 2
    ;;
esac
