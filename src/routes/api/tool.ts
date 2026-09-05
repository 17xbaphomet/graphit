import { createFileRoute } from "@tanstack/react-router";
import { GRAPHIT_TOOL, jsonResponse, optionsResponse } from "@/lib/graphite/llm-docs";

export const Route = createFileRoute("/api/tool")({
  server: {
    handlers: {
      OPTIONS: () => optionsResponse(),
      GET: () => jsonResponse(GRAPHIT_TOOL),
    },
  },
});
