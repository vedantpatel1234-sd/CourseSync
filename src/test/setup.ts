import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement scrollIntoView; several pages (e.g. the AI chat) call it on every message.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom doesn't implement ResizeObserver; recharts (Analytics page) uses it to size charts.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
