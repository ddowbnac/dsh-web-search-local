import { describe, expect, test, beforeAll, afterAll } from 'bun:test';


type SlotReg = { spec: any; comp: any };

let hookStates: unknown[] = [];
let hookIndex = 0;

function newRenderSession(): void {
  hookStates = [];
  hookIndex = 0;
}

function render(comp: (props: any) => any, props: any): any {
  hookIndex = 0;
  return comp(props);
}

const stubReact = {
  createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
    type,
    props: (props ?? {}) as Record<string, unknown>,
    children: children.flat(Infinity),
  }),
  useState: <T>(init: T | (() => T)): [T, (v: T) => void] => {
    const i = hookIndex++;
    if (hookStates[i] === undefined) hookStates[i] = typeof init === 'function' ? (init as () => T)() : init;
    return [hookStates[i] as T, (v: T) => void (hookStates[i] = v)];
  },
  useEffect: () => {},
  useRef: <T>(v: T) => ({ current: v }),
};

let loaded: { id: string; factory: (require: (name: string) => unknown) => any } | null = null;

function makeCtx(scopeValue: unknown, status: 'ready' | 'unavailable' = 'ready') {
  const slotRegs: SlotReg[] = [];
  const localeReg: Record<string, unknown> = {};
  const sets: Array<[string, unknown]> = [];
  const scopeStub = {
    getSnapshot: () => ({
      status,
      value: scopeValue,
      writable: true,
      revision: 1,
      mode: 'host',
    }),
    subscribe: () => () => {},
    set: async (key: string, value: unknown) => void sets.push([key, value]),
    unset: async () => {},
    mutate: async () => {},
  };
  const ctx = {
    locale: { register: (ns: string, dict: unknown) => void (localeReg[ns] = dict) },
    settingsScope: { bind: () => scopeStub },
    effect: () => {},
    slots: {
      inject: (_name: string, thunk: () => Generator<SlotReg>) => {
        const gen = thunk();
        let r = gen.next();
        while (!r.done) {
          slotRegs.push(r.value);
          r = gen.next();
        }
      },
      register: (spec: any, comp: any) => ({ spec, comp }),
    },
  };
  return { ctx, slotRegs, localeReg, sets };
}

function walk(el: any): any[] {
  const out: any[] = [];
  const stack = [el];
  while (stack.length) {
    const n = stack.pop();
    if (n == null || typeof n !== 'object') continue;
    out.push(n);
    for (const c of n.children ?? []) stack.push(c);
    if (n.props) for (const v of Object.values(n.props)) if (v != null && typeof v === 'object') stack.push(v);
  }
  return out;
}

function rendererProps(face: any, t: (k: string) => string): any {
  const store = face.hooks.localSearchCard;
  return {
    t,
    useLocalSearchCard: (sel: (s: any) => any) => sel(store.getSnapshot()),
    save: face.save,
    discard: face.discard,
    edit: face.edit,
  };
}

describe('client bundle (lib/client.js)', () => {
  beforeAll(async () => {
    (globalThis as any).window = {
      __ModuleLoader__: {
        load(spec: any) {
          loaded = spec;
        },
      },
    };
    await import('../lib/client.js');
  });

  afterAll(() => {
    delete (globalThis as any).window;
  });

  test('registers via window.__ModuleLoader__.load with the right id', () => {
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('@deepseek-ai/dsh-web-search-local');
    expect(typeof loaded!.factory).toBe('function');
  });

  test('factory exports apply + inject', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    expect(typeof mod.apply).toBe('function');
    expect(Array.isArray(mod.inject)).toBe(true);
    expect(mod.inject).toContain('settingsScope');
    expect(mod.inject).toContain('slots');
  });

  test('apply registers the card under the web-search-local key with a component', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs, localeReg } = makeCtx({
      engine: 'searxng',
      corpusDirs: ['/a', '/b'],
      maxResults: 8,
      snippetLength: 120,
      indexDir: '',
      autoReindex: true,
    });
    mod.apply(ctx as any);
    expect(slotRegs.length).toBe(1);
    const reg = slotRegs[0];
    expect(reg.spec.name).toBe('settings.plugin.item');
    expect(reg.spec.key).toBe('web-search-local');
    expect(reg.spec.locale).toBe('web-search-local');
    expect(typeof reg.spec.inject).toBe('function');
    expect(typeof reg.comp).toBe('function');
    expect(Object.keys(localeReg)).toContain('web-search-local');

    const face = reg.spec.inject();
    expect(face.hooks).toBeDefined();
    expect(face.hooks.localSearchCard).toBeDefined();
    expect(typeof face.save).toBe('function');
    expect(typeof face.discard).toBe('function');
    expect(typeof face.edit).toBe('function');

    const snap = face.hooks.localSearchCard.getSnapshot();
    expect(snap.available).toBe(true);
    expect(snap.engine).toBe('searxng');
    expect(snap.corpusDirs).toBe('/a\n/b');
    expect(snap.maxResults).toBe('8');
    expect(snap.snippetLength).toBe('120');
    expect(snap.autoReindex).toBe(true);
  });

  test('engine defaults to auto when absent from the scope value', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx({ corpusDirs: [] });
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    const snap = face.hooks.localSearchCard.getSnapshot();
    expect(snap.engine).toBe('auto');
  });

  test('component renders the collapsed header, then expands to the form fields', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx({ corpusDirs: ['/a'], maxResults: 5 });
    mod.apply(ctx as any);
    const reg = slotRegs[0];
    const face = reg.spec.inject();
    const t = (k: string) => k;
    newRenderSession();

    let el = render(reg.comp, rendererProps(face, t));
    expect(el).not.toBeNull();
    let nodes = walk(el);
    expect(nodes.map((n) => n?.props?.id).filter(Boolean)).not.toContain('wsl-corpus');

    const header = nodes.find((n) => n?.type === 'button' && typeof n?.props?.onClick === 'function');
    expect(header).toBeDefined();
    (header.props.onClick as () => void)();
    el = render(reg.comp, rendererProps(face, t));
    nodes = walk(el);
    const ids = nodes.map((n) => n?.props?.id).filter(Boolean);
    expect(ids).toContain('wsl-engine');
    expect(ids).toContain('wsl-corpus');
    expect(ids).toContain('wsl-max');
    expect(ids).toContain('wsl-snip');
    expect(ids).toContain('wsl-idx');
    expect(ids).toContain('wsl-auto');
    expect(ids).not.toContain('wsl-sxurl');
    expect(ids).not.toContain('wsl-manage');
    const select = nodes.find((n) => n?.props?.id === 'wsl-engine');
    expect(select).toBeDefined();
    const options = select.children.map((c: any) => c.props.value).sort();
    expect(options).toEqual(['auto', 'duckduckgo', 'searxng']);
    const textarea = nodes.find((n) => n?.props?.id === 'wsl-corpus');
    expect(textarea.props.value).toBe('/a');
  });

  test('editing through the injected action republishes the store snapshot', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx({ corpusDirs: ['/a'], maxResults: 5 });
    mod.apply(ctx as any);
    const reg = slotRegs[0];
    const face = reg.spec.inject();
    const t = (k: string) => k;
    newRenderSession();
    const store = face.hooks.localSearchCard;
    expect(store.getSnapshot().dirty).toBe(false);

    face.edit('maxResults', '9');
    expect(store.getSnapshot().dirty).toBe(true);
    expect(store.getSnapshot().maxResults).toBe('9');

    const el1 = render(reg.comp, rendererProps(face, t));
    const header = walk(el1).find((n) => n?.type === 'button' && typeof n?.props?.onClick === 'function');
    expect(header).toBeDefined();
    (header.props.onClick as () => void)();
    const el2 = render(reg.comp, rendererProps(face, t));
    const max = walk(el2).find((n) => n?.props?.id === 'wsl-max');
    expect(max.props.value).toBe('9');
  });

  test('save persists engine + maxResults edits through the scope', async () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs, sets } = makeCtx({ engine: 'auto', maxResults: 5 });
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    face.edit('engine', 'duckduckgo');
    face.edit('maxResults', '9');
    expect(face.hooks.localSearchCard.getSnapshot().dirty).toBe(true);
    await face.save();
    expect(sets).toContainEqual(['engine', 'duckduckgo']);
    expect(sets).toContainEqual(['maxResults', 9]);
    expect(face.hooks.localSearchCard.getSnapshot().dirty).toBe(false);
  });

  test('component hides itself when the namespace is unavailable (defensive)', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx(undefined, 'unavailable');
    mod.apply(ctx as any);
    const reg = slotRegs[0];
    newRenderSession();
    const el = render(reg.comp, rendererProps(reg.spec.inject(), (k: string) => k));
    expect(el).toBeNull();
  });
});
