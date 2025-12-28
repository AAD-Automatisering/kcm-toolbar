(() => {
  const TOOLBAR_ID = "msp-toolbar";
  const MENU_BUTTON_ID = "msp-toolbar-menu";
  const REVEAL_THRESHOLD = 12;
  const HIDE_DELAY_MS = 200;

  let lastPointerY = Number.POSITIVE_INFINITY;
  let hideTimeoutId = null;
  let isHovering = false;

  const buildToolbar = () => {
    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.className = "msp-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "KCM toolbar");

    toolbar.innerHTML = `
      <button id="${MENU_BUTTON_ID}" class="msp-toolbar__button" type="button" aria-label="Open menu">
        Menu
      </button>
    `;

    document.body.prepend(toolbar);
  };

  const dispatchKey = (type, key, code, keyCode, modifiers) => {
    const event = new KeyboardEvent(type, {
      key,
      code,
      bubbles: true,
      cancelable: true,
      ...modifiers
    });

    try {
      Object.defineProperty(event, "keyCode", { get: () => keyCode });
      Object.defineProperty(event, "which", { get: () => keyCode });
    } catch (error) {
      // Ignore if the browser prevents overriding read-only fields.
    }

    document.dispatchEvent(event);
  };

  const triggerMenuShortcut = () => {
    dispatchKey("keydown", "Control", "ControlLeft", 17, { ctrlKey: true });
    dispatchKey("keydown", "Alt", "AltLeft", 18, { ctrlKey: true, altKey: true });
    dispatchKey("keydown", "Shift", "ShiftLeft", 16, {
      ctrlKey: true,
      altKey: true,
      shiftKey: true
    });
    dispatchKey("keyup", "Shift", "ShiftLeft", 16, {
      ctrlKey: true,
      altKey: true,
      shiftKey: false
    });
    dispatchKey("keyup", "Alt", "AltLeft", 18, { ctrlKey: true, altKey: false });
    dispatchKey("keyup", "Control", "ControlLeft", 17, { ctrlKey: false });
  };

  const isClientRoute = () => {
    const hash = window.location.hash || "";
    return /^#\/client(\/|$)/.test(hash);
  };

  const setRevealed = (reveal) => {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) {
      return;
    }
    toolbar.classList.toggle("is-revealed", reveal);
  };

  const clearHideTimeout = () => {
    if (hideTimeoutId) {
      clearTimeout(hideTimeoutId);
      hideTimeoutId = null;
    }
  };

  const scheduleHide = () => {
    clearHideTimeout();
    hideTimeoutId = setTimeout(() => {
      if (!isHovering && isClientRoute()) {
        setRevealed(false);
      }
    }, HIDE_DELAY_MS);
  };

  const handlePointerMove = (event) => {
    if (!isClientRoute()) {
      return;
    }
    lastPointerY = event.clientY;
    if (event.clientY <= REVEAL_THRESHOLD) {
      clearHideTimeout();
      setRevealed(true);
    } else if (!isHovering) {
      scheduleHide();
    }
  };

  const updateVisibility = () => {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) {
      return;
    }
    const visible = isClientRoute();
    toolbar.style.display = visible ? "block" : "none";
    clearHideTimeout();
    if (!visible) {
      setRevealed(false);
      return;
    }
    if (lastPointerY <= REVEAL_THRESHOLD) {
      setRevealed(true);
    } else {
      setRevealed(false);
    }
  };

  const toggleMenu = () => {
    triggerMenuShortcut();
  };

  const init = () => {
    if (!document.getElementById(TOOLBAR_ID)) {
      buildToolbar();
    }
    const button = document.getElementById(MENU_BUTTON_ID);
    if (button) {
      button.addEventListener("click", toggleMenu);
    }
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (toolbar) {
      toolbar.addEventListener("mouseenter", () => {
        isHovering = true;
        clearHideTimeout();
        setRevealed(true);
      });
      toolbar.addEventListener("mouseleave", () => {
        isHovering = false;
        scheduleHide();
      });
    }
    updateVisibility();
    window.addEventListener("hashchange", updateVisibility);
    window.addEventListener("popstate", updateVisibility);
    document.addEventListener("mousemove", handlePointerMove, { passive: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
