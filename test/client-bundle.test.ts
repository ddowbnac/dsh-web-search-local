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

function makeCtx(
  scopeValue: unknown,
  status: 'ready' | 'unavailable' = 'ready',
  user?: Record<string, unknown>,
  base?: Record<string, unknown>,
  writable = true,
) {
  const state = {
    status,
    value: scopeValue,
    base,
    user: user ?? undefined,
    writable,
    revision: 1,
    mode: 'host',
  };
  const slotRegs: SlotReg[] = [];
  const localeReg: Record<string, unknown> = {};
  const sets: Array<[string, unknown]> = [];
  const unsets: string[] = [];
  const scopeStub = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    set: async (key: string, value: unknown) => {
      sets.push([key, value]);
      state.user = { ...(state.user ?? {}), [key]: value };
      state.value = { ...(state.value ?? {}), [key]: value };
    },
    unset: async (key: string) => {
      unsets.push(key);
      const u = { ...(state.user ?? {}) };
      delete u[key];
      state.user = u;
    },
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
  return { ctx, slotRegs, localeReg, sets, unsets, state };
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

function texts(el: any): string[] {
  const out: string[] = [];
  const stack = [el];
  while (stack.length) {
    const n = stack.pop();
    if (n == null) continue;
    if (typeof n === 'string') {
      out.push(n);
      continue;
    }
    if (typeof n === 'object') for (const c of n.children ?? []) stack.push(c);
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
    resetField: face.resetField,
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
    expect(typeof face.resetField).toBe('function');

    const snap = face.hooks.localSearchCard.getSnapshot();
    expect(snap.available).toBe(true);
    expect(snap.engine.text).toBe('searxng');
    expect(snap.engine.overridden).toBe(false);
    expect(snap.corpusDirs.text).toBe('/a\n/b');
    expect(snap.maxResults.text).toBe('8');
    expect(snap.snippetLength.text).toBe('120');
    expect(snap.autoReindex.checked).toBe(true);
    expect(snap.autoReindex.overridden).toBe(false);
    expect(snap.dirty).toBe(false);
  });

  test('engine defaults to auto when absent from the scope value', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx({ corpusDirs: [] });
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    const snap = face.hooks.localSearchCard.getSnapshot();
    expect(snap.engine.text).toBe('auto');
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
    // the platform card chrome is present: header button with the disclosure label
    const header = nodes.find((n) => n?.props?.className === 'wslc_header');
    expect(header).toBeDefined();
    expect(header.props['aria-expanded']).toBe(false);
    expect(header.props['aria-label']).toBe('expand: title');
    const card = walk(el).find((n) => n?.props?.className === 'wslc_card');
    expect(card).toBeDefined();

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
    // save/discard buttons carry the platform classes
    expect(nodes.some((n) => n?.props?.className === 'wslc_save')).toBe(true);
    expect(nodes.some((n) => n?.props?.className === 'wslc_discard')).toBe(true);
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
    expect(store.getSnapshot().maxResults.text).toBe('9');

    const el1 = render(reg.comp, rendererProps(face, t));
    const header = walk(el1).find((n) => n?.props?.className === 'wslc_header');
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

  test('an edit equal to the current value is not dirty (no-op skip)', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx({ engine: 'auto' });
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    face.edit('engine', 'auto');
    expect(face.hooks.localSearchCard.getSnapshot().dirty).toBe(false);
  });

  test('a user-layer override shows the Overridden badge; reset stages a clear', async () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs, unsets } = makeCtx({ engine: 'duckduckgo', maxResults: 5 }, 'ready', { engine: 'duckduckgo' });
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    const snap = face.hooks.localSearchCard.getSnapshot();
    expect(snap.engine.overridden).toBe(true);

    // reset stages a clear back to the composition default (auto)
    face.resetField('engine');
    const staged = face.hooks.localSearchCard.getSnapshot();
    expect(staged.engine.text).toBe('auto');
    expect(staged.engine.overridden).toBe(false);
    expect(staged.dirty).toBe(true);

    await face.save();
    expect(unsets).toContain('engine');
    expect(face.hooks.localSearchCard.getSnapshot().dirty).toBe(false);
  });

  test('a reset uses the composition base when one exists', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx(
      { engine: 'duckduckgo' },
      'ready',
      { engine: 'duckduckgo' },
      { engine: 'searxng' },
    );
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    face.resetField('engine');
    expect(face.hooks.localSearchCard.getSnapshot().engine.text).toBe('searxng');
  });

  test('an invalid number marks the form invalid and blocks the save', async () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs, sets } = makeCtx({ maxResults: 5 });
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    face.edit('maxResults', 'abc');
    const snap = face.hooks.localSearchCard.getSnapshot();
    expect(snap.invalid).toBe(true);
    expect(snap.dirty).toBe(true);
    expect(snap.maxResults.invalid).toBe(true);

    await face.save();
    expect(sets).toHaveLength(0);
    expect(face.hooks.localSearchCard.getSnapshot().dirty).toBe(true);
    expect(face.hooks.localSearchCard.getSnapshot().invalid).toBe(true);
  });

  test('emptying a text field that carries an override writes a clear on save', async () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs, unsets } = makeCtx(
      { indexDir: 'D:/idx' },
      'ready',
      { indexDir: 'D:/idx' },
    );
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    expect(face.hooks.localSearchCard.getSnapshot().indexDir.overridden).toBe(true);
    face.edit('indexDir', '');
    expect(face.hooks.localSearchCard.getSnapshot().dirty).toBe(true);
    await face.save();
    expect(unsets).toContain('indexDir');
  });

  test('emptying a field with no override is a no-op (stays clean)', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx({ indexDir: '' });
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    face.edit('indexDir', '');
    expect(face.hooks.localSearchCard.getSnapshot().dirty).toBe(false);
  });

  test('discard drops staged edits and returns to the stored values', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx({ maxResults: 5 });
    mod.apply(ctx as any);
    const face = slotRegs[0].spec.inject();
    face.edit('maxResults', '9');
    expect(face.hooks.localSearchCard.getSnapshot().dirty).toBe(true);
    face.discard();
    const snap = face.hooks.localSearchCard.getSnapshot();
    expect(snap.dirty).toBe(false);
    expect(snap.maxResults.text).toBe('5');
  });

  test('component hides itself when the namespace is unavailable (defensive)', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx(undefined, 'unavailable');
    mod.apply(ctx as any);
    const reg = slotRegs[0];
    newRenderSession();
    const el = render(reg.comp, rendererProps(reg.spec.inject(), (k) => k));
    expect(el).toBeNull();
  });

  test('the read-only deployment note renders when the scope is not writable', () => {
    const mod = loaded!.factory((name: string) => (name === 'react' ? stubReact : {}));
    const { ctx, slotRegs } = makeCtx({ maxResults: 5 }, 'ready', undefined, undefined, false);
    mod.apply(ctx as any);
    const reg = slotRegs[0];
    const face = reg.spec.inject();
    const t = (k: string) => k;
    newRenderSession();
    let el = render(reg.comp, rendererProps(face, t));
    const header = walk(el).find((n) => n?.props?.className === 'wslc_header');
    (header.props.onClick as () => void)();
    el = render(reg.comp, rendererProps(face, t));
    expect(texts(el).join(' ')).toContain('readOnly');
  });
});
