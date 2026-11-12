/** Keyless checks for the distributable Client artifact and its reversible registrations. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

function loadPlugin() {
  let definition;
  let store;
  let entry;
  let component;
  let browserAvailable = true;
  const opened = [];
  const resources = new Set();
  const disposers = [];
  const disposeResource = resource => {
    resources.add(resource);
    return () => resources.delete(resource);
  };
  const plugin = {
    locale: { register: () => disposeResource('locale') },
    slots: {
      inject(_name, callback) { callback(); return () => resources.delete('slot'); },
      register(options, view) { entry = options; component = view; return disposeResource('slot'); },
    },
    sidebarRightTabs: { get: () => browserAvailable ? {} : undefined },
    sidebarRight: { openTab: (...args) => opened.push(args) },
    effect(callback) { disposers.push(callback()); },
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [initial, () => {}],
  };
  runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    URL,
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
  });
  const runtime = definition.factory(name => {
    if (name === 'react') return React;
    assert.equal(name, '@deepseek-ai/dsh-client-store');
    return { defineStore(value) { store = value; return value; } };
  });
  runtime.apply(plugin);
  return {
    store, entry, component, opened, resources,
    injected: entry.inject(),
    setBrowserAvailable(value) { browserAvailable = value; },
    dispose() { for (const disposer of disposers.reverse()) disposer(); },
  };
}

test('starts unlinked, retains only explicit ChatGPT URLs, and supports clearing', () => {
  const { store, opened } = loadPlugin();
  const state = store.init();
  assert.equal(state.url, '');
  assert.equal(opened.length, 0);
  store.actions.saveUrl(state, ' https://chatgpt.com/c/original-conversation ');
  assert.equal(state.url, 'https://chatgpt.com/c/original-conversation');
  store.actions.saveUrl(state, '');
  assert.equal(state.url, '');
});

test('refuses alternate origins and authentication-bearing locations on save and open', () => {
  const plugin = loadPlugin();
  for (const value of [
    'http://chatgpt.com/c/original',
    'https://chatgpt.com.evil.test/c/original',
    'https://evil.test/chatgpt.com',
    'https://name:secret@chatgpt.com/c/original',
    'https://chatgpt.com:8443/c/original',
    'https://chatgpt.com/c/original?token=secret',
    'https://chatgpt.com/c/original#token=secret',
    'https://chatgpt.com\\@evil.test/',
    'javascript:alert(1)',
    'not a URL',
    null,
  ]) {
    const state = plugin.store.init();
    plugin.store.actions.saveUrl(state, value);
    assert.equal(state.url, '', String(value));
    assert.equal(plugin.injected.openInside(value), false, String(value));
  }
  assert.equal(plugin.opened.length, 0);
});

test('opens the real selected page only on request and reports missing Browser', () => {
  const plugin = loadPlugin();
  const url = 'https://chatgpt.com/d/original-dot';
  assert.equal(plugin.injected.openInside(url), true);
  assert.equal(plugin.opened[0][0], 'browser');
  assert.equal(plugin.opened[0][1].params.url, url);
  plugin.setBrowserAvailable(false);
  assert.equal(plugin.injected.openInside(url), false);
  assert.equal(plugin.opened.length, 1);
});

test('unload removes the plugin controls and dictionary without closing Browser tabs', () => {
  const plugin = loadPlugin();
  plugin.injected.openInside('https://chatgpt.com/d/original-dot');
  assert.deepEqual([...plugin.resources].sort(), ['locale', 'slot']);
  plugin.dispose();
  assert.equal(plugin.resources.size, 0);
  assert.equal(plugin.opened.length, 1);
});
