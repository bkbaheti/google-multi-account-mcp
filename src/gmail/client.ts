import { type gmail_v1, google } from 'googleapis';
import type { AccountStore } from '../auth/index.js';

export interface MessageHeader {
  name: string;
  value: string;
}

export interface MessageSummary {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
}

export interface Message {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: MessagePayload;
  sizeEstimate?: number;
}

export interface MessagePayload {
  headers?: MessageHeader[];
  mimeType?: string;
  body?: MessageBody;
  parts?: MessagePart[];
}

export interface MessageBody {
  data?: string;
  size?: number;
  attachmentId?: string;
}

export interface MessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: MessageHeader[];
  body?: MessageBody;
  parts?: MessagePart[];
}

export interface Thread {
  id: string;
  historyId?: string;
  messages?: Message[];
}

export interface Draft {
  id: string;
  message?: {
    id?: string;
    threadId?: string;
  };
}

export interface DraftInput {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface SearchResult {
  messages: MessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export class GmailClient {
  private readonly accountStore: AccountStore;
  private readonly accountId: string;
  private gmail: gmail_v1.Gmail | null = null;

  constructor(accountStore: AccountStore, accountId: string) {
    this.accountStore = accountStore;
    this.accountId = accountId;
  }

  private async getGmail(): Promise<gmail_v1.Gmail> {
    if (!this.gmail) {
      const auth = await this.accountStore.getAuthenticatedClient(this.accountId);
      this.gmail = google.gmail({ version: 'v1', auth });
    }
    return this.gmail;
  }

  async searchMessages(
    query: string,
    options: {
      maxResults?: number;
      pageToken?: string;
      includeSpamTrash?: boolean;
    } = {},
  ): Promise<SearchResult> {
    const gmail = await this.getGmail();

    const params: gmail_v1.Params$Resource$Users$Messages$List = {
      userId: 'me',
      q: query,
      maxResults: options.maxResults ?? 20,
      includeSpamTrash: options.includeSpamTrash ?? false,
    };

    if (options.pageToken) {
      params.pageToken = options.pageToken;
    }

    const response = await gmail.users.messages.list(params);

    const messages: MessageSummary[] = (response.data.messages ?? []).map(
      (m: gmail_v1.Schema$Message) => ({
        id: m.id ?? '',
        threadId: m.threadId ?? '',
      }),
    );

    const result: SearchResult = { messages };

    if (response.data.nextPageToken) {
      result.nextPageToken = response.data.nextPageToken;
    }
    if (
      response.data.resultSizeEstimate !== undefined &&
      response.data.resultSizeEstimate !== null
    ) {
      result.resultSizeEstimate = response.data.resultSizeEstimate;
    }

    return result;
  }

  async getMessage(
    messageId: string,
    format: 'minimal' | 'metadata' | 'full' = 'full',
  ): Promise<Message> {
    const gmail = await this.getGmail();

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format,
    });

    return this.convertMessage(response.data);
  }

  async createDraft(input: DraftInput): Promise<Draft> {
    const gmail = await this.getGmail();
    const requestBody = this.buildDraftRequestBody(input);

    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody,
    });

    return this.convertDraftResponse(response.data);
  }

  async updateDraft(draftId: string, input: DraftInput): Promise<Draft> {
    const gmail = await this.getGmail();
    const requestBody = this.buildDraftRequestBody(input);

    const response = await gmail.users.drafts.update({
      userId: 'me',
      id: draftId,
      requestBody,
    });

    return this.convertDraftResponse(response.data);
  }

  private buildDraftRequestBody(input: DraftInput): { message: { raw: string; threadId?: string } } {
    const lines: string[] = [];
    lines.push(`To: ${input.to}`);
    if (input.cc) {
      lines.push(`Cc: ${input.cc}`);
    }
    if (input.bcc) {
      lines.push(`Bcc: ${input.bcc}`);
    }
    lines.push(`Subject: ${input.subject}`);
    if (input.inReplyTo) {
      lines.push(`In-Reply-To: ${input.inReplyTo}`);
    }
    if (input.references) {
      lines.push(`References: ${input.references}`);
    }
    lines.push('Content-Type: text/plain; charset=utf-8');
    lines.push('');
    lines.push(input.body);

    const rawMessage = lines.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage, 'utf-8').toString('base64url');

    const requestBody: { message: { raw: string; threadId?: string } } = {
      message: {
        raw: encodedMessage,
      },
    };

    if (input.threadId) {
      requestBody.message.threadId = input.threadId;
    }

    return requestBody;
  }

  private convertDraftResponse(data: { id?: string | null; message?: { id?: string | null; threadId?: string | null } | null }): Draft {
    const result: Draft = {
      id: data.id ?? '',
    };

    if (data.message) {
      result.message = {};
      if (data.message.id) {
        result.message.id = data.message.id;
      }
      if (data.message.threadId) {
        result.message.threadId = data.message.threadId;
      }
    }

    return result;
  }

  async getThread(
    threadId: string,
    format: 'minimal' | 'metadata' | 'full' = 'full',
  ): Promise<Thread> {
    const gmail = await this.getGmail();

    const response = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format,
    });

    const result: Thread = {
      id: response.data.id ?? '',
    };

    if (response.data.historyId) {
      result.historyId = response.data.historyId;
    }

    if (response.data.messages) {
      result.messages = response.data.messages.map((m) => this.convertMessage(m));
    }

    return result;
  }

  private convertMessage(m: gmail_v1.Schema$Message): Message {
    const result: Message = {
      id: m.id ?? '',
      threadId: m.threadId ?? '',
    };

    if (m.labelIds) {
      result.labelIds = m.labelIds;
    }
    if (m.snippet) {
      result.snippet = m.snippet;
    }
    if (m.internalDate) {
      result.internalDate = m.internalDate;
    }
    if (m.sizeEstimate) {
      result.sizeEstimate = m.sizeEstimate;
    }
    if (m.payload) {
      result.payload = this.convertPayload(m.payload);
    }

    return result;
  }

  private convertPayload(payload: gmail_v1.Schema$MessagePart): MessagePayload {
    const result: MessagePayload = {};

    if (payload.headers && payload.headers.length > 0) {
      result.headers = payload.headers.map((h) => ({
        name: h.name ?? '',
        value: h.value ?? '',
      }));
    }

    if (payload.mimeType) {
      result.mimeType = payload.mimeType;
    }

    if (payload.body) {
      result.body = this.convertBody(payload.body);
    }

    if (payload.parts && payload.parts.length > 0) {
      result.parts = payload.parts.map((p) => this.convertPart(p));
    }

    return result;
  }

  private convertBody(body: gmail_v1.Schema$MessagePartBody): MessageBody {
    const result: MessageBody = {};

    if (body.data) {
      result.data = body.data;
    }
    if (body.size !== undefined && body.size !== null) {
      result.size = body.size;
    }
    if (body.attachmentId) {
      result.attachmentId = body.attachmentId;
    }

    return result;
  }

  private convertPart(part: gmail_v1.Schema$MessagePart): MessagePart {
    const result: MessagePart = {};

    if (part.partId) {
      result.partId = part.partId;
    }
    if (part.mimeType) {
      result.mimeType = part.mimeType;
    }
    if (part.filename) {
      result.filename = part.filename;
    }
    if (part.headers && part.headers.length > 0) {
      result.headers = part.headers.map((h) => ({
        name: h.name ?? '',
        value: h.value ?? '',
      }));
    }
    if (part.body) {
      result.body = this.convertBody(part.body);
    }
    if (part.parts && part.parts.length > 0) {
      result.parts = part.parts.map((p) => this.convertPart(p));
    }

    return result;
  }
}

// Helper to extract common headers
export function getHeader(message: Message, name: string): string | undefined {
  const header = message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value;
}

// Helper to decode base64url encoded body
export function decodeBody(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

// Helper to extract plain text body from message
export function getTextBody(message: Message): string | undefined {
  const payload = message.payload;
  if (!payload) return undefined;

  // Simple message with body directly
  if (payload.body?.data) {
    return decodeBody(payload.body.data);
  }

  // Multipart message - find text/plain part
  if (payload.parts) {
    const textPart = findPartByMimeType(payload.parts, 'text/plain');
    if (textPart?.body?.data) {
      return decodeBody(textPart.body.data);
    }
  }

  return undefined;
}

// Helper to extract HTML body from message
export function getHtmlBody(message: Message): string | undefined {
  const payload = message.payload;
  if (!payload) return undefined;

  if (payload.parts) {
    const htmlPart = findPartByMimeType(payload.parts, 'text/html');
    if (htmlPart?.body?.data) {
      return decodeBody(htmlPart.body.data);
    }
  }

  return undefined;
}

function findPartByMimeType(parts: MessagePart[], mimeType: string): MessagePart | undefined {
  for (const part of parts) {
    if (part.mimeType === mimeType) {
      return part;
    }
    if (part.parts) {
      const found = findPartByMimeType(part.parts, mimeType);
      if (found) return found;
    }
  }
  return undefined;
}
