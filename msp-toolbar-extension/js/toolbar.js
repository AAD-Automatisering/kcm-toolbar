(() => {
  const TOOLBAR_ID = "msp-toolbar";
  const MENU_BUTTON_ID = "msp-toolbar-menu";
  const SEARCH_INPUT_ID = "msp-toolbar-search";
  const RESULTS_ID = "msp-toolbar-results";
  const REVEAL_THRESHOLD = 12;
  const HIDE_DELAY_MS = 2000;
  const SEARCH_SUGGEST_MIN = 2;
  const MAX_RESULTS = 8;

  let lastPointerY = Number.POSITIVE_INFINITY;
  let hideTimeoutId = null;
  let isHovering = false;
  let menuObserver = null;
  let menuPollId = null;
  let connectionIndex = null;
  let connectionIndexPromise = null;
  let connectionDataSource = null;
  let searchRequestId = 0;

  const getMenuElement = () =>
    document.querySelector(".guac-menu.menu") || document.querySelector(".guac-menu");

  const getStorageValue = (storage, keys) => {
    if (!storage) {
      return null;
    }
    try {
      for (const key of keys) {
        const value = storage.getItem(key);
        if (value) {
          return value;
        }
      }
    } catch (error) {
      return null;
    }
    return null;
  };

  const normalizeToken = (value) => {
    if (!value) {
      return null;
    }
    let token = String(value).trim();
    if (
      (token.startsWith("\"") && token.endsWith("\"")) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1);
    }
    if (/%[0-9a-fA-F]{2}/.test(token)) {
      try {
        token = decodeURIComponent(token);
      } catch (error) {
        // Ignore decode failures and keep original token.
      }
    }
    token = token.trim();
    if (
      (token.startsWith("\"") && token.endsWith("\"")) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1);
    }
    if (/^bearer\s+/i.test(token)) {
      token = token.replace(/^bearer\s+/i, "");
    }
    return token || null;
  };

  const getTokenFromLocation = () => {
    const hash = window.location.hash || "";
    const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const searchQuery = window.location.search ? window.location.search.slice(1) : "";
    const tokenFromHash = normalizeToken(new URLSearchParams(hashQuery).get("token"));
    if (tokenFromHash) {
      return tokenFromHash;
    }
    const tokenFromSearch = normalizeToken(new URLSearchParams(searchQuery).get("token"));
    return tokenFromSearch || null;
  };

  const getDataSource = () =>
    getStorageValue(window.localStorage, ["GUAC_DATA_SOURCE", "guac-data-source", "dataSource"]) ||
    getStorageValue(window.sessionStorage, ["GUAC_DATA_SOURCE", "guac-data-source", "dataSource"]) ||
    window.GUAC_DATA_SOURCE ||
    "postgresql";

  const getAuthToken = () =>
    getTokenFromLocation() ||
    normalizeToken(
      getStorageValue(window.localStorage, [
        "GUAC_AUTH_TOKEN",
        "guac-auth-token",
        "authToken",
        "GUAC_TOKEN",
        "guac_token"
      ])
    ) ||
    normalizeToken(
      getStorageValue(window.sessionStorage, [
        "GUAC_AUTH_TOKEN",
        "guac-auth-token",
        "authToken",
        "GUAC_TOKEN",
        "guac_token"
      ])
    ) ||
    normalizeToken(window.GUAC_AUTH_TOKEN) ||
    null;

  const getApiRoot = () => {
    const path = window.location.pathname || "";
    if (!path || path === "/") {
      return "";
    }
    return path.replace(/\/$/, "");
  };

  const buildApiUrl = (options = {}) => {
    const includeToken = options.includeToken !== false;
    const dataSource = getDataSource();
    const apiRoot = getApiRoot();
    const basePath = `${apiRoot}/api/session/data/${encodeURIComponent(
      dataSource
    )}/connectionGroups/ROOT/tree`;
    const token = getAuthToken();
    if (!token || !includeToken) {
      return basePath;
    }
    const url = new URL(basePath, window.location.origin);
    url.searchParams.set("token", token);
    return url.toString();
  };

  const normalizeToArray = (value) => {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === "object") {
      return Object.values(value);
    }
    return [];
  };

  const getConnectionId = (connection) =>
    (connection &&
      (connection.identifier ||
        connection.id ||
        connection.connectionIdentifier ||
        connection.uuid)) ||
    null;

  const buildConnectionIndex = (node, parents = []) => {
    const results = [];
    if (!node || typeof node !== "object") {
      return results;
    }
    const nodeName = node.name ? String(node.name) : "";
    const nodeId = node.identifier || node.id || "";
    const isRoot = nodeId === "ROOT" || nodeName === "ROOT";
    const nextParents = !isRoot && nodeName ? parents.concat([nodeName]) : parents;

    const childConnections = normalizeToArray(node.childConnections);
    childConnections.forEach((connection) => {
      const id = getConnectionId(connection);
      const name = connection && connection.name ? String(connection.name) : "";
      if (!id || !name) {
        return;
      }
      const groupPath = nextParents.join(" / ");
      const path = groupPath ? `${groupPath} / ${name}` : name;
      results.push({
        id: String(id),
        name,
        groupPath,
        path,
        nameLower: name.toLowerCase(),
        pathLower: path.toLowerCase()
      });
    });

    const childGroups = normalizeToArray(node.childConnectionGroups);
    childGroups.forEach((group) => {
      results.push(...buildConnectionIndex(group, nextParents));
    });

    return results;
  };

  const fetchConnectionTree = async (includeToken) => {
    const url = buildApiUrl({ includeToken });
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  const requestConnectionTree = async () => {
    const token = getAuthToken();
    try {
      return await fetchConnectionTree(false);
    } catch (error) {
      if (token && (error.status === 401 || error.status === 403)) {
        return fetchConnectionTree(true);
      }
      throw error;
    }
  };

  const ensureConnectionIndex = () => {
    if (connectionIndexPromise) {
      return connectionIndexPromise;
    }
    connectionDataSource = getDataSource();
    connectionIndexPromise = requestConnectionTree()
      .then((tree) => {
        const treeRoot = tree && tree.data ? tree.data : tree;
        connectionIndex = buildConnectionIndex(treeRoot);
        return connectionIndex;
      })
      .catch((error) => {
        connectionIndexPromise = null;
        throw error;
      });
    return connectionIndexPromise;
  };

  const scoreConnection = (connection, queryLower) => {
    if (connection.nameLower === queryLower) {
      return 0;
    }
    if (connection.nameLower.startsWith(queryLower)) {
      return 1;
    }
    if (connection.nameLower.includes(queryLower)) {
      return 2;
    }
    if (connection.pathLower.startsWith(queryLower)) {
      return 3;
    }
    return 4;
  };

  const findMatches = (query) => {
    if (!connectionIndex) {
      return [];
    }
    const queryLower = query.toLowerCase();
    return connectionIndex
      .filter((connection) => connection.pathLower.includes(queryLower))
      .sort((a, b) => {
        const scoreA = scoreConnection(a, queryLower);
        const scoreB = scoreConnection(b, queryLower);
        if (scoreA !== scoreB) {
          return scoreA - scoreB;
        }
        return a.pathLower.localeCompare(b.pathLower);
      });
  };

  const getResultsElement = () => document.getElementById(RESULTS_ID);

  const isSearchFocused = () => {
    const active = document.activeElement;
    return active && active.id === SEARCH_INPUT_ID;
  };

  const showResultsMessage = (message) => {
    const results = getResultsElement();
    if (!results) {
      return;
    }
    results.innerHTML = "";
    const messageEl = document.createElement("div");
    messageEl.className = "msp-toolbar__results-empty";
    messageEl.textContent = message;
    results.appendChild(messageEl);
    results.hidden = false;
  };

  const hideResults = () => {
    const results = getResultsElement();
    if (!results) {
      return;
    }
    results.innerHTML = "";
    results.hidden = true;
  };

  const renderResults = (matches) => {
    const results = getResultsElement();
    if (!results) {
      return;
    }
    results.innerHTML = "";
    matches.forEach((match) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "msp-toolbar__result";
      item.dataset.connectionId = match.id;

      const title = document.createElement("span");
      title.className = "msp-toolbar__result-title";
      title.textContent = match.name;
      item.appendChild(title);

      if (match.groupPath) {
        const path = document.createElement("span");
        path.className = "msp-toolbar__result-path";
        path.textContent = match.groupPath;
        item.appendChild(path);
      }

      results.appendChild(item);
    });
    results.hidden = matches.length === 0;
  };

  const getAngularInjector = () => {
    const angular = window.angular;
    if (!angular || !angular.element) {
      return null;
    }
    const root =
      document.querySelector("[ng-app]") || document.body || document.documentElement || null;
    if (!root) {
      return null;
    }
    try {
      return angular.element(root).injector() || null;
    } catch (error) {
      return null;
    }
  };

  const base64urlEncode = (value) => {
    let binary = value;
    if (window.TextEncoder) {
      const bytes = new TextEncoder().encode(value);
      binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    }
    return window
      .btoa(binary)
      .replace(/[+/=]/g, (char) => ({ "+": "-", "/": "_", "=": "" }[char]));
  };

  const getAppDataSource = (injector) => {
    if (injector) {
      try {
        const authService = injector.get("authenticationService");
        if (authService && typeof authService.getDataSource === "function") {
          return authService.getDataSource() || getDataSource();
        }
      } catch (error) {
        // Ignore and fall back to local storage.
      }
    }
    return getDataSource();
  };

  const buildClientIdentifier = (connectionId) => {
    const id = String(connectionId);
    const injector = getAngularInjector();
    const dataSource = connectionDataSource || getDataSource() || getAppDataSource(injector);
    if (injector) {
      try {
        const ClientIdentifier = injector.get("ClientIdentifier");
        if (ClientIdentifier && typeof ClientIdentifier.toString === "function") {
          const type =
            (ClientIdentifier.Types && ClientIdentifier.Types.CONNECTION) || "c";
          return ClientIdentifier.toString({ id, type, dataSource });
        }
      } catch (error) {
        // Ignore and fall back to local encoding.
      }
    }
    if (
      window.Guacamole &&
      window.Guacamole.ClientIdentifier &&
      typeof window.Guacamole.ClientIdentifier.toString === "function"
    ) {
      const type =
        (window.Guacamole.ClientIdentifier.Types &&
          window.Guacamole.ClientIdentifier.Types.CONNECTION) ||
        "c";
      return window.Guacamole.ClientIdentifier.toString({ id, type, dataSource });
    }
    return base64urlEncode([id, "c", dataSource].join("\0"));
  };

  const buildClientHash = (connectionId) => {
    const clientIdentifier = buildClientIdentifier(connectionId);
    const hash = window.location.hash || "";
    const [, hashQuery = ""] = hash.split("?");
    const querySuffix = hashQuery ? `?${hashQuery}` : "";
    return `#/client/${clientIdentifier}${querySuffix}`;
  };

  const navigateToConnection = (connectionId) => {
    if (!connectionId) {
      return;
    }
    const targetHash = buildClientHash(connectionId);
    window.location.hash = targetHash;
  };

  const updateResults = async () => {
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (!input) {
      return;
    }
    const query = input.value.trim();
    if (query.length < SEARCH_SUGGEST_MIN) {
      hideResults();
      return;
    }
    const requestId = ++searchRequestId;
    if (!connectionIndex) {
      showResultsMessage("Laden...");
    }
    try {
      await ensureConnectionIndex();
    } catch (error) {
      showResultsMessage("Kon verbindingen niet laden.");
      return;
    }
    if (requestId !== searchRequestId) {
      return;
    }
    const matches = findMatches(query).slice(0, MAX_RESULTS);
    if (!matches.length) {
      showResultsMessage("Geen resultaten.");
      return;
    }
    renderResults(matches);
  };

  const performSearch = async (openFirst) => {
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (!input) {
      return;
    }
    const query = input.value.trim();
    if (!query) {
      hideResults();
      return;
    }
    if (!connectionIndex) {
      showResultsMessage("Laden...");
    }
    try {
      await ensureConnectionIndex();
    } catch (error) {
      showResultsMessage("Kon verbindingen niet laden.");
      return;
    }
    const matches = findMatches(query).slice(0, MAX_RESULTS);
    if (!matches.length) {
      showResultsMessage("Geen resultaten.");
      return;
    }
    if (openFirst) {
      navigateToConnection(matches[0].id);
      hideResults();
      return;
    }
    renderResults(matches);
  };

  const interceptSearchKeys = (event) => {
    if (!isSearchFocused()) {
      return;
    }
    if (event.type === "keydown") {
      if (event.key === "Enter") {
        event.preventDefault();
        void performSearch(true);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideResults();
        const input = document.getElementById(SEARCH_INPUT_ID);
        if (input) {
          input.blur();
        }
      }
    }
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const buildToolbar = () => {
    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.className = "msp-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "KCM toolbar");

    toolbar.innerHTML = `
      <div class="msp-toolbar__controls">
        <button id="${MENU_BUTTON_ID}" class="msp-toolbar__button" type="button" aria-label="Open menu">
          Menu
        </button>
        <input id="${SEARCH_INPUT_ID}" class="msp-toolbar__input" type="search"
          placeholder="Zoek verbinding..." aria-label="Zoek verbinding" autocomplete="off"
          spellcheck="false">
      </div>
      <div id="${RESULTS_ID}" class="msp-toolbar__results" role="listbox" hidden></div>
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

  const isMenuOpen = () => {
    if (document.querySelector(".guac-menu.menu.open")) {
      return true;
    }
    if (document.querySelector(".guac-menu.open") || document.querySelector(".menu.open")) {
      return true;
    }
    if (
      document.body.classList.contains("menu-open") ||
      document.body.classList.contains("sidebar-open") ||
      document.body.classList.contains("side-menu-open")
    ) {
      return true;
    }
    const menu = getMenuElement();
    if (!menu) {
      return false;
    }
    const rect = menu.getBoundingClientRect();
    return rect.width > 0 && rect.right > 10 && rect.left >= -10;
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
      if (!isHovering && isClientRoute() && !isMenuOpen()) {
        setRevealed(false);
      }
    }, HIDE_DELAY_MS);
  };

  const handlePointerMove = (event) => {
    if (!isClientRoute()) {
      return;
    }
    if (isMenuOpen()) {
      clearHideTimeout();
      setRevealed(true);
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
      hideResults();
      return;
    }
    if (isMenuOpen() || lastPointerY <= REVEAL_THRESHOLD) {
      setRevealed(true);
    } else {
      setRevealed(false);
    }
  };

  const syncRevealWithMenu = () => {
    if (!isClientRoute()) {
      return;
    }
    if (isMenuOpen()) {
      clearHideTimeout();
      setRevealed(true);
      return;
    }
    if (!isHovering && lastPointerY > REVEAL_THRESHOLD) {
      scheduleHide();
    }
  };

  const startMenuObserver = () => {
    const attach = () => {
      const menu = getMenuElement();
      if (!menu) {
        return false;
      }
      if (menuObserver) {
        menuObserver.disconnect();
      }
      menuObserver = new MutationObserver(syncRevealWithMenu);
      menuObserver.observe(menu, { attributes: true, attributeFilter: ["class", "style"] });
      return true;
    };

    if (attach()) {
      return;
    }

    menuPollId = setInterval(() => {
      if (attach()) {
        clearInterval(menuPollId);
        menuPollId = null;
      }
    }, 500);

    setTimeout(() => {
      if (menuPollId) {
        clearInterval(menuPollId);
        menuPollId = null;
      }
    }, 10000);
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
    const searchInput = document.getElementById(SEARCH_INPUT_ID);
    if (searchInput) {
      searchInput.addEventListener("focus", () => {
        void ensureConnectionIndex().catch(() => {});
      });
      searchInput.addEventListener("input", () => {
        void updateResults();
      });
      searchInput.addEventListener("keydown", (event) => {
        if (event.defaultPrevented) {
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void performSearch(true);
        }
        if (event.key === "Escape") {
          hideResults();
          searchInput.blur();
        }
        event.stopPropagation();
        event.stopImmediatePropagation();
      });
      searchInput.addEventListener("keyup", (event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
      });
      searchInput.addEventListener("keypress", (event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
      });
    }
    const results = document.getElementById(RESULTS_ID);
    if (results) {
      results.addEventListener("click", (event) => {
        const target = event.target.closest("[data-connection-id]");
        if (!target) {
          return;
        }
        navigateToConnection(target.dataset.connectionId);
        hideResults();
      });
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
    startMenuObserver();
    window.addEventListener("hashchange", updateVisibility);
    window.addEventListener("popstate", updateVisibility);
    window.addEventListener("keydown", interceptSearchKeys, true);
    window.addEventListener("keyup", interceptSearchKeys, true);
    window.addEventListener("keypress", interceptSearchKeys, true);
    document.addEventListener("click", (event) => {
      if (toolbar && !toolbar.contains(event.target)) {
        hideResults();
      }
    });
    document.addEventListener("mousemove", handlePointerMove, { passive: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
