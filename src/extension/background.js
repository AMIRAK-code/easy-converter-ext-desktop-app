// Service worker: right-click menu entries and the toolbar button.

const FILE_LINKS = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'json', 'md', 'txt', 'html', 'pptx', 'ods', 'odt',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico', 'svg', 'avif', 'tsv']
  .flatMap((e) => [`*://*/*.${e}`, `*://*/*.${e}?*`, `*://*/*.${e.toUpperCase()}`]);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ec-image', title: 'Easy Convert', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'ec-link', title: 'Easy Convert this file', contexts: ['link'], targetUrlPatterns: FILE_LINKS });
    chrome.contextMenus.create({ id: 'ec-app', title: 'Open Easy Convert', contexts: ['action'] });
  });
});

const openApp = (params = '') => chrome.tabs.create({ url: chrome.runtime.getURL(`app.html${params}`) });

chrome.action.onClicked.addListener(() => openApp());

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ec-app') return openApp();
  const src = info.srcUrl || info.linkUrl;
  if (!src || !tab?.id) return openApp();
  const msg = { type: 'ec-open', src };
  const target = { frameId: info.frameId ?? 0 };
  try {
    await chrome.tabs.sendMessage(tab.id, msg, target);
  } catch {
    // Page loaded before the extension, or a page content scripts can't run in.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [target.frameId] }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, msg, target);
    } catch {
      openApp(`?src=${encodeURIComponent(src)}`);
    }
  }
});
