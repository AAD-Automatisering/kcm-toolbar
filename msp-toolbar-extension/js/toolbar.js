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

  const toggleMenu = () => {
    const menu = getMenuElement();
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

    const rect = menu.getBoundingClientRect();
    const width = rect.width || menu.offsetWidth || 0;
    const isHidden = rect.right <= 0 || rect.left < -10;
    if (isHidden) {
      menu.classList.add("open");
      menu.style.display = "block";
      menu.style.left = "0px";
      menu.style.transform = "translateX(0px)";
    } else {
      menu.classList.remove("open");
      if (width) {
        menu.style.left = `-${width}px`;
        menu.style.transform = `translateX(-${width}px)`;
      }
    }
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
