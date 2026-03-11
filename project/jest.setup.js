global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// PointerEvent polyfill for Radix UI components (Menubar, DropdownMenu, etc.)
if (typeof global.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }
  global.PointerEvent = PointerEventPolyfill;
}
