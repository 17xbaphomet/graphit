import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg">
      <div className="w-full max-w-sm">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-subtle">
          Graphit
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-display">Anmelden</h1>
        <p className="mt-2 text-sm text-muted">
          Optional. Die Animation läuft auch ohne Konto.
        </p>
        <div className="mt-8 flex flex-col gap-2">
          {authEnabled ? (
            GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              >
                Weiter mit {p.label}
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted">Anmeldung ist deaktiviert.</p>
          )}
        </div>
        <Link
          to="/"
          className="mt-6 inline-block text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          Zurück zum Studio
        </Link>
      </div>
    </main>
  );
}
