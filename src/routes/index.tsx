import { createFileRoute } from "@tanstack/react-router";
import { Studio } from "@/components/studio";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Studio />
    </div>
  );
}
