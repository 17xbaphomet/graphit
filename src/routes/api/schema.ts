import { createFileRoute } from "@tanstack/react-router";
import { GRAPHIT_JSON_SCHEMA, jsonResponse, optionsResponse } from "@/lib/graphite/llm-docs";

export const Route = createFileRoute("/api/schema")({
  server: {
    handlers: {
      OPTIONS: () => optionsResponse(),
      GET: () => jsonResponse(GRAPHIT_JSON_SCHEMA),
    },
  },
});
