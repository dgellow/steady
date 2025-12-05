#!/usr/bin/env bash
# Test Steady against multiple Stainless-generated SDKs
set -e

STEADY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="$STEADY_DIR/sdk-tests"
PORT=4010
RESULTS=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Source rye
source "$HOME/.rye/env" 2>/dev/null || true

cleanup() {
  lsof -ti:$PORT 2>/dev/null | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT

log() { echo -e "${BLUE}==>${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

# Test a single SDK
test_sdk() {
  local sdk_name="$1"
  local sdk_path="$SDK_DIR/$sdk_name"

  if [ ! -d "$sdk_path" ]; then
    warn "SDK not found: $sdk_name"
    return 1
  fi

  log "Testing $sdk_name"

  # Get spec URL or local file
  local spec=""
  if [ -f "$sdk_path/openapi-spec.yml" ]; then
    spec="$sdk_path/openapi-spec.yml"
  elif [ -f "$sdk_path/.stats.yml" ]; then
    local url=$(grep 'openapi_spec_url' "$sdk_path/.stats.yml" | cut -d' ' -f2)
    if [ -n "$url" ]; then
      log "  Downloading spec..."
      curl -s -o "$sdk_path/openapi-spec.yml" "$url" || { fail "  Failed to download spec"; return 1; }
      spec="$sdk_path/openapi-spec.yml"
    fi
  fi

  if [ -z "$spec" ] || [ ! -f "$spec" ]; then
    fail "  No spec found"
    return 1
  fi

  success "  Spec ready"

  # Kill any existing server on the port
  cleanup

  # Setup Python venv using SDK's bootstrap script
  cd "$sdk_path"
  if [ ! -d ".venv" ] && [ -x "./scripts/bootstrap" ]; then
    log "  Running bootstrap..."
    ./scripts/bootstrap 2>&1 | tail -5 || { warn "  Bootstrap failed"; }
  fi

  # Copy our mock script to use Steady
  if [ -f "$STEADY_DIR/openai-python/scripts/mock" ]; then
    cp "$STEADY_DIR/openai-python/scripts/mock" "./scripts/mock"
  fi

  # Run tests using SDK's test script
  local test_result=0
  if [ -x "./scripts/test" ]; then
    log "  Running ./scripts/test..."

    # Find a simple test file
    local test_file="tests/api_resources/test_models.py"
    if [ ! -f "$test_file" ]; then
      test_file=$(ls tests/api_resources/test_*.py 2>/dev/null | head -1)
    fi

    if [ -n "$test_file" ]; then
      log "  Test file: $test_file"
      if ./scripts/test "$test_file" -x -q --tb=line 2>&1 | tee "$sdk_path/.test-output.log" | tail -15; then
        if grep -q "passed" "$sdk_path/.test-output.log"; then
          test_result=0
        elif grep -q "failed\|error" "$sdk_path/.test-output.log"; then
          test_result=1
        fi
      else
        test_result=1
      fi
    else
      warn "  No test files found"
    fi
  else
    warn "  No ./scripts/test found"
  fi

  # Cleanup any remaining mock server
  cleanup

  if [ $test_result -eq 0 ]; then
    success "  $sdk_name passed"
    RESULTS+=("$sdk_name: PASS")
  else
    fail "  $sdk_name failed"
    RESULTS+=("$sdk_name: FAIL")
  fi

  return $test_result
}

# Main
log "Steady SDK Compatibility Test Runner"
echo

# Clone SDKs if not present
mkdir -p "$SDK_DIR"
cd "$SDK_DIR"

SDKS=(
  "openai/openai-python"
  "anthropics/anthropic-sdk-python"
  "cloudflare/cloudflare-python"
  "lithic-com/lithic-python"
  "Modern-Treasury/modern-treasury-python"
  "Finch-API/finch-api-python"
)

for repo in "${SDKS[@]}"; do
  name=$(basename "$repo")
  if [ ! -d "$name" ]; then
    log "Cloning $repo..."
    git clone --depth 1 "https://github.com/$repo.git" 2>/dev/null || warn "Failed to clone $repo"
  fi
done

echo
log "Running tests..."
echo

# Test each SDK
for sdk in openai-python anthropic-sdk-python cloudflare-python lithic-python modern-treasury-python finch-api-python; do
  test_sdk "$sdk" || true
  echo
done

# Summary
echo
log "Summary"
echo "========"
for result in "${RESULTS[@]}"; do
  if [[ "$result" == *"PASS"* ]]; then
    success "$result"
  else
    fail "$result"
  fi
done
