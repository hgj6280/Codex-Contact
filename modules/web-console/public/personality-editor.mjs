// Shared by the native desktop settings drawer and browser management page.
// No polling writes into the editor, and concurrent tabs use optimistic locking.
export function bindPersonalityEditor({root, api}) {
  const text = root.querySelector('[data-personality-text]');
  const toggle = root.querySelector('[data-personality-toggle]');
  const save = root.querySelector('[data-personality-save]');
  const reload = root.querySelector('[data-personality-reload]');
  const reset = root.querySelector('[data-personality-reset]');
  const status = root.querySelector('[data-personality-status]');
  const count = root.querySelector('[data-personality-count]');
  const name=root.querySelector('[data-personality-name]')||{value:'',addEventListener(){}};
  let profile = null, busy = false, loading = null, version = 0;
  const dirty = () => profile && (text.value !== profile.text || name.value.trim() !== (profile.name||''));
  function controls() {
    toggle.disabled = !profile || busy;
    save.disabled = !profile || busy;
    reset.disabled = !profile || busy;
    reload.disabled = busy;
    text.disabled = !profile;name.disabled=!profile||busy;
    count.textContent = `${text.value.length} / ${profile?.maxLength || 8000}`;
  }
  function render(value) {
    profile = value;name.value=value.name||'';name.placeholder=value.effectiveName||'从人设识别'; text.value = value.text; text.maxLength = value.maxLength;
    toggle.checked = value.enabled;
    status.textContent = value.enabled ? '自定义人设已启用，适用于全部群聊和私聊。' : '当前使用默认人设，自定义内容仍可编辑并保存。';
    controls();
  }
  async function load({force = false} = {}) {
    if (busy) return;
    if (loading) return loading;
    if (profile && !force) return;
    if (dirty() && !confirm('重新读取会丢弃未保存的人设修改，继续吗？')) return;
    busy = true; controls(); status.textContent = '正在读取人设…';
    loading = (async () => {
      try { render(await api('/api/qq/personality')); }
      catch (e) { status.textContent = `读取失败：${e.message}`; }
      finally { busy = false; loading = null; controls(); }
    })();
    return loading;
  }
  async function write(enabled, content, editingVersion) {
    if (busy || !profile) return;
    busy = true; controls(); status.textContent = '正在保存…';
    try {
      const result = await api('/api/qq/personality', {enabled, text:content, revision:profile.revision,name:name.value.trim()});
      profile = result; toggle.checked = result.enabled;
      if (version === editingVersion && text.value === content) text.value = result.text;
      status.textContent = `已保存，${result.enabled ? '自定义人设已启用' : '已恢复默认人设'}；下一条新请求生效，无需重新登录。${dirty() ? '编辑框还有未保存修改。' : ''}`;
    } catch (e) { toggle.checked = profile.enabled; status.textContent = `保存失败：${e.message}。可点「重新读取」同步。`; }
    finally { busy = false; controls(); }
  }
  name.addEventListener('input',()=>{version++;controls();status.textContent='名字有未保存修改，点击保存人设后生效。';});
  text.addEventListener('input', () => { version++; controls(); status.textContent = '有未保存修改，点击「保存人设」后生效。'; });
  save.addEventListener('click', () => write(toggle.checked, text.value, version));
  // Switching never silently saves or discards text currently being edited.
  toggle.addEventListener('change', () => {
    if (dirty()) { toggle.checked = profile.enabled; status.textContent = '请先保存人设修改，再切换启用状态。'; return; }
    return write(toggle.checked, profile.text, version);
  });
  reload.addEventListener('click', () => load({force:true}));
  reset.addEventListener('click', () => {
    if (dirty() && !confirm('用默认人设替换编辑框内的未保存修改？')) return;
    text.value = profile.defaultText; version++; controls();
    status.textContent = '默认人设已填入编辑框，点击保存后才替换自定义内容。默认备份不会被改动。';
  });
  controls();
  return {load};
}
