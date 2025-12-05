#!/bin/bash

# Test script for Steady interactive mode
# Runs various requests to demonstrate logging capabilities

echo "🧪 Running test requests for Steady..."
echo "Make sure Steady is running with: steady -i tests/specs/test-recursive.yaml"
echo ""

# Basic successful requests
echo "1. Basic GET request"
curl -s http://localhost:3000/simple
echo -e "\n"

echo "2. GET with query parameters (will fail validation)"
curl -s "http://localhost:3000/simple?name=john&age=30&extra=param"
echo -e "\n"

echo "3. Recursive tree structure"
curl -s http://localhost:3000/tree
echo -e "\n"

echo "4. Person with circular references"
curl -s http://localhost:3000/person
echo -e "\n"

# Error cases
echo "5. Non-existent path"
curl -s http://localhost:3000/users/123
echo -e "\n"

echo "6. Wrong HTTP method"
curl -s -X POST http://localhost:3000/simple
echo -e "\n"

echo "7. Another wrong method"
curl -s -X DELETE http://localhost:3000/person
echo -e "\n"

# With headers
echo "8. Request with authorization header"
curl -s -H "Authorization: Bearer my-secret-token" http://localhost:3000/simple
echo -e "\n"

echo "9. Request with multiple headers"
curl -s -H "X-API-Key: abc123" -H "X-Request-ID: req-789" -H "Accept: application/json" http://localhost:3000/tree
echo -e "\n"

# More query parameter tests
echo "10. Single unknown query param"
curl -s "http://localhost:3000/tree?filter=active"
echo -e "\n"

echo "11. Multiple unknown query params"
curl -s "http://localhost:3000/person?include=spouse&include=friends&depth=2&format=detailed"
echo -e "\n"

# Special endpoints
echo "12. Health check endpoint"
curl -s http://localhost:3000/_x-steady/health
echo -e "\n"

echo "13. OpenAPI spec endpoint"
curl -s http://localhost:3000/_x-steady/spec | head -20
echo -e "\n"

# More error scenarios
echo "14. Path with trailing slash"
curl -s http://localhost:3000/simple/
echo -e "\n"

echo "15. OPTIONS request"
curl -s -X OPTIONS http://localhost:3000/simple
echo -e "\n"

echo "16. HEAD request"
curl -s -I http://localhost:3000/person
echo -e "\n"

# Complex paths (if they existed)
echo "17. Path that looks like it has params"
curl -s http://localhost:3000/users/john/posts/123
echo -e "\n"

echo "18. Very long query string"
curl -s "http://localhost:3000/simple?param1=value1&param2=value2&param3=value3&param4=value4&param5=value5&param6=value6&param7=value7&param8=value8&param9=value9&param10=value10"
echo -e "\n"

# Final requests
echo "19. Repeated request to test consistency"
curl -s http://localhost:3000/simple
echo -e "\n"

echo "20. Final request with timing"
time curl -s http://localhost:3000/tree > /dev/null
echo -e "\n"

echo "✅ Test requests completed!"
echo "Check the interactive logger to explore request details"