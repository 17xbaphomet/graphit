import { createFileRoute } from "@tanstack/react-router";
import { graphitLlmsTxt, optionsResponse, textResponse } from "@/lib/graphite/llm-docs";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      OPTIONS: () => optionsResponse(),
      GET: ({ request }) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        return textResponse(graphitLlmsTxt(origin), "text/markdown");
      },
    },
  },
});
