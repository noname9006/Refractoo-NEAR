// Splits streaming model output around <think>…</think> blocks. Reasoning
// models emit a (often long) think trace before the visible answer; the UI
// shows the answer by default and the trace behind a toggle.

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';
const OPEN_TAIL = OPEN_TAG.length - 1;
const CLOSE_TAIL = CLOSE_TAG.length - 1;
const DEFAULT_PREVIEW_LINES = 2;
const PREVIEW_TAIL_CHARS = 256;

function appendWithCarry(chunk, carryChars) {
  if (!chunk) return { appended: '', carry: '' };
  if (chunk.length <= carryChars) return { appended: '', carry: chunk };
  return {
    appended: chunk.slice(0, chunk.length - carryChars),
    carry: chunk.slice(chunk.length - carryChars),
  };
}

function tailPreviewLines(text, count = DEFAULT_PREVIEW_LINES) {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count);
}

export function createThinkStreamParser({ previewLines = DEFAULT_PREVIEW_LINES } = {}) {
  let visible = '';
  let think = '';
  let isThinking = false;
  let carry = '';
  let previewTail = '';

  const appendThink = (chunk) => {
    if (!chunk) return;
    think += chunk;
    previewTail = (previewTail + chunk).slice(-PREVIEW_TAIL_CHARS);
  };

  const consume = (delta) => {
    let rest = carry + (delta || '');
    carry = '';

    while (rest.length > 0) {
      if (isThinking) {
        const close = rest.indexOf(CLOSE_TAG);
        if (close === -1) {
          const next = appendWithCarry(rest, CLOSE_TAIL);
          appendThink(next.appended);
          carry = next.carry;
          break;
        }
        appendThink(rest.slice(0, close) + '\n');
        rest = rest.slice(close + CLOSE_TAG.length);
        isThinking = false;
        continue;
      }

      const open = rest.indexOf(OPEN_TAG);
      if (open === -1) {
        const next = appendWithCarry(rest, OPEN_TAIL);
        visible += next.appended;
        carry = next.carry;
        break;
      }
      visible += rest.slice(0, open);
      rest = rest.slice(open + OPEN_TAG.length);
      isThinking = true;
    }
  };

  const flush = () => {
    if (!carry) return;
    if (isThinking) appendThink(carry);
    else visible += carry;
    carry = '';
  };

  return {
    push(delta) {
      consume(delta);
      return this.snapshot();
    },
    snapshot() {
      return {
        visible: visible.trim(),
        think: think.trim(),
        isThinking,
        thinkPreview: tailPreviewLines(previewTail, previewLines),
      };
    },
    finish() {
      flush();
      return this.snapshot();
    },
  };
}

export function parseThink(text) {
  const parser = createThinkStreamParser();
  parser.push(text);
  return parser.finish();
}
