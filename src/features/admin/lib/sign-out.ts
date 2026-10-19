// src/features/admin/lib/sign-out.ts
// Admin sign-out. Client-only.

/** The two router methods sign-out needs (a subset of useRouter()'s instance). */
interface SignOutRouter {
  push: (href: string) => void;
  refresh: () => void;
}

/**
 * Clears the session cookie, then navigates to /admin/login. Errors are swallowed.
 * @param router - The App Router instance from useRouter().
 */
export async function signOut(router: SignOutRouter): Promise<void> {
  try {
    await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    /* ignore - redirect still happens */
  }
  router.push("/admin/login");
  router.refresh();
}
