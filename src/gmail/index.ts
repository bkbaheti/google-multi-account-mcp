export {
  decodeBody,
  GmailClient,
  getHeader,
  getHtmlBody,
  getTextBody,
  type AttachmentData,
  type AttachmentInfo,
  type Draft,
  type DraftInput,
  type DraftMessage,
  type Label,
  type Message,
  type MessageHeader,
  type MessagePart,
  type MessageSummary,
  type ReplyInput,
  type SearchResult,
  type SentMessage,
  type Thread,
} from './client.js';

export {
  buildDraftWithAttachments,
  buildRawMessage,
  encodeMimeHeader,
  type MimeAttachment,
  type MimeMessageOptions,
} from './mime.js';
