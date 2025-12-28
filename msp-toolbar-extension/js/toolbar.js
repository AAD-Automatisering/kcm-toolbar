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

  const toggleMenu = () => {
    const menu = document.querySelector(".guac-menu.menu");
    if (!menu) {
      return;
    }
    menu.classList.toggle("open");
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
