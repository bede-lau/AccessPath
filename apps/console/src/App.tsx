import { SCHEMA_VERSION } from "@accesspath/contracts";
import type { ErrorResponse } from "@accesspath/contracts";

/**
 * Placeholder for future API error rendering. Uses the contracts type-only
 * import to prove the dependency boundary: console imports
 * @accesspath/contracts and nothing else from the workspace.
 */
function describeError(response: ErrorResponse | null): string | null {
  if (response === null) {
    return null;
  }
  return `${response.error.code}: ${response.error.message}`;
}

export function App() {
  // No API calls exist yet in the foundation phase; always null for now.
  const errorText = describeError(null);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header>
        <p className="product-name">AccessPath</p>
      </header>
      <main id="main-content" tabIndex={-1}>
        <h1>AccessPath Console</h1>
        <p>
          Foundation phase — contracts schema version {SCHEMA_VERSION}.
        </p>
        {errorText !== null && <p role="alert">{errorText}</p>}
      </main>
    </>
  );
}
