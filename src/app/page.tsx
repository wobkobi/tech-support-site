// src/app/page.tsx
/**
 * @file page.tsx
 * @description
 * Home page. Marketing or intro content with a link to the booking flow.
 */

/**
 * Home page component
 * @returns The Home page React element.
 */
export default function Home(): React.ReactElement {
  return (
    <main>
      <h1>Welcome to Tech Support</h1>
      <p>Your one-stop solution for all tech-related issues.</p>
      <a href="/booking">Book a Support Session</a>
    </main>
  );
}
