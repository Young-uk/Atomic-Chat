  window.renderActivity = function () {
    const [title, detail] = window.atomicDesktopActivity || [];
    document.querySelector('h1').textContent = title || '';
    const body = document.querySelector('p');
    body.textContent = detail || '';
    body.scrollTop = body.scrollHeight;
  }
  window.renderActivity();
