/** Open the original ChatGPT page through Harness's existing Browser tab. */
window.__ModuleLoader__.load({
  id: '@local/skeinlet-axiom-link',
  factory(require) {
    const React = require('react');
    const { defineStore } = require('@deepseek-ai/dsh-client-store');
    const h = React.createElement;
    const namespace = 'skeinletAxiomLink';
    const english = {
      title: 'Axiom link',
      setup: 'Link your existing Axiom conversation',
      label: 'ChatGPT conversation URL',
      save: 'Save link',
      change: 'Change link',
      clear: 'Remove saved link',
      cancel: 'Cancel',
      inside: 'Open Axiom here',
      external: 'Open in ChatGPT',
      invalid: 'Enter an HTTPS chatgpt.com URL without a query, fragment, or embedded credentials.',
      unavailable: 'The Browser tab is unavailable. Use Open in ChatGPT.',
      privacy: 'This opens the original ChatGPT page. Sign in there to reach your existing Dot and conversations.',
      limits: 'Desktop browser sign-in is cleared when Harness restarts. If the page cannot open here, use Open in ChatGPT.',
      saved: 'The link is saved in this browser for this Harness session.',
    };
    const dictionaries = {
      en: english,
      pt: { title: 'Link da Axiom', setup: 'Vincule sua conversa existente com a Axiom', label: 'URL da conversa no ChatGPT', save: 'Salvar link', change: 'Alterar link', clear: 'Remover link salvo', cancel: 'Cancelar', inside: 'Abrir Axiom aqui', external: 'Abrir no ChatGPT', invalid: 'Insira uma URL HTTPS de chatgpt.com sem consulta, fragmento ou credenciais.', unavailable: 'A aba Navegador está indisponível. Use Abrir no ChatGPT.', privacy: 'Abre a página original do ChatGPT. Entre nela para acessar sua Dot e suas conversas existentes.', limits: 'O login no navegador do Desktop dura até o Harness reiniciar. Se a página não abrir aqui, use Abrir no ChatGPT.', saved: 'O link fica salvo neste navegador para esta sessão do Harness.' },
      zh: { title: 'Axiom 链接', setup: '关联现有的 Axiom 对话', label: 'ChatGPT 对话网址', save: '保存链接', change: '更改链接', clear: '移除已保存的链接', cancel: '取消', inside: '在此打开 Axiom', external: '在 ChatGPT 中打开', invalid: '请输入不含查询参数、片段或嵌入凭据的 chatgpt.com HTTPS 网址。', unavailable: '浏览器标签页不可用，请选择“在 ChatGPT 中打开”。', privacy: '打开原始 ChatGPT 页面。请在该页面登录以访问现有 Dot 和对话。', limits: '桌面版浏览器登录状态会在 Harness 重启后清除。若页面无法在此打开，请选择“在 ChatGPT 中打开”。', saved: '链接保存在当前浏览器中，仅用于此 Harness 会话。' },
      ja: { title: 'Axiom リンク', setup: '既存の Axiom の会話をリンク', label: 'ChatGPT の会話 URL', save: 'リンクを保存', change: 'リンクを変更', clear: '保存したリンクを削除', cancel: 'キャンセル', inside: 'ここで Axiom を開く', external: 'ChatGPT で開く', invalid: 'クエリ、フラグメント、認証情報を含まない chatgpt.com の HTTPS URL を入力してください。', unavailable: 'ブラウザータブを利用できません。「ChatGPT で開く」を使用してください。', privacy: '元の ChatGPT ページを開きます。そこでログインすると既存の Dot と会話にアクセスできます。', limits: 'デスクトップ版ブラウザーのログイン状態は Harness の再起動まで保持されます。ここで開けない場合は「ChatGPT で開く」を使用してください。', saved: 'リンクは、この Harness セッション用にこのブラウザーに保存されます。' },
      es: { title: 'Enlace de Axiom', setup: 'Enlaza tu conversación existente con Axiom', label: 'URL de la conversación de ChatGPT', save: 'Guardar enlace', change: 'Cambiar enlace', clear: 'Eliminar enlace guardado', cancel: 'Cancelar', inside: 'Abrir Axiom aquí', external: 'Abrir en ChatGPT', invalid: 'Introduce una URL HTTPS de chatgpt.com sin consulta, fragmento ni credenciales.', unavailable: 'La pestaña Navegador no está disponible. Usa Abrir en ChatGPT.', privacy: 'Abre la página original de ChatGPT. Inicia sesión allí para acceder a tu Dot y conversaciones existentes.', limits: 'La sesión del navegador de escritorio dura hasta reiniciar Harness. Si la página no abre aquí, usa Abrir en ChatGPT.', saved: 'El enlace se guarda en este navegador para esta sesión de Harness.' },
      fr: { title: 'Lien Axiom', setup: 'Associer votre conversation Axiom existante', label: 'URL de la conversation ChatGPT', save: 'Enregistrer le lien', change: 'Modifier le lien', clear: 'Supprimer le lien enregistré', cancel: 'Annuler', inside: 'Ouvrir Axiom ici', external: 'Ouvrir dans ChatGPT', invalid: 'Saisissez une URL HTTPS de chatgpt.com sans paramètres, fragment ni identifiants.', unavailable: 'L’onglet Navigateur est indisponible. Utilisez Ouvrir dans ChatGPT.', privacy: 'Ouvre la page ChatGPT originale. Connectez-vous sur cette page pour retrouver votre Dot et vos conversations.', limits: 'La connexion du navigateur de bureau dure jusqu’au redémarrage de Harness. Si la page ne s’ouvre pas ici, utilisez Ouvrir dans ChatGPT.', saved: 'Le lien est enregistré dans ce navigateur pour cette session Harness.' },
      de: { title: 'Axiom-Link', setup: 'Vorhandenes Axiom-Gespräch verknüpfen', label: 'URL des ChatGPT-Gesprächs', save: 'Link speichern', change: 'Link ändern', clear: 'Gespeicherten Link entfernen', cancel: 'Abbrechen', inside: 'Axiom hier öffnen', external: 'In ChatGPT öffnen', invalid: 'Eine HTTPS-URL von chatgpt.com ohne Abfrage, Fragment oder Zugangsdaten eingeben.', unavailable: 'Der Browser-Tab ist nicht verfügbar. Verwenden Sie In ChatGPT öffnen.', privacy: 'Öffnet die ursprüngliche ChatGPT-Seite. Melden Sie sich dort an, um Ihren bestehenden Dot und Ihre Gespräche zu erreichen.', limits: 'Die Anmeldung im Desktop-Browser bleibt bis zum Neustart von Harness erhalten. Wenn die Seite hier nicht geöffnet wird, verwenden Sie In ChatGPT öffnen.', saved: 'Der Link wird in diesem Browser für diese Harness-Sitzung gespeichert.' },
      ru: { title: 'Ссылка Axiom', setup: 'Связать существующий разговор с Axiom', label: 'URL разговора в ChatGPT', save: 'Сохранить ссылку', change: 'Изменить ссылку', clear: 'Удалить сохранённую ссылку', cancel: 'Отмена', inside: 'Открыть Axiom здесь', external: 'Открыть в ChatGPT', invalid: 'Введите HTTPS-адрес chatgpt.com без параметров запроса, фрагмента и учётных данных.', unavailable: 'Вкладка браузера недоступна. Используйте Открыть в ChatGPT.', privacy: 'Открывает исходную страницу ChatGPT. Войдите там, чтобы получить доступ к вашему Dot и существующим разговорам.', limits: 'Вход в браузере настольного приложения действует до перезапуска Harness. Если страница здесь не открывается, используйте Открыть в ChatGPT.', saved: 'Ссылка сохраняется в этом браузере для этой сессии Harness.' },
    };
    const styles = `
      .skeinlet-axiom{display:grid;gap:8px;padding:12px 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}
      .skeinlet-axiom summary{cursor:pointer;color:var(--dsw-alias-label-primary)}
      .skeinlet-axiom form{display:grid;gap:8px;margin-top:8px}
      .skeinlet-axiom label{display:grid;gap:4px}
      .skeinlet-axiom input{width:100%;min-width:0;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:16px}
      .skeinlet-axiom-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
      .skeinlet-axiom button,.skeinlet-axiom a{padding:6px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;text-decoration:none}
      .skeinlet-axiom button:focus-visible,.skeinlet-axiom a:focus-visible,.skeinlet-axiom input:focus-visible,.skeinlet-axiom summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .skeinlet-axiom p{margin:0;overflow-wrap:anywhere}
      .skeinlet-axiom [role=alert]{color:var(--dsw-alias-state-error-primary)}
    `;

    /** Validate only user-selected public ChatGPT locations, never auth URLs. */
    function conversationUrl(value) {
      if (typeof value !== 'string') return '';
      const text = value.trim();
      if (!text || /[\s?#\\]/u.test(text)) return '';
      try {
        const url = new URL(text);
        return url.protocol === 'https:' && url.hostname === 'chatgpt.com'
          && !url.port && !url.username && !url.password ? url.href : '';
      } catch (error) {
        // Invalid user input stays in the form and is never opened or saved.
        return '';
      }
    }

    function AxiomLink(props) {
      const { t, actions, openInside } = props;
      const saved = props.useStore(state => state.url);
      const url = conversationUrl(saved);
      const [draft, setDraft] = React.useState(url);
      const [editing, setEditing] = React.useState(false);
      const [error, setError] = React.useState('');
      const edit = !url || editing;
      const buttons = url && h('div', { className: 'skeinlet-axiom-actions' },
        h('button', { type: 'button', onClick() { setError(openInside(url) ? '' : 'unavailable'); } }, t('inside')),
        h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, t('external')),
        h('button', { type: 'button', onClick() { setDraft(url); setError(''); setEditing(true); } }, t('change')));
      return h('section', { className: 'skeinlet-axiom', 'aria-label': t('title') },
        h('style', null, styles),
        buttons,
        url && h('p', null, url),
        edit && h('details', { open: editing || !url },
          h('summary', null, t('setup')),
          h('form', { onSubmit(event) {
            event.preventDefault();
            const next = conversationUrl(draft);
            if (!next) { setError('invalid'); return; }
            actions.saveUrl(next); setDraft(next); setEditing(false); setError('');
          } },
          h('label', null, t('label'), h('input', {
            type: 'url', value: draft, autoComplete: 'off', spellCheck: false,
            placeholder: 'https://chatgpt.com/…', required: true,
            onChange(event) { setDraft(event.target.value); setError(''); },
          })),
          h('p', null, t('privacy')),
          h('div', { className: 'skeinlet-axiom-actions' },
            h('button', { type: 'submit' }, t('save')),
            url && h('button', { type: 'button', onClick() { setEditing(false); setError(''); } }, t('cancel')),
            url && h('button', { type: 'button', onClick() { actions.saveUrl(''); setDraft(''); setEditing(false); setError(''); } }, t('clear'))))),
        error && h('p', { role: 'alert' }, t(error)),
        url && h('p', null, t('saved')),
        h('p', null, t('limits')));
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        const store = defineStore({
          init: () => ({ url: '' }),
          persist: 'skeinlet.axiom-link.v1',
          actions: { saveUrl(state, value) { state.url = conversationUrl(value); } },
        });
        ctx.effect(() => ctx.locale.register(namespace, dictionaries), 'axiom-link: locales');
        ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'skeinlet-axiom-link', order: 20,
          locale: namespace, store,
          inject: () => ({ openInside(value) {
            const url = conversationUrl(value);
            if (!url || ctx.sidebarRightTabs.get('browser') === undefined) return false;
            ctx.sidebarRight.openTab('browser', { params: { url } });
            return true;
          } }),
        }, AxiomLink)), 'axiom-link: composer');
      },
    };
  },
});
