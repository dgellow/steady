import { JsonSchemaValidator } from "./validator.ts";

const validator = new JsonSchemaValidator();

const testFiles = [
  "additionalProperties.json",
  "allOf.json",
  "anchor.json",
  "anyOf.json",
  "boolean_schema.json",
  "const.json",
  "contains.json",
  "content.json",
  "default.json",
  "defs.json",
  "dependentRequired.json",
  "dependentSchemas.json",
  "dynamicRef.json",
  "enum.json",
  "exclusiveMaximum.json",
  "exclusiveMinimum.json",
  "format.json",
  "if-then-else.json",
  "infinite-loop-detection.json",
  "items.json",
  "maxContains.json",
  "maxItems.json",
  "maxLength.json",
  "maxProperties.json",
  "maximum.json",
  "minContains.json",
  "minItems.json",
  "minLength.json",
  "minProperties.json",
  "minimum.json",
  "multipleOf.json",
  "not.json",
  "oneOf.json",
  "pattern.json",
  "patternProperties.json",
  "prefixItems.json",
  "properties.json",
  "propertyNames.json",
  "ref.json",
  "refRemote.json",
  "required.json",
  "type.json",
  "unevaluatedItems.json",
  "unevaluatedProperties.json",
  "uniqueItems.json",
  "vocabulary.json"
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

for (const file of testFiles) {
  try {
    const content = await Deno.readTextFile(`test-suite/tests/draft2020-12/${file}`);
    const testGroups = JSON.parse(content);
    
    for (const group of testGroups) {
      for (const test of group.tests) {
        totalTests++;
        
        const result = validator.validate(group.schema, test.data);
        const passed = result.valid === test.valid;
        
        if (passed) {
          passedTests++;
        } else {
          failedTests++;
        }
      }
    }
  } catch (error) {
    console.error(`Error processing ${file}:`, error.message);
  }
}

const percentage = ((passedTests / totalTests) * 100).toFixed(1);

console.log(`\n=== Test Suite Results ===`);
console.log(`Total tests: ${totalTests}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);
console.log(`Pass rate: ${percentage}%`);

// List failures by file
console.log(`\n=== Failures by file ===`);
for (const file of testFiles) {
  try {
    const content = await Deno.readTextFile(`test-suite/tests/draft2020-12/${file}`);
    const testGroups = JSON.parse(content);
    
    let fileFailures = 0;
    for (const group of testGroups) {
      for (const test of group.tests) {
        const result = validator.validate(group.schema, test.data);
        const passed = result.valid === test.valid;
        if (!passed) fileFailures++;
      }
    }
    
    if (fileFailures > 0) {
      console.log(`${file}: ${fileFailures} failures`);
    }
  } catch (error) {
    // Skip
  }
}