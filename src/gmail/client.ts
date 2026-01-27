import { type gmail_v1, google } from 'googleapis';
import type { AccountStore } from '../auth/index.js';
import { buildDraftWithAttachments, type MimeAttachment } from './mime.js';

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
  message?: DraftMessage;
}

export interface DraftMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: MessagePayload;
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

export interface SentMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
}

export interface ReplyInput {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo: string;
  references: string;
}

export interface SearchResult {
  messages: MessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface BatchMessageResult {
  id: string;
  success: boolean;
  message?: Message;
  error?: string;
}

export interface Label {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  color?: {
    textColor?: string;
    backgroundColor?: string;
  };
}

export interface AttachmentInfo {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface AttachmentData {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  data: string; // base64-encoded
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

  // Batch get multiple messages in parallel
  async getMessagesBatch(
    messageIds: string[],
    format: 'minimal' | 'metadata' | 'full' = 'full',
  ): Promise<BatchMessageResult[]> {
    // Limit batch size to prevent overwhelming the API
    const maxBatchSize = 50;
    const idsToFetch = messageIds.slice(0, maxBatchSize);

    const results = await Promise.allSettled(
      idsToFetch.map(async (id) => {
        const message = await this.getMessage(id, format);
        return { id, message };
      }),
    );

    return results.map((result, index): BatchMessageResult => {
      const id = idsToFetch[index] ?? '';
      if (result.status === 'fulfilled') {
        return {
          id,
          success: true,
          message: result.value.message,
        };
      } else {
        return {
          id,
          success: false,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
      }
    });
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

  async getDraft(
    draftId: string,
    format: 'minimal' | 'metadata' | 'full' = 'full',
  ): Promise<Draft> {
    const gmail = await this.getGmail();

    const response = await gmail.users.drafts.get({
      userId: 'me',
      id: draftId,
      format,
    });

    return this.convertDraftResponseFull(response.data);
  }

  async sendDraft(draftId: string): Promise<SentMessage> {
    const gmail = await this.getGmail();

    const response = await gmail.users.drafts.send({
      userId: 'me',
      requestBody: {
        id: draftId,
      } as gmail_v1.Schema$Draft,
    });

    const result: SentMessage = {
      id: response.data.id ?? '',
      threadId: response.data.threadId ?? '',
    };

    if (response.data.labelIds) {
      result.labelIds = response.data.labelIds;
    }

    return result;
  }

  async deleteDraft(draftId: string): Promise<void> {
    const gmail = await this.getGmail();

    await gmail.users.drafts.delete({
      userId: 'me',
      id: draftId,
    });
  }

  async replyToThread(input: ReplyInput): Promise<Draft> {
    const draftInput: DraftInput = {
      to: input.to,
      subject: input.subject,
      body: input.body,
      threadId: input.threadId,
      inReplyTo: input.inReplyTo,
      references: input.references,
    };
    if (input.cc) draftInput.cc = input.cc;
    if (input.bcc) draftInput.bcc = input.bcc;

    return this.createDraft(draftInput);
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

  private convertDraftResponseFull(data: gmail_v1.Schema$Draft): Draft {
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
      if (data.message.labelIds) {
        result.message.labelIds = data.message.labelIds;
      }
      if (data.message.snippet) {
        result.message.snippet = data.message.snippet;
      }
      if (data.message.payload) {
        result.message.payload = this.convertPayload(data.message.payload);
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

  async listLabels(): Promise<Label[]> {
    const gmail = await this.getGmail();

    const response = await gmail.users.labels.list({
      userId: 'me',
    });

    return (response.data.labels ?? []).map((label) => this.convertLabel(label));
  }

  async modifyLabels(
    messageId: string,
    addLabelIds: string[],
    removeLabelIds: string[],
  ): Promise<Message> {
    const gmail = await this.getGmail();

    const response = await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds,
        removeLabelIds,
      },
    });

    return this.convertMessage(response.data);
  }

  // Batch modify labels on multiple messages
  async batchModifyLabels(
    messageIds: string[],
    addLabelIds: string[],
    removeLabelIds: string[],
  ): Promise<void> {
    const gmail = await this.getGmail();

    // Gmail API limits batch modify to 1000 messages
    const maxBatchSize = 1000;
    const idsToModify = messageIds.slice(0, maxBatchSize);

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: idsToModify,
        addLabelIds,
        removeLabelIds,
      },
    });
  }

  // Create a new label
  async createLabel(
    name: string,
    options?: {
      messageListVisibility?: 'show' | 'hide' | undefined;
      labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide' | undefined;
      backgroundColor?: string | undefined;
      textColor?: string | undefined;
    },
  ): Promise<Label> {
    const gmail = await this.getGmail();

    const requestBody: gmail_v1.Schema$Label = { name };

    if (options?.messageListVisibility) {
      requestBody.messageListVisibility = options.messageListVisibility;
    }
    if (options?.labelListVisibility) {
      requestBody.labelListVisibility = options.labelListVisibility;
    }
    if (options?.backgroundColor || options?.textColor) {
      requestBody.color = {};
      if (options.backgroundColor) {
        requestBody.color.backgroundColor = options.backgroundColor;
      }
      if (options.textColor) {
        requestBody.color.textColor = options.textColor;
      }
    }

    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody,
    });

    return this.convertLabel(response.data);
  }

  // Update an existing label
  async updateLabel(
    labelId: string,
    updates: {
      name?: string | undefined;
      messageListVisibility?: 'show' | 'hide' | undefined;
      labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide' | undefined;
      backgroundColor?: string | undefined;
      textColor?: string | undefined;
    },
  ): Promise<Label> {
    const gmail = await this.getGmail();

    const requestBody: gmail_v1.Schema$Label = {};

    if (updates.name !== undefined) {
      requestBody.name = updates.name;
    }
    if (updates.messageListVisibility !== undefined) {
      requestBody.messageListVisibility = updates.messageListVisibility;
    }
    if (updates.labelListVisibility !== undefined) {
      requestBody.labelListVisibility = updates.labelListVisibility;
    }
    if (updates.backgroundColor !== undefined || updates.textColor !== undefined) {
      requestBody.color = {};
      if (updates.backgroundColor !== undefined) {
        requestBody.color.backgroundColor = updates.backgroundColor;
      }
      if (updates.textColor !== undefined) {
        requestBody.color.textColor = updates.textColor;
      }
    }

    const response = await gmail.users.labels.patch({
      userId: 'me',
      id: labelId,
      requestBody,
    });

    return this.convertLabel(response.data);
  }

  // Delete a label
  async deleteLabel(labelId: string): Promise<void> {
    const gmail = await this.getGmail();

    await gmail.users.labels.delete({
      userId: 'me',
      id: labelId,
    });
  }

  private convertLabel(label: gmail_v1.Schema$Label): Label {
    const result: Label = {
      id: label.id ?? '',
      name: label.name ?? '',
      type: label.type === 'system' ? 'system' : 'user',
    };

    if (label.messageListVisibility) {
      result.messageListVisibility = label.messageListVisibility as 'show' | 'hide';
    }
    if (label.labelListVisibility) {
      result.labelListVisibility = label.labelListVisibility as
        | 'labelShow'
        | 'labelShowIfUnread'
        | 'labelHide';
    }
    if (label.color) {
      result.color = {};
      if (label.color.textColor) {
        result.color.textColor = label.color.textColor;
      }
      if (label.color.backgroundColor) {
        result.color.backgroundColor = label.color.backgroundColor;
      }
    }

    return result;
  }

  async trashMessage(messageId: string): Promise<Message> {
    const gmail = await this.getGmail();

    const response = await gmail.users.messages.trash({
      userId: 'me',
      id: messageId,
    });

    return this.convertMessage(response.data);
  }

  async untrashMessage(messageId: string): Promise<Message> {
    const gmail = await this.getGmail();

    const response = await gmail.users.messages.untrash({
      userId: 'me',
      id: messageId,
    });

    return this.convertMessage(response.data);
  }

  // List attachments in a message
  async listAttachments(messageId: string): Promise<AttachmentInfo[]> {
    const message = await this.getMessage(messageId, 'full');
    return this.extractAttachments(message.payload);
  }

  private extractAttachments(payload: MessagePayload | undefined): AttachmentInfo[] {
    const attachments: AttachmentInfo[] = [];
    if (!payload) return attachments;

    this.findAttachmentParts(payload.parts ?? [], attachments);

    // Check if the body itself is an attachment (single-part message)
    if (payload.body?.attachmentId) {
      attachments.push({
        attachmentId: payload.body.attachmentId,
        filename: 'attachment',
        mimeType: payload.mimeType ?? 'application/octet-stream',
        size: payload.body.size ?? 0,
      });
    }

    return attachments;
  }

  private findAttachmentParts(parts: MessagePart[], attachments: AttachmentInfo[]): void {
    for (const part of parts) {
      // Check if this part has an attachment
      if (part.body?.attachmentId) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename || 'attachment',
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size ?? 0,
        });
      }

      // Recurse into nested parts
      if (part.parts) {
        this.findAttachmentParts(part.parts, attachments);
      }
    }
  }

  // Get attachment data by ID
  async getAttachment(messageId: string, attachmentId: string): Promise<AttachmentData> {
    const gmail = await this.getGmail();

    // First get attachment info from the message
    const attachments = await this.listAttachments(messageId);
    const attachmentInfo = attachments.find((a) => a.attachmentId === attachmentId);

    if (!attachmentInfo) {
      throw new Error(`Attachment not found: ${attachmentId}`);
    }

    // Fetch the attachment data
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });

    const data = response.data.data;
    if (!data) {
      throw new Error('Attachment data is empty');
    }

    // Gmail returns base64url encoding, convert to standard base64
    const base64Data = data.replace(/-/g, '+').replace(/_/g, '/');

    return {
      attachmentId,
      filename: attachmentInfo.filename,
      mimeType: attachmentInfo.mimeType,
      size: attachmentInfo.size,
      data: base64Data,
    };
  }

  // Create a draft with attachments
  async createDraftWithAttachment(input: {
    to: string;
    subject: string;
    body: string;
    cc?: string | undefined;
    bcc?: string | undefined;
    threadId?: string | undefined;
    inReplyTo?: string | undefined;
    references?: string | undefined;
    attachments: MimeAttachment[];
  }): Promise<Draft> {
    const gmail = await this.getGmail();

    const requestBody = buildDraftWithAttachments(
      {
        to: input.to,
        subject: input.subject,
        body: input.body,
        cc: input.cc,
        bcc: input.bcc,
        inReplyTo: input.inReplyTo,
        references: input.references,
        attachments: input.attachments,
      },
      input.threadId,
    );

    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody,
    });

    return this.convertDraftResponse(response.data);
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
