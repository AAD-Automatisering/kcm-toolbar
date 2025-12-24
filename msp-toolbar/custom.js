(() => {
  const BASE_PATH = "/extensions/msp-toolbar";
  const TOOLBAR_ID = "msp-toolbar";

  const ensureStylesheet = (href) => {
    if (document.querySelector(`link[href="${href}"]`)) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  };

  const ensureScript = (src) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  };

  const injectToolbarHtml = async () => {
    if (document.getElementById(TOOLBAR_ID)) {
      return;
    }
    try {
      const response = await fetch(`${BASE_PATH}/toolbar.html`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const html = await response.text();
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html.trim();
      const toolbar = wrapper.firstElementChild;
      if (toolbar) {
        document.body.prepend(toolbar);
        document.body.classList.add("msp-toolbar-enabled");
      }
    } catch (error) {
      return;
    }
  };

  const init = () => {
    ensureStylesheet(`${BASE_PATH}/toolbar.css`);
    injectToolbarHtml();
    ensureScript(`${BASE_PATH}/toolbar.js`);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
