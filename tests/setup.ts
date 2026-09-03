import "@testing-library/jest-dom/vitest";

/**
 * jsdom implements the `<dialog>` element but not its top-layer methods, so a
 * component that calls `showModal()` throws before the dialog can open. The
 * `open` property reflects to the attribute, which is all the accessibility
 * tree needs: jsdom's default stylesheet already hides `dialog:not([open])`.
 */
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (!HTMLDialogElement.prototype.show) {
    HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
}
