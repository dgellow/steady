# LLM Naming Determinism Research

This directory contains a systematic investigation into the determinism and
performance characteristics of LLM-based semantic naming for OpenAPI schema
extraction.

## Structure

The research is organized as follows:

`README.md` presents the complete research paper including methodology, results,
and analysis. Start here for a comprehensive understanding of the findings.

`CONCLUSIONS.md` distills practical implications and configuration
recommendations from the research. Consult this for immediate application to
production systems.

`test-scripts/` contains reproducible experiments that demonstrate the findings.
Execute these to verify results or test new hypotheses.

`results/` documents the actual outputs from our experimental runs, including
performance metrics and naming variations.

`test-data/` houses the input specifications used in testing, primarily the
Datadog OpenAPI specification with 3,294 schemas.

## Key Finding

Temperature=0 is the only setting that provides deterministic outputs from LLMs.
Even temperature=0.2 produces only 32.8% consistency across runs. This finding
has significant implications for any production system relying on LLMs for
reproducible outputs.

## Running the Experiments

To reproduce our findings:

1. Place the Datadog OpenAPI specification in `test-data/datadog-openapi.json`
2. Execute `./run-all-tests.sh` from this directory
3. Review generated reports in `test-scripts/` and `results/`

The experiments take approximately 10-15 minutes to complete, depending on
network conditions and API rate limits.
