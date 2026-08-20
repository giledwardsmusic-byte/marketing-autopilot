(() => {
  const nativeFetch = window.fetch.bind(window);
  const KEY = 'ma_session_token';

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const sameOriginApi = typeof url === 'string' && (url.startsWith('/api/') || url.startsWith(location.origin + '/api/'));
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
    const token = localStorage.getItem(KEY);
    if (sameOriginApi && token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);

    const response = await nativeFetch(input, {...init, headers});

    if (sameOriginApi && /\/api\/auth\/login(?:\?|$)/.test(url) && response.ok) {
      try {
        const data = await response.clone().json();
        const sessionToken = data?.user?.session_token;
        if (sessionToken) localStorage.setItem(KEY, sessionToken);
      } catch {}
    }

    if (sameOriginApi && /\/api\/auth\/logout(?:\?|$)/.test(url) && response.ok) {
      localStorage.removeItem(KEY);
    }

    return response;
  };
})();
