#!/bin/bash
# Run all naming stability experiments

echo "==================================="
echo "Naming Strategy Stability Experiments"
echo "==================================="
echo ""
echo "This will run all tests in sequence."
echo "Make sure you have datadog-openapi.json in test-data/"
echo ""
echo "Press Enter to continue or Ctrl+C to cancel..."
read

# Change to test scripts directory
cd test-scripts

# Run each test
echo "Running baseline performance test..."
./01-baseline-performance.sh
echo -e "\n\n"

echo "Running optimized performance test..."
./02-optimized-performance.sh
echo -e "\n\n"

echo "Running strategy comparison (this takes ~5 minutes)..."
./03-strategy-comparison.sh
echo -e "\n\n"

echo "Running consistency test..."
./04-consistency-test.sh
echo -e "\n\n"

echo "Running batch size impact test..."
./05-batch-size-impact.sh
echo -e "\n\n"

echo "==================================="
echo "All tests complete!"
echo "Check the results in:"
echo "- test-scripts/*.json (output files)"
echo "- test-scripts/strategy-comparison-report.md"
echo "==================================="