/** Keyless checks for the distributable Client artifact and its reversible registrations. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

function loadPlugin({ openError } = {}) {
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
    sidebarRight: { openTab(...args) {
      if (openError) throw openError;
      opened.push(args);
    } },
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
    'https://chatgpt.com/',
    'https://chatgpt.com/auth/login',
    'https://chatgpt.com/settings',
    'https://chatgpt.com/d/original-dot',
    'https://chatgpt.com/dots/',
    'https://chatgpt.com/dots/original/conversation',
    'https://chatgpt.com/g/original-gpt',
    'https://chatgpt.com/c/original/extra',
    'https://chatgpt.com/c/encoded%2Fextra',
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

test('accepts only conversation and Dot routes, including opaque Dot identifiers', () => {
  const plugin = loadPlugin();
  for (const url of [
    'https://chatgpt.com/c/original-conversation',
    'https://chatgpt.com/dots/89a5dc10-89a5-89a5-89a5-89a5dc1089a5~opaque_dot-identity',
    'https://chatgpt.com/g/g-opaque-assistant/c/original-conversation',
  ]) {
    const state = plugin.store.init();
    plugin.store.actions.saveUrl(state, url);
    assert.equal(state.url, url);
    assert.equal(plugin.injected.openInside(url), true);
    assert.equal(plugin.opened.at(-1)[1].params.url, url);
  }
});

test('opens the real selected page only on request and reports missing Browser', () => {
  const plugin = loadPlugin();
  const url = 'https://chatgpt.com/dots/original-dot';
  assert.equal(plugin.injected.openInside(url), true);
  assert.equal(plugin.opened[0][0], 'browser');
  assert.equal(plugin.opened[0][1].params.url, url);
  plugin.setBrowserAvailable(false);
  assert.equal(plugin.injected.openInside(url), false);
  assert.equal(plugin.opened.length, 1);
});

test('reports a synchronous Browser opening failure without throwing or changing the selected URL', () => {
  const plugin = loadPlugin({ openError: new Error('The current session has no sidebar surface') });
  const state = plugin.store.init();
  plugin.store.actions.saveUrl(state, 'https://chatgpt.com/dots/original-dot');
  assert.equal(plugin.injected.openInside(state.url), false);
  assert.equal(state.url, 'https://chatgpt.com/dots/original-dot');
  assert.equal(plugin.opened.length, 0);
});

test('unload removes the plugin controls and dictionary without closing Browser tabs', () => {
  const plugin = loadPlugin();
  plugin.injected.openInside('https://chatgpt.com/dots/original-dot');
  assert.deepEqual([...plugin.resources].sort(), ['locale', 'slot']);
  plugin.dispose();
  assert.equal(plugin.resources.size, 0);
  assert.equal(plugin.opened.length, 1);
});
