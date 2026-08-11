export {
  AccountStore,
  createTokenStorage,
  type TokenData,
  type TokenStorage,
} from './auth/index.js';
export {
  CAPABILITIES,
  type Capability,
  type CapabilityGate,
  capabilitiesOf,
  isCapability,
  scopesFor,
} from './auth/capabilities.js';
export { getConfigPath, loadConfig, saveConfig } from './config/index.js';
export {
  decodeBody,
  GmailClient,
  getHeader,
  getHtmlBody,
  getTextBody,
  type Message,
  type MessageSummary,
  type SearchResult,
  type Thread,
} from './gmail/index.js';
export { createServer, type ServerOptions } from './server/index.js';
export type { Account, Config } from './types/index.js';
