import { JsonSchemaValidator } from "./validator.ts";

const validator = new JsonSchemaValidator();

const content = await Deno.readTextFile("test-suite/tests/draft2020-12/anchor.json");
const testGroups = JSON.parse(content);

console.log("=== Analyzing anchor.json failures ===\n");

for (const group of testGroups) {
  let hasFailures = false;
  
  for (const test of group.tests) {
    const result = validator.validate(group.schema, test.data);
    const passed = result.valid === test.valid;
    
    if (!passed) {
      if (!hasFailures) {
        console.log(`--- ${group.description} ---`);
        hasFailures = true;
      }
      console.log(`❌ ${test.description}`);
      console.log(`   Expected: ${test.valid}, Got: ${result.valid}`);
      console.log(`   Schema: ${JSON.stringify(group.schema)}`);
      console.log(`   Data: ${JSON.stringify(test.data)}`);
      if (result.errors.length > 0) {
        console.log(`   Error: ${result.errors[0].message}`);
      }
      console.log();
    }
  }
}