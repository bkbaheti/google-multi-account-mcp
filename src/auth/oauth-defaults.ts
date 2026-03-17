// Default OAuth credentials for the published MCP Google server.
// These are intentionally embedded — this is a "Desktop app" OAuth client
// where Google's security model does not rely on client secret confidentiality.
// Same pattern used by gcloud CLI, GitHub CLI, and VS Code.
//
// Users can override with env vars (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
// or config file (~/.config/mcp-google/config.json oauth field).
export const DEFAULT_OAUTH_CLIENT_ID =
  '162760119336-lvkrke1g3kne3pe4jb8trb1gu6ik7sbi.apps.googleusercontent.com';
export const DEFAULT_OAUTH_CLIENT_SECRET = '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';
