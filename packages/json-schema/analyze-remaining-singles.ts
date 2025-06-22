import { JsonSchemaValidator } from "./validator.ts";

const validator = new JsonSchemaValidator();

// Remaining single-failure files
const singleFailureFiles = [
  "not.json",
  "defs.json", 
  "vocabulary.json"
];

for (const file of singleFailureFiles) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`=== ${file} ===`);
  
  const content = await Deno.readTextFile(`test-suite/tests/draft2020-12/${file}`);
  const testGroups = JSON.parse(content);

  for (const group of testGroups) {
    for (const test of group.tests) {
      const result = validator.validate(group.schema, test.data);
      const passed = result.valid === test.valid;
      
      if (!passed) {
        console.log(`\n❌ ${group.description} > ${test.description}`);
        console.log(`   Expected: ${test.valid}, Got: ${result.valid}`);
        console.log(`   Schema: ${JSON.stringify(group.schema)}`);
        console.log(`   Data: ${JSON.stringify(test.data)}`);
        if (result.errors.length > 0) {
          console.log(`   Error: ${result.errors[0].message}`);
        }
      }
    }
  }
}