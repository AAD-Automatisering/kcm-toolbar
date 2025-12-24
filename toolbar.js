(() => {
  const TOOLBAR_ID = "msp-toolbar";
  const INPUT_ID = "msp-toolbar-input";
  const RESULTS_ID = "msp-toolbar-results";
  const CSS_PATH = "toolbar.css";

  if (document.getElementById(TOOLBAR_ID)) {
    return;
  }

  const addStylesheet = () => {
    if (document.querySelector(`link[href*='${CSS_PATH}']`)) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_PATH;
    document.head.appendChild(link);
  };

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

  const state = {
    results: [],
    activeIndex: -1,
    query: "",
    pending: null
  };

  const resultsEl = () => document.getElementById(RESULTS_ID);
  const inputEl = () => document.getElementById(INPUT_ID);

  const clearResults = () => {
    state.results = [];
    state.activeIndex = -1;
    const results = resultsEl();
    if (results) {
      results.innerHTML = "";
      results.classList.remove("is-open");
    }
  };

  const normalizeResults = (payload) => {
    if (!payload) {
      return [];
    }
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload.results)) {
      return payload.results;
    }
    if (Array.isArray(payload.items)) {
      return payload.items;
    }
    return [];
  };

  const getResultId = (item) =>
    item.connectionId || item.connection_id || item.id || item._id || item.uuid;

  const getResultName = (item) => item.name || item.title || item.label || "Unnamed";

  const getResultProtocol = (item) =>
    (item.protocol || item.type || "").toString().toUpperCase();

  const getResultParent = (item) => item.parent || item.group || item.folder || "";

  const renderResults = () => {
    const results = resultsEl();
    if (!results) {
      return;
    }

    results.innerHTML = "";

    if (!state.results.length) {
      results.classList.remove("is-open");
      return;
    }

    state.results.forEach((item, index) => {
      const entry = document.createElement("div");
      entry.className = "msp-toolbar__result";
      entry.setAttribute("role", "option");
      entry.dataset.index = index.toString();
      entry.dataset.id = getResultId(item);
      entry.tabIndex = -1;
      if (index === state.activeIndex) {
        entry.classList.add("is-active");
      }

      const name = getResultName(item);
      const protocol = getResultProtocol(item) || "UNKNOWN";
      const parent = getResultParent(item);

      entry.innerHTML = `
        <span class="msp-toolbar__result-name">${name}</span>
        <span class="msp-toolbar__result-meta">— ${protocol} — ${parent}</span>
      `;

      entry.addEventListener("click", () => {
        const id = entry.dataset.id;
        if (id) {
          window.location.href = `/client/${id}`;
        }
      });

      results.appendChild(entry);
    });

    results.classList.add("is-open");
  };

  const fetchResults = async (query) => {
    if (!query) {
      clearResults();
      return;
    }

    const token = {};
    state.pending = token;

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (state.pending !== token) {
        return;
      }
      if (!response.ok) {
        clearResults();
        return;
      }
      const payload = await response.json();
      state.results = normalizeResults(payload);
      state.activeIndex = state.results.length ? 0 : -1;
      renderResults();
    } catch (error) {
      clearResults();
    }
  };

  const handleInput = (event) => {
    const query = event.target.value.trim();
    state.query = query;
    fetchResults(query);
  };

  const updateActive = (nextIndex) => {
    if (!state.results.length) {
      state.activeIndex = -1;
      renderResults();
      return;
    }
    const max = state.results.length - 1;
    if (nextIndex < 0) {
      state.activeIndex = max;
    } else if (nextIndex > max) {
      state.activeIndex = 0;
    } else {
      state.activeIndex = nextIndex;
    }
    renderResults();
    const activeEl = resultsEl()?.querySelector(".msp-toolbar__result.is-active");
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  };

  const handleKeydown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateActive(state.activeIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateActive(state.activeIndex - 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      inputEl().value = "";
      clearResults();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const active = state.results[state.activeIndex];
      if (active) {
        const id = getResultId(active);
        if (id) {
          window.location.href = `/client/${id}`;
          return;
        }
      }
      if (state.results.length === 1) {
        const id = getResultId(state.results[0]);
        if (id) {
          window.location.href = `/client/${id}`;
        }
      }
    }
  };

  const handleClickOutside = (event) => {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar || toolbar.contains(event.target)) {
      return;
    }
    clearResults();
  };

  const init = () => {
    addStylesheet();
    buildToolbar();
    const input = inputEl();
    if (!input) {
      return;
    }
    input.addEventListener("input", handleInput);
    input.addEventListener("keydown", handleKeydown);
    document.addEventListener("click", handleClickOutside);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
