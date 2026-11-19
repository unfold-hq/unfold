/** An MCP icon (protocol 2025-11-25 and later): an image a client may show beside the server or a tool. */
export type McpIcon = { src: string; mimeType: 'image/png'; sizes: string[]; theme: 'light' | 'dark' };

/**
 * Unfold's mark as MCP icons, served by the Unfold instance at `origin`: the favicon cut in the light and in the night
 * palette. PNG, because VS Code 1.147 shows only raster MCP icons, and fetched from the MCP server's own origin, because
 * VS Code fetches an http(s) icon only from the authority it connected to.
 */
export function unfoldMcpIcons(origin: string): McpIcon[] {
  const at = (path: string) => new URL(path, origin).href;
  return [
    { src: at('/favicon-32x32.png'), mimeType: 'image/png', sizes: ['32x32'], theme: 'light' },
    { src: at('/favicon-dark-32x32.png'), mimeType: 'image/png', sizes: ['32x32'], theme: 'dark' },
  ];
}
