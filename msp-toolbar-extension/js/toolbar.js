(() => {
  const TOOLBAR_ID = "msp-toolbar";
  const MENU_BUTTON_ID = "msp-toolbar-menu";

  const buildToolbar = () => {
    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.className = "msp-toolbar";
    toolbar.setAttribute("role", "search");

    toolbar.innerHTML = `
      <div class="msp-toolbar__inner">
        <input
          id="${INPUT_ID}"
          class="msp-toolbar__input"
          type="search"
          placeholder="Zoek klant, server of connectie..."
          autocomplete="off"
          spellcheck="false"
          aria-label="Zoek klant, server of connectie"
        />
      </div>
      <div id="${RESULTS_ID}" class="msp-toolbar__results" role="listbox" aria-label="Search results"></div>
    `;

    document.body.prepend(toolbar);
    document.body.classList.add("msp-toolbar-enabled");
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
    } else {
      document.body.classList.add("msp-toolbar-enabled");
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
