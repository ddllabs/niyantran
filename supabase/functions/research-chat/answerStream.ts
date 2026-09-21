// Incrementally exposes the top-level `answer` string from the strict JSON
// envelope (streaming spec §E.4). Text before the root object and strings in
// nested values are never emitted.

type Phase = 'seek-object' | 'parse' | 'in-answer' | 'closed';
type ObjectState = 'key-or-end' | 'key' | 'colon' | 'value' | 'comma-or-end';
type ArrayState = 'value-or-end' | 'value' | 'comma-or-end';
type Frame =
  | { kind: 'object'; state: ObjectState; key: string | null; root: boolean }
  | { kind: 'array'; state: ArrayState };
type StringRole = 'key' | 'discard';

const MAX_KEY_CHARS = 256;
const MAX_NESTING = 64;
const MAX_PRIMITIVE_CHARS = 128;
const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

export interface AnswerDecoder {
  /** Feed a delta; returns the newly decoded answer characters (possibly ''). */
  push(delta: string): string;
  reset(): void;
  readonly closed: boolean;
  readonly text: string;
  /** True once the answer string has opened (something was, or will be, shown). */
  readonly opened: boolean;
}

export function createAnswerDecoder(): AnswerDecoder {
  let phase: Phase = 'seek-object';
  let frames: Frame[] = [];
  let stringRole: StringRole | null = null;
  let captureKey = false;
  let keyBuffer = '';
  let stringEscape = '';
  let primitiveBuffer = '';
  let answerEscape = '';
  let pendingHighSurrogate: number | null = null;
  let text = '';
  let opened = false;

  function closeMalformed(): void {
    phase = 'closed';
  }

  function currentFrame(): Frame | undefined {
    return frames.at(-1);
  }

  function completeValue(): void {
    const frame = currentFrame();
    const expectsValue = frame?.state === 'value' || (frame?.kind === 'array' && frame.state === 'value-or-end');
    if (!frame || !expectsValue) {
      closeMalformed();
      return;
    }
    frame.state = 'comma-or-end';
  }

  function beginString(role: StringRole, shouldCaptureKey = false): void {
    stringRole = role;
    captureKey = shouldCaptureKey;
    keyBuffer = '';
    stringEscape = '';
  }

  function appendKey(value: string): void {
    if (!captureKey) return;
    keyBuffer += value;
    if (keyBuffer.length > MAX_KEY_CHARS) closeMalformed();
  }

  function processParsedString(ch: string): void {
    if (stringEscape) {
      stringEscape += ch;
      if (stringEscape[1] === 'u') {
        if (stringEscape.length > 2 && !/^[0-9a-fA-F]$/.test(ch)) {
          closeMalformed();
          return;
        }
        if (stringEscape.length < 6) return;
        appendKey(String.fromCharCode(Number.parseInt(stringEscape.slice(2), 16)));
        stringEscape = '';
        return;
      }
      const decoded = SIMPLE_ESCAPES[ch];
      stringEscape = '';
      if (decoded === undefined) {
        closeMalformed();
        return;
      }
      appendKey(decoded);
      return;
    }

    if (ch === '\\') {
      stringEscape = '\\';
      return;
    }
    if (ch === '"') {
      const role = stringRole;
      stringRole = null;
      if (role === 'key') {
        const frame = currentFrame();
        if (!frame || frame.kind !== 'object' || (frame.state !== 'key' && frame.state !== 'key-or-end')) {
          closeMalformed();
          return;
        }
        frame.key = captureKey ? keyBuffer : null;
        frame.state = 'colon';
      } else {
        completeValue();
      }
      captureKey = false;
      keyBuffer = '';
      return;
    }
    if (ch.charCodeAt(0) < 0x20) {
      closeMalformed();
      return;
    }
    appendKey(ch);
  }

  function closeContainer(ch: '}' | ']'): void {
    const frame = currentFrame();
    if (!frame || (ch === '}' && frame.kind !== 'object') || (ch === ']' && frame.kind !== 'array')) {
      closeMalformed();
      return;
    }
    const canClose = frame.kind === 'object'
      ? frame.state === 'key-or-end' || frame.state === 'comma-or-end'
      : frame.state === 'value-or-end' || frame.state === 'comma-or-end';
    if (!canClose) {
      closeMalformed();
      return;
    }
    frames.pop();
    if (frames.length === 0) phase = 'closed';
  }

  function startContainer(kind: 'object' | 'array'): void {
    if (frames.length >= MAX_NESTING) {
      closeMalformed();
      return;
    }
    completeValue();
    if (phase === 'closed') return;
    frames.push(
      kind === 'object'
        ? { kind: 'object', state: 'key-or-end', key: null, root: false }
        : { kind: 'array', state: 'value-or-end' },
    );
  }

  function startValue(ch: string): void {
    const frame = currentFrame();
    const isAnswer = frame?.kind === 'object' && frame.root && frame.key === 'answer';
    if (isAnswer) {
      if (ch !== '"') {
        closeMalformed();
        return;
      }
      phase = 'in-answer';
      opened = true;
      answerEscape = '';
      pendingHighSurrogate = null;
      return;
    }
    if (ch === '"') {
      beginString('discard');
      return;
    }
    if (ch === '{') {
      startContainer('object');
      return;
    }
    if (ch === '[') {
      startContainer('array');
      return;
    }
    if (/[-0-9tfn]/.test(ch)) {
      primitiveBuffer = ch;
      return;
    }
    closeMalformed();
  }

  function finishPrimitive(): boolean {
    try {
      const value = JSON.parse(primitiveBuffer);
      if (typeof value === 'object' && value !== null) throw new Error('not a primitive');
      if (typeof value === 'string') throw new Error('not a primitive');
    } catch {
      closeMalformed();
      return false;
    }
    primitiveBuffer = '';
    completeValue();
    return phase !== 'closed';
  }

  function processStructure(ch: string): void {
    const frame = currentFrame();
    if (!frame) {
      closeMalformed();
      return;
    }
    if (frame.kind === 'object') {
      if (frame.state === 'key-or-end') {
        if (ch === '}') closeContainer(ch);
        else if (ch === '"') beginString('key', frame.root);
        else closeMalformed();
      } else if (frame.state === 'key') {
        if (ch === '"') beginString('key', frame.root);
        else closeMalformed();
      } else if (frame.state === 'colon') {
        if (ch === ':') frame.state = 'value';
        else closeMalformed();
      } else if (frame.state === 'value') {
        startValue(ch);
      } else if (ch === ',') {
        frame.key = null;
        frame.state = 'key';
      } else if (ch === '}') {
        closeContainer(ch);
      } else {
        closeMalformed();
      }
      return;
    }

    if (frame.state === 'value-or-end') {
      if (ch === ']') closeContainer(ch);
      else startValue(ch);
    } else if (frame.state === 'value') {
      startValue(ch);
    } else if (ch === ',') {
      frame.state = 'value';
    } else if (ch === ']') {
      closeContainer(ch);
    } else {
      closeMalformed();
    }
  }

  function emitCodeUnit(code: number): string {
    if (code >= 0xd800 && code <= 0xdbff) {
      const previous = pendingHighSurrogate;
      pendingHighSurrogate = code;
      return previous === null ? '' : String.fromCharCode(previous);
    }
    if (code >= 0xdc00 && code <= 0xdfff && pendingHighSurrogate !== null) {
      const high = pendingHighSurrogate;
      pendingHighSurrogate = null;
      return String.fromCharCode(high, code);
    }
    const prefix = pendingHighSurrogate === null ? '' : String.fromCharCode(pendingHighSurrogate);
    pendingHighSurrogate = null;
    return prefix + String.fromCharCode(code);
  }

  function flushPendingHighSurrogate(): string {
    if (pendingHighSurrogate === null) return '';
    const value = String.fromCharCode(pendingHighSurrogate);
    pendingHighSurrogate = null;
    return value;
  }

  function decodeAnswerChar(ch: string): string {
    if (answerEscape) {
      answerEscape += ch;
      if (answerEscape[1] === 'u') {
        if (answerEscape.length > 2 && !/^[0-9a-fA-F]$/.test(ch)) {
          closeMalformed();
          return '';
        }
        if (answerEscape.length < 6) return '';
        const code = Number.parseInt(answerEscape.slice(2), 16);
        answerEscape = '';
        return emitCodeUnit(code);
      }
      const decoded = SIMPLE_ESCAPES[ch];
      answerEscape = '';
      if (decoded === undefined) {
        closeMalformed();
        return '';
      }
      return flushPendingHighSurrogate() + decoded;
    }

    if (ch === '\\') {
      answerEscape = '\\';
      return '';
    }
    if (ch === '"') {
      phase = 'closed';
      return flushPendingHighSurrogate();
    }
    if (ch.charCodeAt(0) < 0x20) {
      closeMalformed();
      return '';
    }
    if (ch.length === 1) return emitCodeUnit(ch.charCodeAt(0));
    return flushPendingHighSurrogate() + ch;
  }

  function scan(delta: string): string {
    let out = '';
    for (const ch of delta) {
      if (phase === 'closed') break;
      if (phase === 'seek-object') {
        if (/\s/.test(ch)) continue;
        if (ch === '{') {
          frames = [{ kind: 'object', state: 'key-or-end', key: null, root: true }];
          phase = 'parse';
        } else if (ch === '[') {
          closeMalformed();
        }
        continue;
      }
      if (phase === 'in-answer') {
        out += decodeAnswerChar(ch);
        continue;
      }
      if (stringRole) {
        processParsedString(ch);
        continue;
      }
      if (primitiveBuffer) {
        if (/[\s,}\]]/.test(ch)) {
          if (!finishPrimitive()) break;
        } else {
          primitiveBuffer += ch;
          if (primitiveBuffer.length > MAX_PRIMITIVE_CHARS) closeMalformed();
          continue;
        }
      }
      if (/\s/.test(ch)) continue;
      processStructure(ch);
    }
    text += out;
    return out;
  }

  return {
    push(delta) {
      if (phase === 'closed') return '';
      return scan(String(delta ?? ''));
    },
    reset() {
      phase = 'seek-object';
      frames = [];
      stringRole = null;
      captureKey = false;
      keyBuffer = '';
      stringEscape = '';
      primitiveBuffer = '';
      answerEscape = '';
      pendingHighSurrogate = null;
      text = '';
      opened = false;
    },
    get closed() {
      return phase === 'closed';
    },
    get text() {
      return text;
    },
    get opened() {
      return opened;
    },
  };
}
