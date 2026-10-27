const input = document.getElementById('port'), status = document.getElementById('status');
const updateLink = () => { document.getElementById('local').href = `http://127.0.0.1:${input.value}/`; };
chrome.storage.local.get({port: 8765}).then(data => { input.value = data.port; updateLink(); });
const port = chrome.runtime.connect({name: 'btc-popup'});
port.onMessage.addListener(message => {
  if (message.type === 'state') status.textContent = '本机服务已连接';
  if (message.type === 'connection') status.textContent = message.status === 'live' ? '本机服务已连接' : '本机服务未连接，正在重试';
});
document.getElementById('settings').addEventListener('submit', async event => {
  event.preventDefault(); const value = Number(input.value);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) return;
  await chrome.storage.local.set({port: value}); updateLink(); status.textContent = '正在重新连接…';
});
