/**
 * Check if a string contains valid printable ASCII text
 */
function isPrintableText(str) {
  // Allow printable ASCII characters (32-126) plus newlines, carriage returns, tabs
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Allow: printable ASCII (32-126), newline (10), carriage return (13), tab (9)
    if (code < 9 || (code > 13 && code < 32) || code > 126) {
      return false;
    }
  }
  return true;
}

/**
 * Parse TCP message
 * Format: <Msg=Req;Type=Register;SerialNumber=ABC123;>
 */
export function parseMessage(message) {
  // Check if message contains only printable text
  if (!isPrintableText(message)) {
    throw new Error('Invalid message format: contains binary or non-printable data');
  }

  const trimmed = message.trim();

  // Check format
  if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) {
    throw new Error('Invalid message format: missing < or >');
  }

  // Remove < and >
  const content = trimmed.slice(1, -1);

  // Split by semicolon
  const parts = content.split(';').filter(p => p.trim());

  const parsed = {};

  for (const part of parts) {
    const [key, value] = part.split('=').map(s => s.trim());
    if (key && value) {
      parsed[key] = value;
    }
  }

  return parsed;
}

/**
 * Build TCP message
 * Format: <Msg=Cfm;Type=Register;Verdict=ACK;ID=PK001;>
 */
export function buildMessage(data) {
  const parts = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      parts.push(`${key}=${value}`);
    }
  }

  return `<${parts.join(';')};>`;
}

/**
 * Validate message
 */
export function validateMessage(parsed) {
  if (!parsed.Msg) {
    throw new Error('Missing Msg field');
  }

  if (!parsed.Type) {
    throw new Error('Missing Type field');
  }

  return true;
}

export default {
  parseMessage,
  buildMessage,
  validateMessage
};
