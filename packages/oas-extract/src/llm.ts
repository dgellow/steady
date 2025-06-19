import { load } from "@std/dotenv";
import type { LLMBatch, LLMResponse, SchemaContext } from "./types.ts";

export class GeminiClient {
  private apiKey: string;
  private baseUrl =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || "";
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      // Load from .env in the package directory
      try {
        const packageDir = new URL("../", import.meta.url).pathname;
        const env = await load({ envPath: `${packageDir}.env` });
        this.apiKey = env.GEMINI_API_KEY || "";
      } catch {
        // Fallback to current directory .env
        try {
          const env = await load();
          this.apiKey = env.GEMINI_API_KEY || "";
        } catch {
          // Fallback to environment variable
          this.apiKey = Deno.env.get("GEMINI_API_KEY") || "";
        }
      }
    }

    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY not found in environment or .env file");
    }
  }

  async makeStructuredRequest(requestBody: any): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(
          `Gemini API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      const text = data.candidates[0]?.content?.parts[0]?.text;

      if (!text) {
        throw new Error("No response from Gemini");
      }

      // With structured output, the response should be valid JSON
      return JSON.parse(text);
    } catch (error) {
      console.error("Structured LLM request failed:", error);
      throw error;
    }
  }

  async generateNames(batch: LLMBatch): Promise<LLMResponse> {
    const prompt = this.buildPrompt(batch);

    try {
      const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt,
            }],
          }],
          generationConfig: {
            temperature: 0.3,
            topK: 1,
            topP: 1,
            maxOutputTokens: 2048,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Gemini API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      const text = data.candidates[0]?.content?.parts[0]?.text;

      if (!text) {
        throw new Error("No response from Gemini");
      }

      // Parse JSON from response
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : text;

      try {
        const suggestions = JSON.parse(jsonStr);
        return {
          batchId: batch.id,
          suggestions,
        };
      } catch (e) {
        console.error("Failed to parse LLM response:", text);
        throw new Error("Invalid JSON response from LLM");
      }
    } catch (error) {
      console.error("LLM request failed:", error);
      throw error;
    }
  }

  private buildPrompt(batch: LLMBatch): string {
    const domainContext = batch.domainHints.length > 0
      ? `API Domain: ${batch.domainHints.join(", ")}`
      : "General API";

    const schemaDescriptions = batch.schemas.map((ctx, index) => {
      const schemaPreview = this.getSchemaPreview(ctx.schema);
      return `
${index + 1}. Path: ${ctx.path}
   Method: ${ctx.method || "N/A"}
   Location: ${ctx.location}
   Operation ID: ${ctx.operationId || "none"}
   Resource: ${ctx.resourceName || "unknown"}
   Schema Preview: ${schemaPreview}`;
    }).join("\n");

    return `You are extracting inline schemas from an OpenAPI specification and need to generate meaningful, descriptive names for them.

Context:
- ${domainContext}
- Resource Group: ${batch.resourceGroup}

Guidelines for naming:
1. Use PascalCase for all names
2. For request bodies: {Resource}{Method}Request (e.g., UserCreateRequest)
3. For responses: {Resource}{Method}Response or {Resource} if it's a simple GET
4. For nested objects: {Parent}{Property} (e.g., UserAddress, ProductMetadata)
5. For array items: {Parent}Item or just the singular form if obvious
6. Avoid generic names like "Data", "Object", "Response0"
7. Use domain-specific terms when apparent (e.g., AWSCredentials not AwsCredentials)
8. Keep names concise but descriptive

Schemas to name:
${schemaDescriptions}

Return a JSON object mapping schema numbers to naming suggestions:
\`\`\`json
{
  "1": {
    "name": "SuggestedSchemaName",
    "reasoning": "Brief explanation of the name choice"
  },
  "2": {
    "name": "AnotherSchemaName", 
    "reasoning": "Why this name was chosen"
  }
}
\`\`\`

Only return the JSON object, nothing else.`;
  }

  private getSchemaPreview(schema: any): string {
    if (schema.type === "object" && schema.properties) {
      const props = Object.keys(schema.properties).slice(0, 5).join(", ");
      const more = Object.keys(schema.properties).length > 5 ? "..." : "";
      return `object { ${props}${more} }`;
    }

    if (schema.type === "array" && schema.items) {
      return `array of ${this.getSchemaPreview(schema.items)}`;
    }

    if (schema.type) {
      return schema.type;
    }

    if (schema.allOf || schema.oneOf || schema.anyOf) {
      const type = schema.allOf ? "allOf" : schema.oneOf ? "oneOf" : "anyOf";
      return `${type} composite`;
    }

    return "unknown";
  }
}
