document.addEventListener('DOMContentLoaded', () => {
  const cookieList = document.getElementById('cookie-list');
  const copyBtn = document.getElementById('copy-json-btn');
  const statusMessage = document.getElementById('status-message');

  function displayCookies(cookies) {
    if (cookies.length === 0) {
      cookieList.innerHTML = '<li>No cookies found on this page.</li>';
      copyBtn.style.display = 'none'; // Hide button if no cookies
    } else {
      copyBtn.style.display = 'block';
      cookies.forEach(cookie => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `<span class="cookie-name">${cookie.name}</span>: ${cookie.value}`;
        cookieList.appendChild(listItem);
      });
    }
  }

  function copyCookiesAsJson(cookies) {
    const jsonCookies = JSON.stringify(cookies, null, 2); // Format JSON with indentation
    navigator.clipboard.writeText(jsonCookies)
      .then(() => {
        statusMessage.textContent = 'Cookies copied to clipboard!';
        setTimeout(() => statusMessage.textContent = '', 2000); // Clear message after 2 seconds
      })
      .catch(err => {
        statusMessage.textContent = 'Failed to copy cookies.';
        console.error('Failed to copy text: ', err);
      });
  }

  // Fetch cookies when the popup opens
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    chrome.cookies.getAll({ url: currentTab.url }, (cookies) => {
      displayCookies(cookies);

      // Add event listener for the copy button
      copyBtn.addEventListener('click', () => {
        copyCookiesAsJson(cookies);
      });
    });
  });
});