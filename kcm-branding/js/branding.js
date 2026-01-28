(() => {
  const FAVICON_RELATIVE_PATH = "../resources/favicon.png";
  const FAVICON_CACHE_BUSTER = "20250128-1";

  const getBrandingFaviconUrl = () => {
    const brandingScript = Array.from(document.scripts).find(
      (script) => script.src && script.src.includes("/js/branding.js")
    );
    if (!brandingScript) {
      return null;
    }
    try {
      const url = new URL(FAVICON_RELATIVE_PATH, brandingScript.src);
      url.searchParams.set("v", FAVICON_CACHE_BUSTER);
      return url.toString();
    } catch (error) {
      const fallbackBase = brandingScript.src.replace(/\/js\/branding\.js(?:\?.*)?$/, "");
      return fallbackBase ? `${fallbackBase}/resources/favicon.png?v=${FAVICON_CACHE_BUSTER}` : null;
    }
  };

  const applyFavicon = () => {
    const faviconUrl = getBrandingFaviconUrl();
    if (!faviconUrl) {
      return;
    }
    const head = document.head || document.querySelector("head");
    if (!head) {
      return;
    }
    ["icon", "shortcut icon"].forEach((rel) => {
      let link = head.querySelector(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        head.appendChild(link);
      }
      link.type = "image/png";
      link.href = faviconUrl;
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyFavicon);
  } else {
    applyFavicon();
  }
})();
