import type { Page, Frame } from 'playwright';

export type CapturedInteraction =
  | { action: 'navigate'; target: string }
  | { action: 'click'; target: string }
  | { action: 'fill' | 'select'; target: string; value?: string; secret?: true };

export interface CursorSample {
  x: number;
  y: number;
  timeMs: number;
}

export interface RecorderHooks {
  onInteraction(event: CapturedInteraction): void | Promise<void>;
  onCursor?(sample: CursorSample): void;
}

export interface RecorderInstallation {
  flush(): Promise<void>;
  dispose(): void;
}

type WindowWithRecorderFlush = Window & {
  __demoForgeFlush?: () => void;
};

const captureScript = `(() => {
  if (window.top !== window) return;
  const pending = new Map();
  let lastCursorAt = 0;
  const sensitivePattern = /password|passcode|secret|token|api[ _-]?key|credit[ _-]?card|card[ _-]?number|cvv|security[ _-]?code/i;

  function normalText(value) { return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 160); }
  function cssString(value) { return JSON.stringify(String(value)); }
  function labelText(element) {
    const labels = element.labels ? Array.from(element.labels) : [];
    if (!labels.length) {
      const enclosing = element.closest('label');
      if (enclosing) labels.push(enclosing);
    }
    return normalText(labels.map(label => label.innerText || label.textContent).join(' '));
  }
  function roleOf(element) {
    if (element.getAttribute('role')) return element.getAttribute('role');
    const tag = element.tagName.toLowerCase();
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return element.multiple ? 'listbox' : 'combobox';
    if (tag === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'hidden') return null;
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return null;
  }
  function accessibleName(element) {
    const aria = normalText(element.getAttribute('aria-label'));
    if (aria) return aria;
    const label = labelText(element);
    if (label) return label;
    const alt = normalText(element.getAttribute('alt'));
    if (alt) return alt;
    return normalText(element.innerText || element.textContent);
  }
  function cssPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      let part = tag;
      if (current.id) {
        part = '#' + CSS.escape(current.id);
        parts.unshift(part);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(child => child.tagName === current.tagName);
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ') || element.tagName.toLowerCase();
  }
  function targetOf(element) {
    const testId = element.getAttribute('data-testid');
    if (testId && testId.length <= 160) return '[data-testid=' + cssString(testId) + ']';
    const label = labelText(element);
    if (element.id && label) return '#' + CSS.escape(element.id);
    const role = roleOf(element);
    const name = accessibleName(element);
    if (role && name) return 'role=' + role + '[name=' + cssString(name) + ']';
    const placeholder = normalText(element.getAttribute('placeholder'));
    if (placeholder) return 'placeholder=' + cssString(placeholder);
    if (label) return 'label=' + cssString(label);
    return cssPath(element);
  }
  function isSensitive(element) {
    const type = (element.getAttribute('type') || '').toLowerCase();
    const descriptors = [element.id, element.getAttribute('name'), element.getAttribute('autocomplete'),
      element.getAttribute('aria-label'), element.getAttribute('placeholder'), labelText(element)].join(' ');
    return type === 'password' || sensitivePattern.test(descriptors);
  }
  function emit(event) {
    if (typeof window.__demoForgeRecord === 'function') {
      try { window.__demoForgeRecord(event).catch(() => {}); } catch (_) {}
    }
  }
  function clearPending(element) {
    const item = pending.get(element);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(element);
    emit(item.event);
  }
  function flushPending() {
    for (const element of Array.from(pending.keys())) clearPending(element);
  }
  function captureInput(element) {
    if (!element || !element.matches('input, textarea')) return;
    const sensitive = isSensitive(element);
    const event = { action: 'fill', target: targetOf(element) };
    if (sensitive) event.secret = true;
    else event.value = element.value;
    const current = pending.get(element);
    if (current) clearTimeout(current.timer);
    const timer = setTimeout(() => clearPending(element), 350);
    pending.set(element, { event, timer });
  }
  document.addEventListener('click', event => {
    const element = event.target instanceof Element ? event.target.closest('button, a[href], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="tab"], [onclick]') : null;
    if (!element) return;
    flushPending();
    emit({ action: 'click', target: targetOf(element) });
  }, true);
  document.addEventListener('input', event => captureInput(event.target), true);
  document.addEventListener('change', event => {
    const element = event.target;
    if (!(element instanceof Element)) return;
    if (element.matches('select')) {
      flushPending();
      const sensitive = isSensitive(element);
      const captured = { action: 'select', target: targetOf(element) };
      if (sensitive) captured.secret = true;
      else captured.value = element.value;
      emit(captured);
    } else if (element.matches('input, textarea')) {
      if (pending.has(element)) clearPending(element);
      else captureInput(element), clearPending(element);
    }
  }, true);
  window.addEventListener('popstate', () => emit({ action: 'navigate', target: location.href }), true);
  window.addEventListener('hashchange', () => emit({ action: 'navigate', target: location.href }), true);
  const pushState = history.pushState;
  history.pushState = function() {
    const result = pushState.apply(this, arguments);
    emit({ action: 'navigate', target: location.href });
    return result;
  };
  const replaceState = history.replaceState;
  history.replaceState = function() {
    const result = replaceState.apply(this, arguments);
    emit({ action: 'navigate', target: location.href });
    return result;
  };
  document.addEventListener('pointermove', event => {
    const now = performance.now();
    if (now - lastCursorAt < 70 || typeof window.__demoForgeCursor !== 'function') return;
    lastCursorAt = now;
    try { window.__demoForgeCursor({ x: event.clientX, y: event.clientY, time: now }).catch(() => {}); } catch (_) {}
  }, true);
  window.__demoForgeFlush = flushPending;
})();`;

function handleFrameNavigation(frame: Frame, onInteraction: RecorderHooks['onInteraction']): void {
  if (frame !== frame.page().mainFrame()) return;
  const target = frame.url();
  if (target && target !== 'about:blank') void onInteraction({ action: 'navigate', target });
}

export async function installRecorder(page: Page, hooks: RecorderHooks): Promise<RecorderInstallation> {
  await page.exposeBinding('__demoForgeRecord', (_source, event: CapturedInteraction) => hooks.onInteraction(event));
  await page.exposeBinding('__demoForgeCursor', (_source, sample: { x: number; y: number; time: number }) => {
    if (!Number.isFinite(sample?.x) || !Number.isFinite(sample?.y) || !Number.isFinite(sample?.time)) return;
    hooks.onCursor?.({ x: Math.max(0, sample.x), y: Math.max(0, sample.y), timeMs: sample.time });
  });
  await page.addInitScript({ content: captureScript });
  const onNavigation = (frame: Frame) => handleFrameNavigation(frame, hooks.onInteraction);
  page.on('framenavigated', onNavigation);
  return {
    async flush() {
      try { await page.evaluate(() => (window as WindowWithRecorderFlush).__demoForgeFlush?.()); } catch { /* The page may already have closed. */ }
    },
    dispose() { page.off('framenavigated', onNavigation); },
  };
}

export async function installCursorTracking(page: Page, onCursor: (sample: CursorSample) => void): Promise<void> {
  await page.exposeBinding('__demoForgeCursor', (_source, sample: { x: number; y: number; time: number }) => {
    if (!Number.isFinite(sample?.x) || !Number.isFinite(sample?.y) || !Number.isFinite(sample?.time)) return;
    onCursor({ x: Math.max(0, sample.x), y: Math.max(0, sample.y), timeMs: sample.time });
  });
  await page.addInitScript({ content: `(() => {
    if (window.top !== window) return;
    let previous = 0;
    document.addEventListener('pointermove', event => {
      const now = performance.now();
      if (now - previous < 70 || typeof window.__demoForgeCursor !== 'function') return;
      previous = now;
      try { window.__demoForgeCursor({ x: event.clientX, y: event.clientY, time: now }).catch(() => {}); } catch (_) {}
    }, true);
  })();` });
}
