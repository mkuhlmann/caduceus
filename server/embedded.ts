/**
 * The built frontend by URL path (`index.html`, `assets/…`), for builds that carry it inside the
 * executable: the desktop app fills this in before the first request. Everywhere else it stays
 * empty and the server reads `dist/` from disk.
 */
export const embedded = new Map<string, string>()
