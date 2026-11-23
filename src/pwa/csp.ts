/** Build the production policy without depending on Vite or the browser. */
export function buildCsp(supabaseUrl?: string): string {
  const connections = [
    "'self'",
    "https://www.youtube.com",
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
  ];

  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      if (url.protocol === "https:" || url.protocol === "http:") {
        connections.push(url.origin);
        const realtime = new URL(url.origin);
        realtime.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        connections.push(realtime.origin);
      }
    } catch {
      // Invalid configuration must not add an untrusted policy source.
    }
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://i.ytimg.com",
    `connect-src ${connections.join(" ")}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
