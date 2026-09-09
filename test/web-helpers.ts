
export const DDG_HTML = `<!DOCTYPE html>
<html><head><title>Results</title></head><body>
<div class="results">
  <div class="result results--group">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.deepseek.com%2Fharness%2Fen%2F&amp;rut=aaa111">DeepSeek Harness developer preview</a>
      </h2>
      <div class="result__extras">
        <div class="result__extras__url">
          <span class="result__icon">
            <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.deepseek.com%2Fharness%2Fen%2F&amp;rut=aaa111"><img src="x"></a>
          </span>
          <a rel="nofollow" class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.deepseek.com%2Fharness%2Fen%2F&amp;rut=aaa111">www.deepseek.com</a>
        </div>
      </div>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.deepseek.com%2Fharness%2Fen%2F&amp;rut=aaa111"><b>DeepSeek Harness</b> is a <b>developer</b> preview where everything is a plugin.</a>
    </div>
  </div>
  <div class="result results--group">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fquoted&amp;rut=bbb222">Rust&quot;s &#x27;full text&#x27; engine</a>
      </h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fquoted&amp;rut=bbb222">Tantivy is a <b>full text</b> search engine written in Rust &amp; friends.</a>
    </div>
  </div>
  <div class="result results--group">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="https://plain.example/page">Plain link, no redirect</a>
      </h2>
      <a class="result__snippet" href="https://plain.example/page">A result whose title anchor has no DDG redirect wrapper.</a>
    </div>
  </div>
  <div class="result results--group">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffourth.example%2Fx&amp;rut=ccc333">Fourth result (should be cut by maxResults)</a>
      </h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffourth.example%2Fx&amp;rut=ccc333">Fourth snippet.</a>
    </div>
  </div>
</div>
</body></html>`;

export const DDG_EMPTY_HTML = `<!DOCTYPE html><html><head><title>anomaly</title></head><body>
<p>Let's confirm you're human. <a href="https://duckduckgo.com/">Continue</a></p>
</body></html>`;

export interface FetchMockResponse {
  status?: number;
  body?: string;
  fail?: string;
  headers?: Record<string, string>;
}

export interface FetchMock {
  calls: string[];
  restore(): void;
}

export function installFetchMock(handler: (url: string) => FetchMockResponse): FetchMock {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const r = handler(url);
    if (r.fail) throw new Error(r.fail);
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? {} });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = orig) };
}
