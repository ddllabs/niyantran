// jsdom lacks a few browser APIs the app touches.
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
