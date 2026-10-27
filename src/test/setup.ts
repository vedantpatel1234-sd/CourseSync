import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// findBy*/waitFor give up after 1s by default. With dozens of jsdom suites running in parallel a
// page can occasionally take longer than that to render, which made tests fail at random. This is
// a ceiling, not a delay: tests still finish as soon as what they wait for appears.
configure({ asyncUtilTimeout: 5000 })

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
