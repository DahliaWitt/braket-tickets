#!/usr/bin/env bash

# Validation script for Braket Tickets
# Lightweight by default; can be run manually or from git hooks

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF_PATH="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"

if [ -z "${CI:-}" ] && [ -z "${DOPPLER_INJECTED:-}" ]; then
  exec env DOPPLER_CONFIG=local pnpm exec tsx "${SCRIPT_DIR}/with-env.ts" "$SELF_PATH" "$@"
fi

# Clean up all background children on exit (SIGINT, SIGTERM, or normal).
# Without this, killing the script (e.g., Ctrl-C, Claude Code tool rejection)
# orphans the parallel subshells spawned by run_parallel_fast_fail, which keep
# running under doppler's process group and can exhaust Doppler API rate limits.
cleanup() {
  # Kill all jobs in this shell's job table
  kill $(jobs -p) 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${YELLOW}ℹ${NC} $1"; }
print_warn() { echo -e "${YELLOW}⚠${NC} $1"; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# Default mode: run typecheck + tests + build. Allow selective runs.
MODE=${1:-all}

# Timeout for long-running operations (in seconds)
TIMEOUT=${2:-300}  # Default 5 minutes

cd "$PROJECT_ROOT"

# Check if timeout command is available (Linux) or gtimeout (macOS with coreutils)
get_timeout_cmd() {
  if command_exists timeout; then
    echo "timeout"
  elif command_exists gtimeout; then
    echo "gtimeout"
  else
    echo ""  # No timeout available
  fi
}

TIMEOUT_CMD=$(get_timeout_cmd)

run_with_timeout() {
  local cmd="$1"
  if [ -n "$TIMEOUT_CMD" ]; then
    # Run the command through a shell so inline env assignments and compound
    # commands survive timeout wrapping intact.
    "$TIMEOUT_CMD" "$TIMEOUT" bash -lc "$cmd"
  else
    # No timeout available, just run the command
    eval "$cmd"
  fi
}

# Kill a process and all its descendants recursively
kill_tree() {
  local pid=$1
  # Get all child PIDs recursively
  local children=$(pgrep -P "$pid" 2>/dev/null)
  for child in $children; do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

# Run commands in parallel with fast-fail behavior
# Usage: run_parallel_fast_fail "name1:cmd1" "name2:cmd2" ...
# Returns 0 if all succeed, 1 if any fail (kills remaining on first failure)
run_parallel_fast_fail() {
  local pids=()
  local names=()
  local tmpdir=$(mktemp -d)
  local idx=0

  # Start all commands in background
  for item in "$@"; do
    local name="${item%%:*}"
    local cmd="${item#*:}"
    names+=("$name")

    # Run in subshell, write exit code to file when done
    (
      eval "$cmd"
      echo $? > "$tmpdir/$idx.exit"
    ) &
    pids+=($!)
    ((idx++))
  done

  # Monitor all processes - exit on first failure
  while true; do
    local all_done=true
    local i=0

    for pid in "${pids[@]}"; do
      if [ -f "$tmpdir/$i.exit" ]; then
        local exit_code=$(cat "$tmpdir/$i.exit")
        if [ "$exit_code" -ne 0 ]; then
          print_error "${names[$i]} failed"
          # Kill remaining process trees
          for p in "${pids[@]}"; do
            kill_tree "$p"
          done
          # Wait briefly for processes to terminate
          sleep 0.5
          rm -rf "$tmpdir"
          return 1
        fi
      elif kill -0 "$pid" 2>/dev/null; then
        all_done=false
      fi
      ((i++))
    done

    if $all_done; then
      break
    fi
    sleep 0.3
  done

  # All succeeded
  for name in "${names[@]}"; do
    print_success "$name passed"
  done
  rm -rf "$tmpdir"
  return 0
}

# Inner validation functions (for parallel execution - no print wrappers)
validate_lint_inner() {
  cd "$PROJECT_ROOT"
  command_exists pnpm || return 1
  run_with_timeout "pnpm lint"
}

validate_typecheck_frontend_inner() {
  cd "$PROJECT_ROOT"
  command_exists pnpm || return 1
  run_with_timeout "pnpm typecheck:frontend"
}

validate_typecheck_convex_inner() {
  cd "$PROJECT_ROOT"
  run_with_timeout "pnpm typecheck:convex"
}

validate_typecheck_scripts_inner() {
  cd "$PROJECT_ROOT"
  run_with_timeout "pnpm typecheck:scripts"
}

validate_typecheck_shared_inner() {
  cd "$PROJECT_ROOT"
  run_with_timeout "pnpm typecheck:shared"
}

validate_typecheck_ops_inner() {
  cd "$PROJECT_ROOT"
  run_with_timeout "pnpm typecheck:ops"
}

validate_frontend_tests_inner() {
  cd "$FRONTEND_DIR"
  command_exists pnpm || return 1
  run_with_timeout "pnpm test"
}

validate_convex_tests_inner() {
  cd "$PROJECT_ROOT"
  command_exists pnpm || return 1
  run_with_timeout "pnpm test:convex"
}

validate_eslint_rule_tests_inner() {
  cd "$PROJECT_ROOT"
  command_exists pnpm || return 1
  run_with_timeout "pnpm test:eslint-rules"
}

validate_convex_logging_inner() {
  cd "$PROJECT_ROOT"
  pnpm check:convex-logging
}

validate_convex_generated_inner() {
  cd "$PROJECT_ROOT"
  pnpm check:convex-generated
}

validate_realtime_guard_inner() {
  cd "$PROJECT_ROOT"
  if ! command_exists rg; then
    print_error "rg not installed; cannot run realtime usage guard"
    return 1
  fi

  local matches
  matches=$(rg -n "client\\.onUpdate\\(" frontend/src/app -g'*.ts' \
    -g'!frontend/src/app/core/services/convex-signals.ts' \
    -g'!frontend/src/app/core/services/convex.service.ts' || true)

  if [ -n "$matches" ]; then
    echo "$matches"
    return 1
  fi
}



# Public validation functions (with output, for standalone use)
validate_lint() {
  print_info "Linting (eslint + convex eslint + angular-eslint)..."
  if ! validate_lint_inner; then
    print_error "Linting failed"
    return 1
  fi
  print_success "Linting passed"
}

validate_typecheck() {
  print_info "TypeScript type checking (parallel)..."

  if ! run_parallel_fast_fail \
    "Frontend typecheck:validate_typecheck_frontend_inner" \
    "Convex typecheck:validate_typecheck_convex_inner" \
    "Scripts typecheck:validate_typecheck_scripts_inner" \
    "Shared typecheck:validate_typecheck_shared_inner" \
    "Ops typecheck:validate_typecheck_ops_inner"; then
    return 1
  fi
}

validate_tests() {
  print_info "Unit tests (frontend + convex, parallel)..."
  if ! run_parallel_fast_fail \
    "Frontend tests:validate_frontend_tests_inner" \
    "Convex tests:validate_convex_tests_inner" \
    "ESLint rule tests:validate_eslint_rule_tests_inner"; then
    return 1
  fi
}

validate_realtime_guard() {
  print_info "Realtime usage guard (onUpdate centralization)..."
  if ! validate_realtime_guard_inner; then
    print_error "Realtime usage guard failed"
    return 1
  fi
  print_success "Realtime usage guard passed"
}



validate_convex_generated() {
  print_info "Checking Convex generated file freshness..."
  if ! validate_convex_generated_inner; then
    print_error "Convex generated freshness check failed"
    return 1
  fi
  print_success "Convex generated files are fresh"
}

collect_staged_change_flags() {
  HAS_STAGED_CHANGES=0
  HAS_STAGED_FRONTEND_CHANGES=0
  HAS_STAGED_CONVEX_CHANGES=0

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 1
  fi

  if git diff --cached --quiet; then
    return 0
  fi

  HAS_STAGED_CHANGES=1
  local staged_files
  staged_files=$(git diff --cached --name-only --diff-filter=ACM)

  while IFS= read -r file; do
    [ -z "$file" ] && continue

    if [[ "$file" =~ ^frontend/.*\.(ts|html|css|scss)$ ]]; then
      HAS_STAGED_FRONTEND_CHANGES=1
    fi
    if [[ "$file" =~ ^backend/convex/.*\.ts$ ]]; then
      HAS_STAGED_CONVEX_CHANGES=1
    fi
  done <<< "$staged_files"
}

validate_fast() {
  print_info "Fast validation (staged scope)..."

  if ! collect_staged_change_flags; then
    print_warn "Unable to inspect git staged files; running full fast checks."
    validate_realtime_guard
    validate_lint
    validate_typecheck
    return
  fi

  if [ "$HAS_STAGED_CHANGES" -eq 0 ]; then
    print_success "No staged files to validate"
    return
  fi

  if [ "$HAS_STAGED_FRONTEND_CHANGES" -eq 0 ] && [ "$HAS_STAGED_CONVEX_CHANGES" -eq 0 ]; then
    print_success "No staged frontend/backend source changes"
    return
  fi

  if [ "$HAS_STAGED_FRONTEND_CHANGES" -eq 1 ]; then
    validate_realtime_guard
  fi

  if [ "$HAS_STAGED_FRONTEND_CHANGES" -eq 1 ] && [ "$HAS_STAGED_CONVEX_CHANGES" -eq 1 ]; then
    print_info "TypeScript type checking (frontend + convex, parallel)..."
    if ! run_parallel_fast_fail \
      "Frontend typecheck:validate_typecheck_frontend_inner" \
      "Convex typecheck:validate_typecheck_convex_inner"; then
      return 1
    fi
  elif [ "$HAS_STAGED_FRONTEND_CHANGES" -eq 1 ]; then
    print_info "TypeScript type checking (frontend)..."
    if ! validate_typecheck_frontend_inner; then
      print_error "Frontend typecheck failed"
      return 1
    fi
    print_success "Frontend typecheck passed"
  else
    print_info "TypeScript type checking (convex)..."
    if ! validate_typecheck_convex_inner; then
      print_error "Convex typecheck failed"
      return 1
    fi
    print_success "Convex typecheck passed"
  fi
}

validate_build() {
  print_info "Build (frontend)..."
  cd "$FRONTEND_DIR"
  if ! command_exists pnpm; then
    print_error "pnpm not installed; skipping build"
    return 1
  fi
  if ! run_with_timeout "pnpm build"; then
    print_error "Build failed"
    return 1
  fi
  print_success "Build passed"
}

validate_build_if_needed() {
  print_info "Checking whether the frontend build is affected..."
  cd "$PROJECT_ROOT"

  local decision
  if ! decision=$(pnpm exec tsx scripts/frontend-build-impact.ts --decision 2>/dev/null); then
    print_warn "Unable to determine frontend build impact; running build to stay safe"
    validate_build
    return
  fi

  if [ "$decision" = "skip" ]; then
    print_success "Frontend build skipped (no build-relevant changes detected)"
    return
  fi

  print_info "Frontend build required based on changed files"
  validate_build
}

validate_convex_generated_if_needed() {
  print_info "Checking whether Convex generated freshness is affected..."
  cd "$PROJECT_ROOT"

  local decision
  if ! decision=$(pnpm exec tsx scripts/convex-generated-impact.ts --decision 2>/dev/null); then
    print_warn "Unable to determine Convex generated impact; running freshness check to stay safe"
    validate_convex_generated
    return
  fi

  if [ "$decision" = "skip" ]; then
    print_success "Convex generated freshness skipped (no codegen-relevant changes detected)"
    return
  fi

  print_info "Convex generated freshness required based on changed files"
  validate_convex_generated
}

validate_e2e() {
  print_info "E2E tests (with E2E build)..."
  cd "$PROJECT_ROOT"
  if ! command_exists pnpm; then
    print_error "pnpm not installed; skipping e2e"
    return 1
  fi
  # Build with E2E config (local Convex URL) and run E2E tests
  if ! run_with_timeout "pnpm test:e2e -- --build --max-failures=1"; then
    print_error "E2E tests failed"
    return 1
  fi
  print_success "E2E tests passed"
}

validate_e2e_affected() {
  cd "$PROJECT_ROOT"
  if ! command_exists pnpm; then
    print_error "pnpm not installed; skipping e2e"
    return 1
  fi
  print_info "E2E tests (affected files only)..."
  if ! run_with_timeout "pnpm exec tsx scripts/run-affected-e2e.ts"; then
    print_error "Affected E2E tests failed"
    return 1
  fi
  print_success "Affected E2E tests passed"
}

validate_e2e_llm_affected() {
  cd "$PROJECT_ROOT"
  if ! command_exists claude; then
    print_warn "claude CLI not found; falling back to deterministic affected E2E"
    validate_e2e_affected
    return
  fi

  print_info "Selecting affected E2E specs via Claude (Sonnet)..."
  local specs
  local exit_code=0
  # stdout = spec paths (one per line), stderr = informational messages (shown in terminal)
  specs=$(pnpm exec tsx scripts/select-affected-e2e.ts --print-specs) || exit_code=$?

  if [ "$exit_code" -eq 2 ]; then
    print_warn "Claude selection failed; falling back to deterministic affected E2E"
    validate_e2e_affected
    return
  fi

  if [ -z "$specs" ]; then
    print_success "No affected E2E specs detected"
    return 0
  fi

  local spec_count
  spec_count=$(echo "$specs" | wc -l | tr -d ' ')
  print_info "Running ${spec_count} affected E2E specs..."

  local quoted_specs=()
  while IFS= read -r spec; do
    [ -z "$spec" ] && continue
    quoted_specs+=("$(printf '%q' "$spec")")
  done <<< "$specs"

  if ! run_with_timeout "pnpm test:e2e -- --build --max-failures=1 ${quoted_specs[*]}"; then
    print_error "Affected E2E tests failed"
    return 1
  fi
  print_success "Affected E2E tests passed (${spec_count} specs)"
}


validate_core_checks() {
  # Run lint, typecheck, tests, and static analysis in parallel with fast-fail
  print_info "Running lint, typecheck, tests, and static analysis in parallel (fast-fail)..."
  if ! run_parallel_fast_fail \
    "Realtime usage guard:validate_realtime_guard_inner" \
    "Convex logging:validate_convex_logging_inner" \
    "Lint:validate_lint_inner" \
    "Frontend typecheck:validate_typecheck_frontend_inner" \
    "Convex typecheck:validate_typecheck_convex_inner" \
    "Scripts typecheck:validate_typecheck_scripts_inner" \
    "Shared typecheck:validate_typecheck_shared_inner" \
    "Ops typecheck:validate_typecheck_ops_inner" \
    "Frontend tests:validate_frontend_tests_inner" \
    "Convex tests:validate_convex_tests_inner" \
    "ESLint rule tests:validate_eslint_rule_tests_inner"; then
    return 1
  fi
  validate_convex_generated_if_needed || return 1
  # Build runs after all checks pass
  validate_build_if_needed
}

case "$MODE" in
  lint)
    validate_lint
    ;;

  typecheck)
    validate_typecheck
    ;;
  test)
    validate_tests
    ;;
  build)
    validate_build
    ;;
  e2e)
    validate_e2e
    ;;
  affected)
    validate_e2e_affected
    ;;
  all)
    validate_core_checks || exit 1
    if [ -n "$CI" ]; then
      validate_e2e_affected || exit 1
    else
      validate_e2e_llm_affected || exit 1
    fi
    ;;
  core)
    validate_core_checks || exit 1
    ;;
  full)
    validate_core_checks || exit 1
    # E2E tests build with E2E config (local Convex URL) and run tests
    validate_e2e || exit 1
    ;;
  fast)
    validate_fast
    ;;
  *)
    print_error "Unknown mode: $MODE"
    echo "Usage: $0 [lint|typecheck|test|build|e2e|affected|all|core|full|fast] [timeout_seconds]"
    echo ""
    echo "Modes:"
    echo "  lint       - Run linter only"

    echo "  typecheck  - Run TypeScript type checking only (frontend + convex, parallel)"
    echo "  test       - Run unit tests only (frontend + convex, parallel)"
    echo "  build      - Run build only"
    echo "  e2e        - Build with E2E config and run E2E tests"
    echo "  affected   - Run affected E2E tests only"
    echo "  all        - Run lint + typecheck + tests + build + affected E2E (default, parallel)"
    echo "  core       - Run lint + typecheck + tests + build (parallel)"
    echo "  full       - Run all + E2E tests (parallel)"
    echo "  fast       - Run staged-scope realtime guard + typecheck(s)"
    exit 1
    ;;
 esac

print_success "Validation completed"
exit 0
