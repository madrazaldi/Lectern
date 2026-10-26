// Electrobun serves the app as views://mainview/index.html; SvelteKit's router expects "/".
// (An external file rather than an inline script, so the page's content security policy can stay strict.)
if (location.pathname === '/index.html') history.replaceState(history.state, '', '/' + location.search + location.hash);
