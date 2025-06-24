/**
 * Test the JSON Schema processor with a massive real-world OpenAPI spec
 */

import { JsonSchemaProcessor } from "./processor.ts";

async function testMassiveSpec() {
  console.log("Loading massive-real-life-spec.json...");
  const startLoad = performance.now();
  
  const specContent = await Deno.readTextFile("../../massive-real-life-spec.json");
  const spec = JSON.parse(specContent);
  
  const loadTime = performance.now() - startLoad;
  console.log(`Loaded spec in ${loadTime.toFixed(2)}ms`);
  console.log(`Spec size: ${(specContent.length / 1024 / 1024).toFixed(2)}MB`);
  
  // Extract all schemas from the OpenAPI spec
  const schemas: Record<string, unknown> = {};
  let schemaCount = 0;
  
  // Components schemas
  if (spec.components?.schemas) {
    Object.assign(schemas, spec.components.schemas);
    schemaCount += Object.keys(spec.components.schemas).length;
  }
  
  // Path schemas
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem as any)) {
      if (method === "parameters" || method.startsWith("x-")) continue;
      
      // Request body schemas
      const requestBody = (operation as any).requestBody;
      if (requestBody?.content) {
        for (const [contentType, mediaType] of Object.entries(requestBody.content)) {
          if ((mediaType as any).schema) {
            schemas[`${path}_${method}_request_${contentType}`] = (mediaType as any).schema;
            schemaCount++;
          }
        }
      }
      
      // Response schemas
      const responses = (operation as any).responses;
      if (responses) {
        for (const [statusCode, response] of Object.entries(responses)) {
          if ((response as any).content) {
            for (const [contentType, mediaType] of Object.entries((response as any).content)) {
              if ((mediaType as any).schema) {
                schemas[`${path}_${method}_${statusCode}_${contentType}`] = (mediaType as any).schema;
                schemaCount++;
              }
            }
          }
        }
      }
    }
  }
  
  console.log(`\nFound ${schemaCount} schemas to process`);
  
  // Process schemas with the new processor
  const processor = new JsonSchemaProcessor();
  let processedCount = 0;
  let failedCount = 0;
  const errors: Array<{ name: string; error: string }> = [];
  
  console.log("\nProcessing schemas...");
  const startProcess = performance.now();
  
  for (const [name, schema] of Object.entries(schemas)) {
    try {
      const result = await processor.process(schema);
      if (result.valid) {
        processedCount++;
      } else {
        failedCount++;
        errors.push({
          name,
          error: result.errors[0]?.message || "Unknown error",
        });
      }
    } catch (error) {
      failedCount++;
      errors.push({
        name,
        error: error.message,
      });
    }
    
    // Progress indicator
    if ((processedCount + failedCount) % 100 === 0) {
      process.stdout.write(".");
    }
  }
  
  const processTime = performance.now() - startProcess;
  
  console.log("\n\n=== Results ===");
  console.log(`Total schemas: ${schemaCount}`);
  console.log(`Successfully processed: ${processedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Processing time: ${(processTime / 1000).toFixed(2)}s`);
  console.log(`Average time per schema: ${(processTime / schemaCount).toFixed(2)}ms`);
  
  // Memory usage
  if (Deno.memoryUsage) {
    const memory = Deno.memoryUsage();
    console.log(`\nMemory usage:`);
    console.log(`  RSS: ${(memory.rss / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Heap Used: ${(memory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  Heap Total: ${(memory.heapTotal / 1024 / 1024).toFixed(2)}MB`);
  }
  
  if (errors.length > 0) {
    console.log("\n=== First 10 errors ===");
    for (const error of errors.slice(0, 10)) {
      console.log(`\n${error.name}:`);
      console.log(`  ${error.error}`);
    }
  }
  
  return {
    success: failedCount === 0,
    processedCount,
    failedCount,
    totalTime: processTime,
  };
}

// Run if this file is executed directly
if (import.meta.main) {
  try {
    const result = await testMassiveSpec();
    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error("Fatal error:", error);
    Deno.exit(1);
  }
}