import { Link } from "@tanstack/react-router";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export function AuthSlot() {
  const { user, isPending } = useCurrentUserState();

  if (isPending) {
    return <div className="h-9 w-24 animate-pulse rounded-md bg-raised" />;
  }

  if (!user) {
    return (
      <Link
        to="/login"
        className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted transition-colors hover:text-fg"
      >
        Anmelden
      </Link>
    );
  }

  const label = user.displayName ?? user.primaryEmail ?? "Konto";

  return (
    <div className="flex items-center gap-2">
      {user.profileImageUrl ? (
        <img
          src={user.profileImageUrl}
          alt=""
          className="size-7 rounded-full object-cover"
        />
      ) : (
        <span className="grid size-7 place-items-center rounded-full bg-raised text-xs font-medium text-fg">
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="hidden max-w-28 truncate text-sm text-muted sm:inline">
        {label}
      </span>
      {authEnabled && (
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-sm text-subtle underline-offset-4 hover:text-fg hover:underline"
        >
          Abmelden
        </button>
      )}
    </div>
  );
}
