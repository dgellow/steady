#!/bin/bash
# Test consistency of different strategies on simple schema

echo "=== Consistency Test ==="
echo "Testing naming consistency across multiple runs"
echo ""

# Create a simple test schema if it doesn't exist
if [ ! -f "../test-data/simple-test.json" ]; then
  cat > ../test-data/simple-test.json << 'EOF'
{
  "openapi": "3.0.0",
  "info": {
    "title": "Test API",
    "version": "1.0.0"
  },
  "paths": {
    "/users": {
      "get": {
        "responses": {
          "200": {
            "description": "List users",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {"type": "string"},
                          "name": {"type": "string"},
                          "email": {"type": "string"}
                        }
                      }
                    },
                    "page": {"type": "number"},
                    "total": {"type": "number"}
                  }
                }
              }
            }
          },
          "400": {
            "description": "Bad request",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {"type": "string"},
                    "message": {"type": "string"}
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
EOF
fi

# Test each strategy multiple times
for strategy in deterministic low-variance adaptive multi-sample; do
  echo ""
  echo "Testing $strategy strategy..."
  
  for i in 1 2 3; do
    echo "  Run $i..."
    deno run --allow-read --allow-write --allow-net --allow-env \
      ../../../cmd/oas-extract.ts extract \
      ../test-data/simple-test.json \
      --strategy $strategy \
      -o ${strategy}-run${i}.json 2>&1 | grep "Extracted"
    
    # Show the generated schema names
    echo -n "    Names: "
    jq -r '.components.schemas | keys | join(", ")' ${strategy}-run${i}.json 2>/dev/null || echo "ERROR"
  done
done

echo ""
echo "Check the variations in names above"