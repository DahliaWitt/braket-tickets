/**
 * Backend-only module declarations.
 *
 * These modules are imported by the Convex backend source files, which are
 * transitively included when the frontend imports from `@convex/_generated/api`.
 * Since these modules are server-side only and not needed for frontend type
 * checking, we declare a permissive shim to prevent TypeScript from failing to
 * resolve their types.
 */
declare module 'nodemailer' {
  interface TestAccount {
    user: string;
    pass: string;
    smtp: { host: string; port: number; secure: boolean };
    imap: { host: string; port: number; secure: boolean };
    pop3: { host: string; port: number; secure: boolean };
    web: string;
  }

  interface TransportOptions {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }

  interface Attachment {
    filename: string;
    content: string;
    encoding?: string;
    contentType?: string;
    cid?: string;
  }

  interface SendMailOptions {
    from?: string;
    to?: string;
    subject?: string;
    html?: string;
    text?: string;
    replyTo?: string;
    headers?: Record<string, string>;
    attachments?: Attachment[];
  }

  interface SentMessageInfo {
    messageId?: string;
    accepted?: string[];
    rejected?: string[];
    pending?: string[];
    response?: string;
    [key: string]: unknown;
  }

  interface Transporter {
    sendMail(opts: SendMailOptions): Promise<SentMessageInfo>;
  }

  const nodemailer: {
    createTestAccount: (cb: (err: Error | null, account: TestAccount) => void) => void;
    createTransport: (opts: TransportOptions) => Transporter;
    getTestMessageUrl: (info: SentMessageInfo) => string | false;
  };
  export default nodemailer;
}

/**
 * Browser-safe subset of qrcode typings.
 *
 * The DefinitelyTyped package depends on @types/node and declares Node-only
 * overloads that we do not want in the browser app. The frontend only uses the
 * browser toDataURL() API, so we keep a minimal local declaration here instead.
 */
declare module 'qrcode' {
  export type QRCodeErrorCorrectionLevel =
    | 'low'
    | 'medium'
    | 'quartile'
    | 'high'
    | 'L'
    | 'M'
    | 'Q'
    | 'H';

  export interface QRCodeColorOptions {
    dark?: string;
    light?: string;
  }

  export interface QRCodeToDataURLOptions {
    margin?: number;
    scale?: number;
    width?: number;
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
    color?: QRCodeColorOptions;
  }

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;
}
