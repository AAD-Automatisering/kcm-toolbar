(function () {

  function getConnections() {
    try {
      const injector = angular.element(document.body).injector();
      const manager = injector.get('connectionManager');
      return Object.values(manager.connections || {});
    } catch (e) {
      return [];
    }
  }

  function renderResults(list) {
    const box = document.getElementById('msp-toolbar-results');
    box.innerHTML = '';

    list.forEach(c => {
      const item = document.createElement('div');
      item.textContent = c.name;
      item.className = 'msp-result';
      item.onclick = () => window.location.hash = '#/client/' + c.identifier;
      box.appendChild(item);
    });
  }

  function search(query) {
    const q = query.toLowerCase();
    const results = getConnections().filter(c =>
      c.name.toLowerCase().includes(q)
    );
    renderResults(results);
  }

  function init() {
    const input = document.getElementById('msp-toolbar-input');
    input.addEventListener('input', e => search(e.target.value));
  }

  window.addEventListener('load', () => setTimeout(init, 1000));

})();
