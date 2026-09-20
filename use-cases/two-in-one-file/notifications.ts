/**
 * Two workflows in one file.
 *
 * A file is a module, not a workflow: `@flowWeaver workflow` can appear on
 * as many exported functions as the module needs, and they share the node
 * types declared alongside them. These two both format and deliver a
 * notification, and differ only in where it goes -- which is the usual
 * reason to keep them together.
 */

export interface Notice {
  subject: string;
  body: string;
  urgent: boolean;
}

/**
 * Turn a raw alert into something a person can read.
 *
 * @flowWeaver nodeType
 * @label Compose Notice
 * @color blue
 * @icon description
 * @expression
 * @input title - What happened
 * @input detail - The particulars
 * @input severity - "info", "warn" or "page"
 * @output notice - The composed notice
 */
export function composeNotice(title: string, detail: string, severity: string): { notice: Notice } {
  const urgent = severity === 'page';
  return {
    notice: {
      subject: urgent ? `[URGENT] ${title}` : title,
      body: detail.trim(),
      urgent,
    },
  };
}

/**
 * Hand the notice to email. Mocked: it returns what it would have sent.
 *
 * @flowWeaver nodeType
 * @label Send Email
 * @color green
 * @icon email
 * @expression
 * @input notice - The notice to send
 * @input to - Who receives it
 * @output receipt - What was sent, and to whom
 */
export function sendEmail(notice: Notice, to: string): { receipt: string } {
  return { receipt: `email to ${to}: ${notice.subject}` };
}

/**
 * Hand the notice to chat. Mocked, as above.
 *
 * @flowWeaver nodeType
 * @label Post To Chat
 * @color cyan
 * @icon forum
 * @expression
 * @input notice - The notice to post
 * @input channel - Where it goes
 * @output receipt - What was posted, and where
 */
export function postToChat(notice: Notice, channel: string): { receipt: string } {
  const prefix = notice.urgent ? '@here ' : '';
  return { receipt: `chat to ${channel}: ${prefix}${notice.subject}` };
}

/**
 * Compose an alert and send it by email.
 *
 * @flowWeaver workflow
 * @param title - What happened
 * @param detail - The particulars
 * @param severity - "info", "warn" or "page"
 * @param to - Who receives it
 * @returns receipt - What was sent
 * @node compose composeNotice
 * @node send sendEmail
 * @path Start -> compose -> send -> Exit
 */
export function emailAlert(
  execute: boolean,
  params: { title: string; detail: string; severity: string; to: string },
): { onSuccess: boolean; onFailure: boolean; receipt: string } {
  throw new Error('generated body was not installed');
}

/**
 * Compose the same alert and post it to a chat channel instead.
 *
 * @flowWeaver workflow
 * @param title - What happened
 * @param detail - The particulars
 * @param severity - "info", "warn" or "page"
 * @param channel - Where it goes
 * @returns receipt - What was posted
 * @node compose composeNotice
 * @node post postToChat
 * @path Start -> compose -> post -> Exit
 */
export function chatAlert(
  execute: boolean,
  params: { title: string; detail: string; severity: string; channel: string },
): { onSuccess: boolean; onFailure: boolean; receipt: string } {
  throw new Error('generated body was not installed');
}
