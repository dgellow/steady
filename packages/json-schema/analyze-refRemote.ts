import { JsonSchemaValidator } from "./validator.ts";

const validator = new JsonSchemaValidator();

const content = await Deno.readTextFile("test-suite/tests/draft2020-12/refRemote.json");
const testGroups = JSON.parse(content);

console.log("=== Analyzing refRemote.json failures (first 3 groups) ===\n");

let groupCount = 0;
for (const group of testGroups) {
  if (groupCount >= 3) break;
  
  let hasFailures = false;
  
  for (const test of group.tests) {
    const result = validator.validate(group.schema, test.data);
    const passed = result.valid === test.valid;
    
    if (!passed) {
      if (!hasFailures) {
        console.log(`--- ${group.description} ---`);
        hasFailures = true;
      }
      console.log(`\n❌ ${test.description}`);
      console.log(`   Expected: ${test.valid}, Got: ${result.valid}`);
      console.log(`   Schema: ${JSON.stringify(group.schema)}`);
      console.log(`   Data: ${JSON.stringify(test.data)}`);
      if (result.errors.length > 0) {
        console.log(`\n   Error:\n${result.errors[0].message.split('\n').map(line => '   ' + line).join('\n')}`);
      }
    }
  }
  
  if (hasFailures) {
    console.log("\n" + "=".repeat(60) + "\n");
    groupCount++;
  }
}