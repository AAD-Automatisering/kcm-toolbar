(() => {
  const TOOLBAR_ID = "msp-toolbar";
  const MENU_BUTTON_ID = "msp-toolbar-menu";

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

  const getMenuElement = () =>
    document.querySelector(".guac-menu.menu") || document.querySelector(".guac-menu");

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

  const clickMenuToggle = (root) => {
    const toggle = root?.querySelector?.(".menu-toggle, .menu-button, .toggle") ||
      document.querySelector(".menu-toggle, .menu-button, .toggle");
    if (toggle) {
      toggle.click();
      return true;
    }
    return false;
  };

  const toggleScope = (scope) => {
    if (!scope) {
      return false;
    }

    const functionKeys = [
      "toggleMenu",
      "toggleMenuVisible",
      "toggleMenuShown",
      "toggleMenuOpen",
      "toggleSidebar",
      "toggleSideMenu"
    ];
    for (const key of functionKeys) {
      if (typeof scope[key] === "function") {
        scope[key]();
        scope.$applyAsync?.();
        return true;
      }
    }

    const booleanKeys = [
      "menuVisible",
      "menuOpen",
      "menuShown",
      "showMenu",
      "isMenuVisible",
      "sidebarVisible",
      "sidebarOpen",
      "sideMenuVisible"
    ];
    for (const key of booleanKeys) {
      if (typeof scope[key] === "boolean") {
        scope[key] = !scope[key];
        scope.$applyAsync?.();
        return true;
      }
    }

    return toggleScope(scope.$parent);
  };

  const isMenuVisible = (menu) => {
    const rect = menu.getBoundingClientRect();
    return rect.width > 0 && rect.right > 10 && rect.left >= -10;
  };

  const showMenu = (menu) => {
    menu.classList.add("open");
    menu.style.display = "block";
    menu.style.left = "0px";
    menu.style.transform = "translateX(0px)";
  };

  const hideMenu = (menu) => {
    menu.classList.remove("open");
    const rect = menu.getBoundingClientRect();
    const width = rect.width || menu.offsetWidth || 0;
    if (width) {
      menu.style.left = `-${width}px`;
      menu.style.transform = `translateX(-${width}px)`;
    }
  };

  const toggleMenu = () => {
    const menu = getMenuElement();
    const wasVisible = menu ? isMenuVisible(menu) : null;

    triggerMenuShortcut();

    if (!menu) {
      return;
    }

    if (clickMenuToggle(menu)) {
      return;
    }

    if (window.angular && angular.element) {
      const scope = angular.element(menu).scope();
      if (toggleScope(scope)) {
        return;
      }
    }

    setTimeout(() => {
      const nowVisible = isMenuVisible(menu);
      if (wasVisible === null) {
        return;
      }
      if (nowVisible === wasVisible) {
        if (nowVisible) {
          hideMenu(menu);
        } else {
          showMenu(menu);
        }
      }
    }, 0);
  };

  const init = () => {
    if (!document.getElementById(TOOLBAR_ID)) {
      buildToolbar();
    }
    const button = document.getElementById(MENU_BUTTON_ID);
    if (!button) {
      return;
    }
    button.addEventListener("click", toggleMenu);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
