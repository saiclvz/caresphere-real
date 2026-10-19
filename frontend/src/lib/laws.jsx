/** Official text of RA 11642 (Lawphil). Section 39 is the confidentiality provision for adoption records. */
export const RA11642_URL = 'https://lawphil.net/statutes/repacts/ra2022/ra_11642_2022.html';

/** "RA 11642 Section 39" as a link to the official text, opened in a new tab. */
export function RA11642Sec39() {
  return (
    <a href={RA11642_URL} target="_blank" rel="noopener noreferrer"
      className="font-semibold underline decoration-1 underline-offset-2 hover:decoration-2 focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-red-600">
      RA 11642 Section 39<span className="sr-only"> (opens the official law text in a new tab)</span>
    </a>
  );
}
