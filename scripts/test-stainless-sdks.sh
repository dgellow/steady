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
  if [ -x "./scripts/bootstrap" ]; then
    log "  Running bootstrap..."
    ./scripts/bootstrap 2>&1 | tail -5 || { warn "  Bootstrap failed"; }
  fi

  # Create mock script that uses Steady
  cat > "./scripts/mock" << MOCK_EOF
#!/usr/bin/env bash
set -e
cd "\$(dirname "\$0")/.."

# Get spec from argument, local file, or .stats.yml URL
if [[ -n "\$1" && "\$1" != '--'* ]]; then
  SPEC="\$1"
  shift
elif [ -f "openapi-spec.yml" ]; then
  SPEC="\$PWD/openapi-spec.yml"
else
  SPEC="\$(grep 'openapi_spec_url' .stats.yml | cut -d' ' -f2)"
fi

if [ -z "\$SPEC" ]; then
  echo "Error: No OpenAPI spec found"
  exit 1
fi

echo "==> Starting Steady mock server with spec \${SPEC}"

# Run steady mock server on port 4010
if [ "\$1" == "--daemon" ]; then
  deno task --cwd "$STEADY_DIR" start --port 4010 "\$SPEC" &> .steady.log &
  echo -n "Waiting for server"
  for i in {1..50}; do
    if curl --silent "http://localhost:4010" >/dev/null 2>&1; then
      echo " ready!"
      exit 0
    fi
    echo -n "."
    sleep 0.2
  done
  echo
  echo "Timeout waiting for server. Log:"
  cat .steady.log
  exit 1
else
  deno task --cwd "$STEADY_DIR" start --port 4010 "\$SPEC"
fi
MOCK_EOF
  chmod +x "./scripts/mock"

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
      ./scripts/test "$test_file" -x -q --tb=line 2>&1 | tee "$sdk_path/.test-output.log" | tail -20

      # Check for failures in order of priority
      if grep -qi "ModuleNotFoundError\|ImportError" "$sdk_path/.test-output.log"; then
        test_result=1
      elif grep -q " failed" "$sdk_path/.test-output.log"; then
        test_result=1
      elif grep -q " passed" "$sdk_path/.test-output.log" && ! grep -q " failed" "$sdk_path/.test-output.log"; then
        test_result=0
      else
        test_result=1
      fi

      # Review Steady logs for any issues
      if [ -f "$sdk_path/.steady.log" ]; then
        log "  Steady server log:"
        # Show errors or last few lines
        if grep -q "ERROR\|Error\|error:" "$sdk_path/.steady.log"; then
          grep -i "error" "$sdk_path/.steady.log" | head -10
        else
          tail -5 "$sdk_path/.steady.log"
        fi
      fi
    else
      warn "  No test files found"
      test_result=1
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

# Format: "github_org/repo_name:local_name" (local_name optional, defaults to repo_name)
SDKS=(
  # AI/LLM providers
  "openai/openai-python"
  "anthropics/anthropic-sdk-python"
  "groq/groq-python"
  "Cerebras/cerebras-cloud-sdk-python"
  "meta-llama/llama-stack-client-python"
  "perplexityai/perplexity-py"
  # Infrastructure
  "cloudflare/cloudflare-python"
  "browserbase/sdk-python:browserbase-python"
  # Fintech
  "lithic-com/lithic-python"
  "Modern-Treasury/modern-treasury-python"
  "Finch-API/finch-api-python"
  "orbcorp/orb-python"
  # Other
  "writer/writer-python"
  "knocklabs/knock-python"
)

for entry in "${SDKS[@]}"; do
  repo="${entry%%:*}"
  local_name="${entry##*:}"
  [ "$local_name" = "$entry" ] && local_name=$(basename "$repo")
  if [ ! -d "$local_name" ]; then
    log "Cloning $repo as $local_name..."
    git clone --depth 1 "https://github.com/$repo.git" "$local_name" 2>/dev/null || warn "Failed to clone $repo"
  fi
done

echo
log "Running tests..."
echo

# Test each SDK
SDK_NAMES=(
  # AI/LLM providers
  openai-python
  anthropic-sdk-python
  groq-python
  cerebras-cloud-sdk-python
  llama-stack-client-python
  perplexity-py
  # Infrastructure
  cloudflare-python
  browserbase-python
  # Fintech
  lithic-python
  modern-treasury-python
  finch-api-python
  orb-python
  # Other
  writer-python
  knock-python
)

for sdk in "${SDK_NAMES[@]}"; do
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
