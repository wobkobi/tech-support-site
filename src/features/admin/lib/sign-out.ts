// src/features/admin/lib/sign-out.ts
// Admin sign-out shared by the sidebar footer and the top bar. Client-only: it calls
// fetch and drives the App Router.

/** The two router methods sign-out needs (a subset of useRouter()'s instance). */
interface SignOutRouter {
  push: (href: string) => void;
  refresh: () => void;
}

/**
 * Signs the operator out by clearing the session cookie on the server, then
 * navigates to /admin/login. Errors are swallowed - the cookie either clears or
 * the redirect itself ends the session client-side.
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
