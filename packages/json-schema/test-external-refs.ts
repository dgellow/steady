import { JsonSchemaValidator } from "./validator.ts";

const validator = new JsonSchemaValidator();

// Test various external reference types
const testCases = [
  {
    name: "HTTP URL reference",
    schema: {
      "$ref": "http://json-schema.org/draft/2020-12/schema"
    },
    data: {}
  },
  {
    name: "HTTPS URL with fragment",
    schema: {
      "$ref": "https://example.com/schemas/user.json#/definitions/name"
    },
    data: "test"
  },
  {
    name: "Relative path reference",
    schema: {
      "$ref": "../common/base.json"
    },
    data: {}
  },
  {
    name: "File protocol reference",
    schema: {
      "$ref": "file:///home/user/schemas/test.json"
    },
    data: {}
  },
  {
    name: "Relative ID reference",
    schema: {
      "$ref": "definitions#/address"
    },
    data: {}
  }
];

console.log("=== Testing External Reference Error Messages ===\n");

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  console.log(`Schema: ${JSON.stringify(testCase.schema)}`);
  
  const result = validator.validate(testCase.schema, testCase.data);
  
  if (!result.valid && result.errors.length > 0) {
    console.log("\nError message:");
    console.log(result.errors[0].message);
  } else {
    console.log("Result: Valid (unexpected)");
  }
  
  console.log("\n" + "=".repeat(60) + "\n");
}